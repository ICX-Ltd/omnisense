import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Or, IsNull, Equal } from 'typeorm';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { BatchJob } from '../db/entities/batch-job.entity';
import { LlmUsageLog } from '../db/entities/llm-usage-log.entity';
import { TranscriptionUsageLog } from '../db/entities/transcription-usage-log.entity';

import { TranscriptionDeepgramService } from '../transcription/transcriptionDeepgram.service';
import {
  ChatResponseMetrics,
  InsightsService,
  cleanJsonText,
  ExtractBudget,
  ExtractAttemptLog,
  makeExtractBudget,
} from '../insights/insights.service';
import {
  aggregateChatResponseMetrics,
  computeChatResponseMetricsFromTranscript,
} from '../insights/chat-response-time';
import { InsightsProviderName } from '../insights/types/insights-provider.type';
import { describeError } from '../utils/describe-error.util';

// Bounded string columns on InteractionInsight — declared length in characters.
// Used by the upsert diagnostic logger so we can spot length / encoding issues
// when MSSQL rejects a parameter (e.g. TDS 0xE7 invalid data length).
const INSIGHT_BOUNDED_FIELDS: Array<{ name: string; max: number }> = [
  { name: 'providerUsed', max: 50 },
  { name: 'model', max: 120 },
  { name: 'extractorVersion', max: 50 },
  { name: 'contact_disposition', max: 50 },
  { name: 'conversation_type', max: 50 },
  { name: 'summary_short', max: 500 },
  { name: 'interest_level', max: 20 },
  { name: 'decision_timeline', max: 200 },
  { name: 'next_step_agreed', max: 200 },
  { name: 'campaign_detected', max: 50 },
  { name: 'competitor_purchased', max: 100 },
  { name: 'dealer_name', max: 200 },
  { name: 'not_opportunity_reason', max: 50 },
];

function inspectInsightFields(payload: Record<string, unknown>) {
  const report: Record<string, unknown> = {};
  for (const { name, max } of INSIGHT_BOUNDED_FIELDS) {
    const v = payload[name];
    if (v == null) {
      report[name] = null;
      continue;
    }
    if (typeof v !== 'string') {
      report[name] = { nonString: typeof v };
      continue;
    }
    const len = v.length;
    const hasControl = /[\x00-\x1F\x7F]/.test(v);
    // Lone high or low UTF-16 surrogate — known cause of TDS NVARCHAR length mismatches.
    const hasLoneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v);
    report[name] = {
      len,
      max,
      overLimit: len > max,
      hasControl,
      hasLoneSurrogate,
      preview: len > 60 ? `${v.slice(0, 60)}…` : v,
    };
  }
  return report;
}

function sniffAudioExt(buf: Buffer): 'wav' | 'mp3' | 'mp4' | 'unknown' {
  if (buf.length >= 12) {
    const riff = buf.toString('ascii', 0, 4);
    const wave = buf.toString('ascii', 8, 12);
    if (riff === 'RIFF' && wave === 'WAVE') return 'wav';
  }

  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return 'mp3';
  }

  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';

  return 'unknown';
}

