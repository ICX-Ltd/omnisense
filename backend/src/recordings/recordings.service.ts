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
import { VEHICLE_KEYTERMS, VEHICLE_REPLACEMENTS } from '../transcription/vehicle-vocab';
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

// Cosine similarity between two equal-length embedding vectors (0..1 for the
// non-negative-ish space OpenAI embeddings occupy; higher = more similar).
function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Semantic-search embedding config (cheap: text-embedding-3-small, shortened
  // to 512 dims to keep the stored JSON small and the cosine loop fast).
  private embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  private embeddingDims = parseInt(process.env.OPENAI_EMBEDDING_DIMS || '512', 10) || 512;

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
    let confidence: number | null = null;
    let lowConfidenceJson: string | null = null;
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
        confidence = typeof dg.confidence === 'number' ? dg.confidence : null;
        lowConfidenceJson =
          dg.lowConfidenceWords && dg.lowConfidenceWords.length
            ? JSON.stringify(dg.lowConfidenceWords)
            : null;
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
          confidence,
          lowConfidenceJson,
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

  // ─── error requeue / reprocess (batch maintenance) ──────────────────────────

  // Reset every 'error' record to the right pending state so the normal batch
  // buttons re-pick it: records that already have a transcript go back to
  // 'transcribed' (re-run insights); those that never transcribed go back to
  // 'pending_transcription' (re-transcribe, e.g. after fixing the maxcall/NAT
  // download issue). Non-destructive — clears lastError, deletes nothing.
  async requeueErrors() {
    const m = this.recordingsRepo.manager;
    const withT = `EXISTS (SELECT 1 FROM app.interaction_transcripts t WHERE t.recordingId = r.id)`;
    const count = async (extra: string) =>
      Number(
        (
          await m.query(
            `SELECT COUNT(1) AS n FROM app.interactions r WHERE r.status = 'error' AND ${extra}`,
          )
        )[0]?.n ?? 0,
      );
    const requeuedForInsights = await count(withT);
    const requeuedForTranscription = await count(`NOT ${withT}`);
    if (requeuedForInsights) {
      await m.query(
        `UPDATE r SET status = 'transcribed', lastError = NULL FROM app.interactions r WHERE r.status = 'error' AND ${withT}`,
      );
    }
    if (requeuedForTranscription) {
      await m.query(
        `UPDATE r SET status = 'pending_transcription', lastError = NULL FROM app.interactions r WHERE r.status = 'error' AND NOT ${withT}`,
      );
    }
    return { requeuedForInsights, requeuedForTranscription };
  }

  // Requeue a single errored record (transcript-aware, same rule as the bulk op).
  async requeueOne(id: string) {
    const m = this.recordingsRepo.manager;
    const exists = Number(
      (await m.query(`SELECT COUNT(1) AS n FROM app.interactions WHERE id = @0`, [id]))[0]?.n ?? 0,
    );
    if (!exists) throw new NotFoundException('Recording not found');
    // Raw UPDATE keyed on id — mirrors the (working) bulk requeue path exactly.
    const hasT = Number(
      (await m.query(`SELECT COUNT(1) AS n FROM app.interaction_transcripts WHERE recordingId = @0`, [id]))[0]?.n ?? 0,
    );
    const status = hasT ? 'transcribed' : 'pending_transcription';
    const res = await m.query(
      `UPDATE app.interactions SET status = @1, lastError = NULL WHERE id = @0; SELECT @@ROWCOUNT AS affected`,
      [id, status],
    );
    const affected = Number(res?.[0]?.affected ?? 0);
    return { id, status, affected };
  }

  // Reprocess insights for already-completed records: delete their insight row
  // and set them back to 'transcribed' so the next insights batch re-runs them
  // (e.g. after a prompt change). DESTRUCTIVE (drops interaction_insights rows) —
  // scoped to status='insights_done', optionally filtered to one campaign.
  // NOTE: for survey campaigns this nulls campaign_answers_json until the survey
  // backfill (sql/nmgb_survey_backfill.sql) is re-run.
  async reprocessInsights(campaign?: string) {
    const m = this.recordingsRepo.manager;
    const params: any[] = [];
    let clause = `r.status = 'insights_done'`;
    if (campaign?.trim()) {
      clause += ` AND r.campaign = @0`;
      params.push(campaign.trim());
    }
    const reprocessed = Number(
      (
        await m.query(
          `SELECT COUNT(1) AS n FROM app.interactions r WHERE ${clause}`,
          params,
        )
      )[0]?.n ?? 0,
    );
    if (reprocessed) {
      await m.query(
        `DELETE ii FROM app.interaction_insights ii
         INNER JOIN app.interactions r ON r.id = ii.recordingId WHERE ${clause}`,
        params,
      );
      await m.query(
        `UPDATE r SET status = 'transcribed', lastError = NULL FROM app.interactions r WHERE ${clause}`,
        params,
      );
    }
    return { reprocessed, campaign: campaign?.trim() || null };
  }

  // ─── transcription vocabulary suggestions (keyterm feedback loop) ────────────

  // Mine the persisted low-confidence words (lowConfidenceJson) across recent
  // transcripts and surface the terms Deepgram most often struggles with, so a
  // dev can promote the real makes/models into VEHICLE_KEYTERMS (or add a
  // VEHICLE_REPLACEMENTS mapping). Terms already covered by the vocab are
  // excluded from suggestions — this only shows NEW candidates.
  async keytermSuggestions(days = 90, limit = 40) {
    const since = new Date();
    since.setDate(since.getDate() - (Number.isFinite(days) && days > 0 ? days : 90));

    const rows = await this.recordingsRepo.manager.query<Array<{ j: string }>>(
      `SELECT TOP 5000 t.lowConfidenceJson AS j
       FROM app.interaction_transcripts t
       INNER JOIN app.interactions r ON r.id = t.recordingId
       WHERE t.lowConfidenceJson IS NOT NULL
         AND COALESCE(r.interactionDateTime, r.createdAt) >= @0
       ORDER BY t.createdAt DESC`,
      [since],
    );

    // Everything the vocab already handles (keyterms + both sides of each
    // replacement), lower-cased, so covered terms drop out of the suggestions.
    const covered = new Set<string>();
    for (const k of VEHICLE_KEYTERMS) covered.add(k.toLowerCase());
    for (const [from, to] of VEHICLE_REPLACEMENTS) {
      covered.add(from.toLowerCase());
      covered.add(to.toLowerCase());
    }

    const agg = new Map<
      string,
      { word: string; calls: number; occurrences: number; minConfidence: number; sumConfidence: number }
    >();
    let analysed = 0;
    for (const row of rows) {
      let words: Array<{ word?: string; confidence?: number; count?: number }> = [];
      try {
        words = JSON.parse(row.j) ?? [];
      } catch {
        continue;
      }
      if (!Array.isArray(words) || !words.length) continue;
      analysed++;
      for (const w of words) {
        const word = (w.word || '').trim();
        if (word.length < 3) continue;
        const key = word.toLowerCase();
        if (covered.has(key)) continue;
        const conf = typeof w.confidence === 'number' ? w.confidence : 0.5;
        const occ = typeof w.count === 'number' && w.count > 0 ? w.count : 1;
        const e = agg.get(key);
        if (e) {
          e.calls += 1;
          e.occurrences += occ;
          e.minConfidence = Math.min(e.minConfidence, conf);
          e.sumConfidence += conf;
        } else {
          agg.set(key, { word, calls: 1, occurrences: occ, minConfidence: conf, sumConfidence: conf });
        }
      }
    }

    const suggestions = [...agg.values()]
      // Worth acting on = seen across multiple calls, worst confidence first.
      .sort((a, b) => b.calls - a.calls || a.minConfidence - b.minConfidence)
      .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 40)
      .map((e) => ({
        word: e.word,
        calls: e.calls,
        occurrences: e.occurrences,
        minConfidence: Math.round(e.minConfidence * 100) / 100,
        avgConfidence: Math.round((e.sumConfidence / e.calls) * 100) / 100,
      }));

    return {
      analysed,
      distinctTerms: agg.size,
      since: since.toISOString(),
      suggestions,
    };
  }

  // Transcripts ranked by confidence, lowest first — a QA review queue for the
  // calls the transcription model was least sure about. Each row links to the
  // detail drawer (which shows the transcript + the low-confidence terms).
  async lowConfidenceTranscripts(limit = 50) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50;
    const rows = await this.recordingsRepo.manager.query<
      Array<{
        id: string;
        confidence: number;
        model: string;
        lowJson: string | null;
        snippet: string | null;
        campaign: string | null;
        interactionType: string | null;
        date: Date | null;
      }>
    >(
      `SELECT TOP (@0)
         t.recordingId AS id, t.confidence AS confidence, t.model AS model,
         t.lowConfidenceJson AS lowJson, LEFT(t.text, 160) AS snippet,
         r.campaign AS campaign, r.interactionType AS interactionType,
         COALESCE(r.interactionDateTime, r.createdAt) AS date
       FROM app.interaction_transcripts t
       INNER JOIN app.interactions r ON r.id = t.recordingId
       WHERE t.confidence IS NOT NULL
       ORDER BY t.confidence ASC`,
      [n],
    );
    return rows.map((r) => {
      let lowConfidenceCount = 0;
      try {
        const a = JSON.parse(r.lowJson || '[]');
        lowConfidenceCount = Array.isArray(a) ? a.length : 0;
      } catch {
        /* ignore */
      }
      return {
        id: r.id,
        confidence: r.confidence,
        model: r.model,
        campaign: r.campaign,
        interactionType: r.interactionType,
        date: r.date,
        lowConfidenceCount,
        snippet: r.snippet,
      };
    });
  }

  // ─── semantic search (embeddings) ───────────────────────────────────────────

  private async embedText(text: string): Promise<number[]> {
    // Keep input well under the model's token limit; the head of a call carries
    // most of the topical signal for retrieval.
    const input = (text || '').slice(0, 20000);
    const res = await this.client.embeddings.create({
      model: this.embeddingModel,
      input,
      dimensions: this.embeddingDims,
    });
    return res.data[0]?.embedding ?? [];
  }

  // Embedding coverage — how many transcripts are searchable vs still to embed.
  async embedStatus() {
    const rows = await this.recordingsRepo.manager.query<Array<{ embedded: string; remaining: string; total: string }>>(
      `SELECT
         SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS embedded,
         SUM(CASE WHEN embedding IS NULL AND text IS NOT NULL AND LEN(text) > 20 THEN 1 ELSE 0 END) AS remaining,
         COUNT(1) AS total
       FROM app.interaction_transcripts`,
    );
    const r = rows[0];
    return {
      embedded: Number(r?.embedded ?? 0),
      remaining: Number(r?.remaining ?? 0),
      total: Number(r?.total ?? 0),
    };
  }

  // Embed transcripts that don't yet have a vector. Bounded per call; run
  // repeatedly to work through the backlog (cheap — text-embedding-3-small).
  async batchEmbedTranscripts(limit = 100) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100;
    const todo = await this.recordingsRepo.manager.query<Array<{ id: string; text: string }>>(
      `SELECT TOP (@0) id, text FROM app.interaction_transcripts
       WHERE embedding IS NULL AND text IS NOT NULL AND LEN(text) > 20
       ORDER BY createdAt DESC`,
      [n],
    );
    let embedded = 0;
    for (const t of todo) {
      try {
        const vec = await this.embedText(t.text);
        if (vec.length) {
          await this.transcriptsRepo.update(t.id, {
            embedding: JSON.stringify(vec),
            embeddingModel: this.embeddingModel,
          });
          embedded++;
        }
      } catch (e) {
        this.logger.warn(`Embed failed for transcript ${t.id}: ${describeError(e)}`);
      }
    }
    const remainingRow = await this.recordingsRepo.manager.query<Array<{ n: number }>>(
      `SELECT COUNT(1) AS n FROM app.interaction_transcripts
       WHERE embedding IS NULL AND text IS NOT NULL AND LEN(text) > 20`,
    );
    return {
      embedded,
      attempted: todo.length,
      remaining: Number(remainingRow[0]?.n ?? 0),
      model: this.embeddingModel,
    };
  }

  // Meaning-based search: embed the query, cosine-rank stored transcript vectors.
  // Optional filters (campaign / date range / channel) scope the candidate set
  // the same way the dashboards do, so a search can be narrowed.
  async semanticSearch(
    query: string,
    limit = 20,
    filters: { campaign?: string; from?: string; to?: string; interactionType?: string } = {},
  ) {
    const q = (query || '').trim();
    if (!q) return { results: [], searched: 0 };
    const qvec = await this.embedText(q);
    if (!qvec.length) return { results: [], searched: 0 };

    const conds = ['t.embedding IS NOT NULL'];
    const params: any[] = [];
    if (filters.campaign?.trim()) {
      conds.push(`r.campaign = @${params.length}`);
      params.push(filters.campaign.trim());
    }
    if (filters.from) {
      conds.push(`COALESCE(r.interactionDateTime, r.createdAt) >= @${params.length}`);
      params.push(new Date(filters.from));
    }
    if (filters.to) {
      const t = new Date(filters.to);
      t.setHours(23, 59, 59, 999);
      conds.push(`COALESCE(r.interactionDateTime, r.createdAt) <= @${params.length}`);
      params.push(t);
    }
    if (filters.interactionType === 'chat') {
      conds.push(`r.interactionType = @${params.length}`);
      params.push('chat');
    } else if (filters.interactionType === 'call') {
      // Calls may have a null interactionType, so include those too.
      conds.push(`(r.interactionType = @${params.length} OR r.interactionType IS NULL)`);
      params.push('call');
    }

    const rows = await this.recordingsRepo.manager.query<Array<any>>(
      `SELECT TOP 3000 t.recordingId AS id, t.embedding AS emb, LEFT(t.text, 240) AS snippet,
         r.campaign AS campaign, r.interactionType AS interactionType, r.agent AS agent,
         r.interactionId AS interactionId, r.interactionTpsId AS interactionTpsId,
         r.outcome AS outcome, COALESCE(r.interactionDateTime, r.createdAt) AS date
       FROM app.interaction_transcripts t
       INNER JOIN app.interactions r ON r.id = t.recordingId
       WHERE ${conds.join(' AND ')}
       ORDER BY t.createdAt DESC`,
      params,
    );

    const scored: Array<{ row: any; score: number }> = [];
    for (const row of rows) {
      let vec: number[] = [];
      try { vec = JSON.parse(row.emb); } catch { continue; }
      scored.push({ row, score: cosineSim(qvec, vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(Number(limit) || 20, 50)).map(({ row, score }) => {
      const { emb, ...rest } = row;
      return { ...rest, score: Math.round(score * 1000) / 1000 };
    });
    return { results: top, searched: rows.length };
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