function pickFilename(url: string, buf: Buffer) {
  const ext = sniffAudioExt(buf);
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || 'recording';
    const hasDot = last.includes('.');
    const urlExt = hasDot ? last.split('.').pop()!.toLowerCase() : '';
    const sniffExt = ext === 'mp4' ? 'm4a' : ext;

    if (
      sniffExt !== 'unknown' &&
      urlExt &&
      ['wav', 'mp3', 'm4a', 'mp4'].includes(urlExt)
    ) {
      if (
        (sniffExt === 'm4a' && (urlExt === 'm4a' || urlExt === 'mp4')) ||
        urlExt === sniffExt
      ) {
        return last;
      }
    }

    if (sniffExt !== 'unknown') return `recording.${sniffExt}`;

    return hasDot ? last : 'recording.bin';
  } catch {
    const ext2 = ext === 'mp4' ? 'm4a' : ext;
    return ext2 === 'unknown' ? 'recording.bin' : `recording.${ext2}`;
  }
}

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(
    @InjectRepository(Interaction)
    private recordingsRepo: Repository<Interaction>,
    @InjectRepository(InteractionTranscript)
    private transcriptsRepo: Repository<InteractionTranscript>,
    @InjectRepository(InteractionInsight)
    private insightsRepo: Repository<InteractionInsight>,
    @InjectRepository(BatchJob)
    private batchJobRepo: Repository<BatchJob>,
    @InjectRepository(LlmUsageLog)
    private llmUsageLogRepo: Repository<LlmUsageLog>,
    @InjectRepository(TranscriptionUsageLog)
    private transcriptionUsageLogRepo: Repository<TranscriptionUsageLog>,
    private readonly deepgram: TranscriptionDeepgramService,
    private readonly insights: InsightsService,
  ) {}

  private formatDeepgramTurns(turns: Array<{ speaker: number; text: string }>) {
    return turns
      .map((t) => `Speaker ${t.speaker}: ${t.text}`.trim())
      .filter(Boolean)
      .join('\n');
  }

  async list(opts: {
    status?: string;
    limit: number;
    interactionType?: string;
    campaign?: string;
    dateFrom?: Date;
    dateTo?: Date;
    order?: 'ASC' | 'DESC';
  }) {
    // Filter and sort on COALESCE(interactionDateTime, createdAt) so records
    // without an interactionDateTime (e.g. manually-created via POST /recordings)
    // are still findable and order sensibly by import time.
    const qb = this.recordingsRepo.createQueryBuilder('r');
    const dateExpr = 'COALESCE(r.interactionDateTime, r.createdAt)';

    if (opts.status === 'incomplete') {
      qb.andWhere('r.status IN (:...incompleteStatuses)', {
        incompleteStatuses: ['pending_transcription', 'transcribing', 'transcribed', 'error'],
      });
    } else if (opts.status) {
      qb.andWhere('r.status = :status', { status: opts.status });
    }

    if (opts.interactionType) {
      qb.andWhere('r.interactionType = :interactionType', { interactionType: opts.interactionType });
    }

    if (opts.campaign) {
      qb.andWhere('r.campaign = :campaign', { campaign: opts.campaign });
    }

    if (opts.dateFrom) {
      qb.andWhere(`${dateExpr} >= :dateFrom`, { dateFrom: opts.dateFrom });
    }
    if (opts.dateTo) {
      qb.andWhere(`${dateExpr} <= :dateTo`, { dateTo: opts.dateTo });
    }

    qb.orderBy(dateExpr, opts.order ?? 'DESC').take(opts.limit);

    return qb.getMany();
  }

  async createRecording(recordingUrl: string, provider: string) {
    if (!recordingUrl?.trim()) {
      throw new BadRequestException('recordingUrl is required');
    }

    const rec = this.recordingsRepo.create({
      provider,
      recordingUrl: recordingUrl.trim(),
      status: 'pending_transcription',
      lastError: null,
    });

    return this.recordingsRepo.save(rec);
  }

  private async downloadAudio(
    url: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException(
        'recordingUrl must be an http(s) URL for this prototype.',
      );
    }

    let res: Response;
    try {
      res = await fetch(url, { redirect: 'follow' });
    } catch (e) {
      // Network-level failure reaching the recording host (DNS/TCP/TLS/timeout).
      // fetch throws a bare "fetch failed"; surface the host + underlying cause
      // so ops can tell a firewall/NAT-hairpin issue from a bad URL at a glance.
      const host = (() => { try { return new URL(url).host; } catch { return url; } })();
      throw new BadRequestException(
        `Audio download failed (network) from ${host}: ${describeError(e)}`,
      );
    }

    const contentType = res.headers.get('content-type') ?? 'unknown';
    const contentLength = res.headers.get('content-length') ?? 'unknown';

    if (!res.ok) {
      const preview = await res.text().catch(() => '');
      throw new BadRequestException(
        `Failed to download audio. HTTP ${res.status}. content-type=${contentType}. preview=${preview.slice(0, 200)}`,
      );
    }

    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);

    const head = buffer.subarray(0, 16).toString('hex');
    if (buffer.length < 1024) {
      const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 300));
      throw new BadRequestException(
        `Downloaded file too small (${buffer.length} bytes). content-type=${contentType}. content-length=${contentLength}. head(hex)=${head}. preview=${preview}`,
      );
    }

    const textStart = buffer.toString('utf8', 0, 20).toLowerCase();
    if (textStart.includes('<!doctype') || textStart.includes('<html')) {
      const preview = buffer.toString('utf8', 0, 300);
      throw new BadRequestException(
        `Downloaded HTML instead of audio. content-type=${contentType}. head(hex)=${head}. preview=${preview}`,
      );
    }

    console.log(
      `[downloadAudio] ok status=${res.status} bytes=${buffer.length} type=${contentType} head=${head}`,
    );

    const filename = pickFilename(url, buffer);
    console.log(
      `[downloadAudio] ok status=${res.status} bytes=${buffer.length} type=${contentType} filename=${filename} head=${head}`,
    );

    return { buffer, filename };
  }

  async transcribeRecordingById(recordingId: string) {
    const rec = await this.recordingsRepo.findOne({
      where: { id: recordingId },
    });
    if (!rec) throw new NotFoundException('Recording not found');

    if (rec.interactionType === 'chat') {
      throw new BadRequestException(
        'Chat interactions do not require transcription',
      );
    }

    const provider = (rec.provider || 'openai').toLowerCase();

    await this.recordingsRepo.update(rec.id, {
      status: 'transcribing',
      lastError: null,
    });

    let model = '';
    let audioSeconds: number | null = null;
    let txOutcome: 'success' | 'error' = 'error';

    try {
      let text = '';

      if (provider === 'deepgram') {
        // Download server-side and send bytes rather than handing Deepgram the
        // URL. The MaxContact ASP.NET download endpoint 405s on HEAD and ignores
        // Range, so Deepgram's remote fetcher fails with REMOTE_CONTENT_ERROR
        // even though a plain server-side GET returns valid audio.
        const audio = await this.downloadAudio(rec.recordingUrl || '');
        const dg = await this.deepgram.transcribeBuffer(audio.buffer);

        if (Array.isArray(dg.turns) && dg.turns.length) {
          text = this.formatDeepgramTurns(dg.turns);
        } else {
          text = dg.text ?? '';
        }

        model = 'deepgram:nova-2-phonecall';
        audioSeconds =
          typeof dg.durationSeconds === 'number' ? dg.durationSeconds : null;
      } else if (provider === 'openai' || provider === 'manual') {
        const audio = await this.downloadAudio(rec.recordingUrl || '');
        const file = await toFile(audio.buffer, audio.filename);

        const transcript = await this.client.audio.transcriptions.create({
          model: 'gpt-4o-transcribe',
          file,
        });

        text = transcript.text ?? '';
        model = 'openai:gpt-4o-transcribe';
        // gpt-4o-transcribe doesn't return audio duration — logged event-only.
      } else {
        throw new BadRequestException(`Unsupported provider: ${rec.provider}`);
      }

      await this.transcriptsRepo.upsert(
        {
          recordingId: rec.id,
          text,
          model,
        },
        ['recordingId'],
      );

      await this.recordingsRepo.update(rec.id, {
        status: 'transcribed',
        lastError: null,
      });

      txOutcome = 'success';
      return { recordingId: rec.id, provider, text, model };
    } catch (e: any) {
      await this.recordingsRepo.update(rec.id, {
        status: 'error',
        // describeError walks error.cause so a network "fetch failed" is stored
        // with its real reason (e.g. "connect ETIMEDOUT maxcall...:443").
        lastError: describeError(e),
      });
      throw e;
    } finally {
      // Record transcription spend (priced per audio-minute) — success or failure.
      if (provider === 'deepgram' || provider === 'openai' || provider === 'manual') {
        try {
          await this.transcriptionUsageLogRepo.insert({
            recordingId: rec.id,
            provider: provider === 'deepgram' ? 'deepgram' : 'openai',
            model:
              model ||
              (provider === 'deepgram'
                ? 'deepgram:nova-2-phonecall'
                : 'openai:gpt-4o-transcribe'),
            audioSeconds,
            outcome: txOutcome,
          });
        } catch (logErr: any) {
          this.logger.warn(
            `Failed to write transcription_usage_log for ${rec.id}: ${logErr?.message ?? logErr}`,
          );
        }
      }
    }
  }

  async generateInsights(
    recordingId: string,
    provider?: InsightsProviderName,
    budget?: ExtractBudget,
    modelOverride?: string,
  ) {
    const rec = await this.recordingsRepo.findOne({
      where: { id: recordingId },
    });
    if (!rec) throw new NotFoundException('Recording not found');

    const transcript = await this.transcriptsRepo.findOne({
      where: { recordingId },
    });
    if (!transcript?.text?.trim()) {
      throw new BadRequestException('No transcript found for this recording');
    }

    // Collected per-attempt and written (success or failure) in the finally below.
    const attemptLogs: ExtractAttemptLog[] = [];

    try {
      const result = await this.insights.extractInsights(
        transcript.text,
        rec.interactionType,
        rec.campaign,
        provider,
        budget,
        (a) => attemptLogs.push(a),
        modelOverride,
      );

      const { rawJsonText, parsed, providerUsed, model, usage } = result;
      const cs = parsed.client_services;
      // Chat response-time metrics are computed deterministically from the
      // transcript text — the LLM is not asked for them. For calls we leave
      // the metrics null.
      const isChat = rec.interactionType === 'chat';
      const chatResponseMetrics: ChatResponseMetrics | null = isChat
        ? computeChatResponseMetricsFromTranscript(transcript.text, rec.campaign)
        : null;
      const chatResponseAgg = aggregateChatResponseMetrics(
        chatResponseMetrics ?? undefined,
      );

      const insightPayload = {
        recordingId,
        providerUsed,
        model,
        json: cleanJsonText(rawJsonText),
        extractorVersion: 'v3',

        // Token usage / cost tracking
        insight_input_tokens: usage.inputTokens,
        insight_output_tokens: usage.outputTokens,
        insight_attempts: usage.attempts,
        insight_failed_input_tokens: usage.failedInputTokens,
        insight_failed_output_tokens: usage.failedOutputTokens,

        // Shared scalars
        contact_disposition: parsed.contact_disposition ?? null,
        conversation_type: parsed.conversation_type ?? null,
        summary_short: parsed.summary_short ?? null,
        summary_detailed: parsed.summary_detailed ?? null,
        sentiment_overall:
          typeof parsed.sentiment_overall === 'number'
            ? parsed.sentiment_overall
            : null,

        // Customer signals
        interest_level: parsed.customer_signals?.interest_level ?? null,
        decision_timeline: parsed.customer_signals?.decision_timeline ?? null,
        next_step_agreed: parsed.customer_signals?.next_step_agreed ?? null,
        objections_json: JSON.stringify(parsed.customer_signals?.objections ?? []),

        // Operations
        overall_score:
          typeof parsed.operations?.overall_score === 'number'
            ? parsed.operations.overall_score
            : null,
        operations_scores_json: JSON.stringify(parsed.operations?.scores ?? {}),
        coaching_json: JSON.stringify(parsed.operations?.coaching ?? {}),
        operations_partial_scoring:
          typeof parsed.operations?.scoring_flags?.partial_scoring === 'boolean'
            ? parsed.operations.scoring_flags.partial_scoring
            : null,
        operations_low_score_alert:
          typeof parsed.operations?.scoring_flags?.low_score_alert === 'boolean'
            ? parsed.operations.scoring_flags.low_score_alert
            : null,

        // Call-specific
        campaign_detected: parsed.campaign_detected ?? null,
        campaign_compliance_json: parsed.campaign_compliance
          ? JSON.stringify(parsed.campaign_compliance)
          : null,

        // Client services scalars
        is_in_market_now: cs?.is_in_market_now ?? null,
        has_purchased_elsewhere: cs?.has_purchased_elsewhere ?? null,
        competitor_purchased: cs?.competitor_purchased ?? null,
        lost_sale: cs?.lost_sale ?? null,
        lead_generated_for_dealer: cs?.lead_generated_for_dealer ?? null,
        dealer_name: cs?.dealer_name ?? null,
        client_services_json: cs ? JSON.stringify(cs) : null,

        // QA assessment (campaign-specific)
        qa_scores_json: parsed.qa_assessment
          ? JSON.stringify(parsed.qa_assessment)
          : null,
        qa_partial_scoring:
          typeof parsed.qa_assessment?.scoring_flags?.partial_scoring === 'boolean'
            ? parsed.qa_assessment.scoring_flags.partial_scoring
            : null,
        qa_low_score_alert:
          typeof parsed.qa_assessment?.scoring_flags?.low_score_alert === 'boolean'
            ? parsed.qa_assessment.scoring_flags.low_score_alert
            : null,

        // Objection handling assessment (campaign-specific)
        objection_assessments_json: parsed.objection_assessment
          ? JSON.stringify(parsed.objection_assessment)
          : null,

        // Campaign-specific Q&A blob (e.g. Parity campaign_answers)
        campaign_answers_json: parsed.campaign_answers
          ? JSON.stringify(parsed.campaign_answers)
          : null,

        // Campaign-specific transcript insight blob (e.g. NMGB Survey). Stored
        // separately from campaign_answers_json — for NMGB Survey that column is
        // owned/restored by sql/nmgb_survey_backfill.sql, which leaves this one
        // untouched.
        campaign_transcript_json: parsed.campaign_transcript
          ? JSON.stringify(parsed.campaign_transcript)
          : null,

        // Chat agent response-time metrics (chats only; null for calls)
        chat_response_avg_seconds: chatResponseAgg.avgSeconds,
        chat_response_longest_seconds: chatResponseAgg.longestSeconds,
        chat_response_last_seconds: chatResponseAgg.lastSeconds,
        chat_response_sla_breach_count: chatResponseAgg.slaBreachCount,
        chat_response_measured_count: chatResponseAgg.measuredCount,
        chat_response_metrics_json: chatResponseMetrics
          ? JSON.stringify(chatResponseMetrics)
          : null,

        // Opportunity classification
        is_opportunity: parsed.opportunity?.is_opportunity ?? null,
        not_opportunity_reason: parsed.opportunity?.not_opportunity_reason ?? null,
        opportunity_json: parsed.opportunity
          ? JSON.stringify(parsed.opportunity)
          : null,

        // Shared JSON
        action_items_json: JSON.stringify(parsed.action_items ?? []),
        key_entities_json: JSON.stringify(parsed.key_entities ?? []),
        risk_flags_json: JSON.stringify(parsed.risk_flags ?? []),
        data_quality_json: JSON.stringify(parsed.data_quality ?? {}),
      };

      try {
        await this.insightsRepo.upsert(insightPayload as any, ['recordingId']);
      } catch (dbErr: any) {
        this.logger.error(
          `Insights upsert failed for recordingId=${recordingId} provider=${providerUsed} model=${model}: ${dbErr?.message ?? dbErr}`,
        );
        this.logger.error(
          `Bounded-field inspection: ${JSON.stringify(inspectInsightFields(insightPayload as Record<string, unknown>))}`,
        );
        throw dbErr;
      }

      await this.recordingsRepo.update(recordingId, {
        status: 'insights_done',
        lastError: null,
      });

      return {
        recordingId,
        providerUsed,
        model,
        rawJsonText,
        parsed,
      };
    } catch (e: any) {
      await this.recordingsRepo.update(recordingId, {
        status: 'error',
        lastError: e?.message ?? String(e),
      });
      throw e;
    } finally {
      // Durably record every attempt's token spend — even when the record
      // ultimately failed (so total cost includes failed extractions).
      if (attemptLogs.length) {
        try {
          await this.llmUsageLogRepo.insert(
            attemptLogs.map((a) => ({
              recordingId,
              provider: a.provider,
              model: a.model,
              interactionType: rec.interactionType,
              campaign: rec.campaign,
              attempt: a.attempt,
              outcome: a.outcome,
              truncated: a.truncated,
              inputTokens: a.inputTokens,
              outputTokens: a.outputTokens,
            })),
          );
        } catch (logErr: any) {
          this.logger.warn(
            `Failed to write llm_usage_log for ${recordingId}: ${logErr?.message ?? logErr}`,
          );
        }
      }
    }
  }

  async generateInsightsById(
    recordingId: string,
    provider?: InsightsProviderName,
  ) {
    return this.generateInsights(recordingId, provider);
  }

  async getTranscript(recordingId: string) {
    const t = await this.transcriptsRepo.findOne({ where: { recordingId } });
    if (!t) return null;

    return {
      id: t.id,
      recordingId: t.recordingId,
      text: t.text,
      model: t.model,
      createdAt: t.createdAt,
    };
  }

  async getInsight(recordingId: string) {
    const i = await this.insightsRepo.findOne({ where: { recordingId } });
    if (!i) return null;

    return {
      id: i.id,
      recordingId: i.recordingId,
      providerUsed: i.providerUsed,
      model: i.model,
      json: i.json,
      extractorVersion: i.extractorVersion,
      createdAt: i.createdAt,
    };
  }

  async summaryByStatus() {
    const callRows = await this.recordingsRepo
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .where("r.interactionType IS NULL OR r.interactionType = 'call'")
      .groupBy('r.status')
      .getRawMany<{ status: string; count: string }>();

    const chatRows = await this.recordingsRepo
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .where("r.interactionType = 'chat'")
      .groupBy('r.status')
      .getRawMany<{ status: string; count: string }>();

    const callsByStatus: Record<string, number> = {};
    for (const r of callRows) callsByStatus[r.status] = parseInt(r.count, 10);

    const chatsByStatus: Record<string, number> = {};
    for (const r of chatRows) chatsByStatus[r.status] = parseInt(r.count, 10);

    const callTotal = Object.values(callsByStatus).reduce((a, b) => a + b, 0);
    const chatTotal = Object.values(chatsByStatus).reduce((a, b) => a + b, 0);

    return {
      totalRows: callTotal + chatTotal,
      calls: { total: callTotal, byStatus: callsByStatus },
      chats: { total: chatTotal, byStatus: chatsByStatus },
    };
  }

  async batchTranscribe(limit: number) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 10;

    const items = await this.recordingsRepo.find({
      where: {
        status: 'pending_transcription' as any,
        interactionType: Or(IsNull(), Equal('call')) as any,
      },
      order: { createdAt: 'ASC' },
      take: n,
    });

    const results: Array<{
      id: string;
      ok: boolean;
      error?: string;
      provider?: string;
      model?: string;
    }> = [];

    for (const r of items) {
      try {
        const result = await this.transcribeRecordingById(r.id);
        results.push({
          id: r.id,
          ok: true,
          provider: result.provider,
          model: result.model,
        });
      } catch (e: any) {
        results.push({ id: r.id, ok: false, error: e?.message ?? String(e) });
      }
    }

    return { requested: n, found: items.length, results };
  }

  async batchInsights(limit: number, provider?: InsightsProviderName) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 10;

    const selectedProvider =
      provider ??
      (process.env.INSIGHTS_PROVIDER as InsightsProviderName | undefined) ??
      'openai';

    const items = await this.recordingsRepo.find({
      where: {
        status: In(['transcribed'] as any),
        interactionType: Or(IsNull(), Equal('call')) as any,
      },
      order: { createdAt: 'ASC' },
      take: n,
    });

    const results: Array<{
      id: string;
      ok: boolean;
      providerUsed?: string;
      model?: string;
      error?: string;
    }> = [];

    for (const r of items) {
      try {
        const result = await this.generateInsights(r.id, selectedProvider);
        results.push({
          id: r.id,
          ok: true,
          providerUsed: result.providerUsed,
          model: result.model,
        });
      } catch (e: any) {
        results.push({ id: r.id, ok: false, error: e?.message ?? String(e) });
      }
    }

    return {
      requested: n,
      found: items.length,
      providerUsed: selectedProvider,
      results,
    };
  }

  async batchInsightsChats(limit: number, provider?: InsightsProviderName) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 10;

    const selectedProvider =
      provider ??
      (process.env.INSIGHTS_PROVIDER as InsightsProviderName | undefined) ??
      'openai';

    const items = await this.recordingsRepo.find({
      where: {
        status: In(['transcribed'] as any),
        interactionType: Equal('chat') as any,
      },
      order: { createdAt: 'ASC' },
      take: n,
    });

    const results: Array<{
      id: string;
      ok: boolean;
      providerUsed?: string;
      model?: string;
      error?: string;
    }> = [];

    for (const r of items) {
      try {
        const result = await this.generateInsights(r.id, selectedProvider);
        results.push({
          id: r.id,
          ok: true,
          providerUsed: result.providerUsed,
          model: result.model,
        });
      } catch (e: any) {
        results.push({ id: r.id, ok: false, error: e?.message ?? String(e) });
      }
    }

    return {
      requested: n,
      found: items.length,
      providerUsed: selectedProvider,
      results,
    };
  }

  // ── Async / fire-and-forget batch methods ────────────────────────────────

  async listJobs(limit = 20) {
    const jobs = await this.batchJobRepo.find({
      order: { startedAt: 'DESC' },
      take: limit,
    });
    return jobs.map((j) => this.serializeJob(j));
  }

  async getJob(id: string) {
    const job = await this.batchJobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    return this.serializeJob(job);
  }

  private serializeJob(job: import('../db/entities/batch-job.entity').BatchJob) {
    return {
      ...job,
      errors: job.errorsJson ? (JSON.parse(job.errorsJson) as Array<{ id: string; error: string }>) : [],
      errorsJson: undefined, // don't expose the raw string
    };
  }

  async startBatchTranscribe(limit: number) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 10;

    const items = await this.recordingsRepo.find({
      where: {
        status: 'pending_transcription' as any,
        interactionType: Or(IsNull(), Equal('call')) as any,
      },
      order: { createdAt: 'ASC' },
      take: n,
    });

    const job = await this.batchJobRepo.save(
      this.batchJobRepo.create({
        type: 'transcribe',
        status: 'running',
        total: items.length,
        progress: 0,
        errorCount: 0,
        provider: null,
        completedAt: null,
      }),
    );

    setImmediate(() => {
      this.runBatchBackground(
        job.id,
        items.map((r) => r.id),
        (id) => this.transcribeRecordingById(id),
      ).catch((err) => {
        console.error('[BatchJob] transcribe background error:', err);
        this.batchJobRepo
          .update(job.id, { status: 'failed', completedAt: new Date() })
          .catch(() => {});
      });
    });

    return { jobId: job.id, type: 'transcribe', total: items.length };
  }

  async startBatchInsights(
    limit: number,
    provider?: InsightsProviderName,
    model?: string,
  ) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 10;

    const selectedProvider =
      provider ??
      (process.env.INSIGHTS_PROVIDER as InsightsProviderName | undefined) ??
      'openai';

    const items = await this.recordingsRepo.find({
      where: {
        status: In(['transcribed'] as any),
        interactionType: Or(IsNull(), Equal('call')) as any,
      },
      order: { createdAt: 'ASC' },
      take: n,
    });

    const job = await this.batchJobRepo.save(
      this.batchJobRepo.create({
        type: 'insights_calls',
        status: 'running',
        total: items.length,
        progress: 0,
        errorCount: 0,
        provider: selectedProvider,
        completedAt: null,
      }),
    );

    const budget = makeExtractBudget();
    setImmediate(() => {
      this.runBatchBackground(
        job.id,
        items.map((r) => r.id),
        (id) => this.generateInsights(id, selectedProvider, budget, model),
      ).catch((err) => {
        console.error('[BatchJob] insights background error:', err);
        this.batchJobRepo
          .update(job.id, { status: 'failed', completedAt: new Date() })
          .catch(() => {});
      });
    });

    return { jobId: job.id, type: 'insights_calls', total: items.length, provider: selectedProvider, model: model ?? null };
  }

  async startBatchInsightsChats(
    limit: number,
    provider?: InsightsProviderName,
    model?: string,
  ) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 10;

    const selectedProvider =
      provider ??
      (process.env.INSIGHTS_PROVIDER as InsightsProviderName | undefined) ??
      'openai';

    const items = await this.recordingsRepo.find({
      where: {
        status: In(['transcribed'] as any),
        interactionType: Equal('chat') as any,
      },
      order: { createdAt: 'ASC' },
      take: n,
    });

    const job = await this.batchJobRepo.save(
      this.batchJobRepo.create({
        type: 'insights_chats',
        status: 'running',
        total: items.length,
        progress: 0,
        errorCount: 0,
        provider: selectedProvider,
        completedAt: null,
      }),
    );

    const budget = makeExtractBudget();
    setImmediate(() => {
      this.runBatchBackground(
        job.id,
        items.map((r) => r.id),
        (id) => this.generateInsights(id, selectedProvider, budget, model),
      ).catch((err) => {
        console.error('[BatchJob] insights-chats background error:', err);
        this.batchJobRepo
          .update(job.id, { status: 'failed', completedAt: new Date() })
          .catch(() => {});
      });
    });

    return { jobId: job.id, type: 'insights_chats', total: items.length, provider: selectedProvider, model: model ?? null };
  }

  private async runBatchBackground(
    jobId: string,
    ids: string[],
    processor: (id: string) => Promise<any>,
  ) {
    const errors: Array<{ id: string; error: string }> = [];

    const concurrency = Math.max(
      1,
      parseInt(process.env.INSIGHTS_BATCH_CONCURRENCY ?? '5', 10) || 5,
    );
    let cursor = 0;
    const runWorker = async () => {
      for (;;) {
        const idx = cursor++; // atomic under single-threaded event loop
        if (idx >= ids.length) return;
        const id = ids[idx];
        try {
          await processor(id);
        } catch (e: any) {
          const msg: string = e?.message ?? String(e);
          this.logger.error(`Batch job ${jobId} — item ${id} failed: ${msg}`);
          errors.push({ id, error: msg });
          await this.batchJobRepo.increment({ id: jobId }, 'errorCount', 1);
        }
        await this.batchJobRepo.increment({ id: jobId }, 'progress', 1);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, ids.length) }, () =>
        runWorker(),
      ),
    );

    await this.batchJobRepo.update(jobId, {
      status: 'completed',
      completedAt: new Date(),
      errorsJson: errors.length ? JSON.stringify(errors.slice(-50)) : null,
    });
  }
}
