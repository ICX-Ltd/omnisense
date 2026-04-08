import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Or, IsNull, Equal, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

import { Interaction } from '../db/entities/interaction.entity';
import { InteractionTranscript } from '../db/entities/interaction-transcript.entity';
import { InteractionInsight } from '../db/entities/interaction-insight.entity';
import { BatchJob } from '../db/entities/batch-job.entity';

import { TranscriptionDeepgramService } from '../transcription/transcriptionDeepgram.service';
import { InsightsService } from '../insights/insights.service';
import { InsightsProviderName } from '../insights/types/insights-provider.type';

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
    let where: any = {};

    if (opts.status === 'incomplete') {
      where.status = In([
        'pending_transcription',
        'transcribing',
        'transcribed',
        'error',
      ] as any);
    } else if (opts.status) {
      where.status = opts.status;
    }

    if (opts.interactionType) {
      where.interactionType = opts.interactionType;
    }

    if (opts.campaign) {
      where.campaign = opts.campaign;
    }

    if (opts.dateFrom && opts.dateTo) {
      where.interactionDateTime = Between(opts.dateFrom, opts.dateTo);
    } else if (opts.dateFrom) {
      where.interactionDateTime = MoreThanOrEqual(opts.dateFrom);
    } else if (opts.dateTo) {
      where.interactionDateTime = LessThanOrEqual(opts.dateTo);
    }

    return this.recordingsRepo.find({
      where,
      order: { interactionDateTime: opts.order ?? 'DESC' },
      take: opts.limit,
    });
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

    const res = await fetch(url, { redirect: 'follow' });

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

    try {
      let text = '';
      let model = '';

      if (provider === 'deepgram') {
        const dg = await this.deepgram.transcribeUrl(rec.recordingUrl || '');

        if (Array.isArray(dg.turns) && dg.turns.length) {
          text = this.formatDeepgramTurns(dg.turns);
        } else {
          text = dg.text ?? '';
        }

        model = 'deepgram:nova-2-phonecall';
      } else if (provider === 'openai' || provider === 'manual') {
        const audio = await this.downloadAudio(rec.recordingUrl || '');
        const file = await toFile(audio.buffer, audio.filename);

        const transcript = await this.client.audio.transcriptions.create({
          model: 'gpt-4o-transcribe',
          file,
        });

        text = transcript.text ?? '';
        model = 'openai:gpt-4o-transcribe';
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

      return { recordingId: rec.id, provider, text, model };
    } catch (e: any) {
      await this.recordingsRepo.update(rec.id, {
        status: 'error',
        lastError: e?.message ?? String(e),
      });
      throw e;
    }
  }

  async generateInsights(recordingId: string, provider?: InsightsProviderName) {
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

    try {
      const result = await this.insights.extractInsights(
        transcript.text,
        rec.interactionType,
        rec.campaign,
        provider,
      );

      const { rawJsonText, parsed, providerUsed, model } = result;
      const cs = parsed.client_services;

      await this.insightsRepo.upsert(
        {
          recordingId,
          providerUsed,
          model,
          json: rawJsonText,
          extractorVersion: 'v3',

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
        } as any,
        ['recordingId'],
      );

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

  async startBatchInsights(limit: number, provider?: InsightsProviderName) {
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

    setImmediate(() => {
      this.runBatchBackground(
        job.id,
        items.map((r) => r.id),
        (id) => this.generateInsights(id, selectedProvider),
      ).catch((err) => {
        console.error('[BatchJob] insights background error:', err);
        this.batchJobRepo
          .update(job.id, { status: 'failed', completedAt: new Date() })
          .catch(() => {});
      });
    });

    return { jobId: job.id, type: 'insights_calls', total: items.length, provider: selectedProvider };
  }

  async startBatchInsightsChats(limit: number, provider?: InsightsProviderName) {
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

    setImmediate(() => {
      this.runBatchBackground(
        job.id,
        items.map((r) => r.id),
        (id) => this.generateInsights(id, selectedProvider),
      ).catch((err) => {
        console.error('[BatchJob] insights-chats background error:', err);
        this.batchJobRepo
          .update(job.id, { status: 'failed', completedAt: new Date() })
          .catch(() => {});
      });
    });

    return { jobId: job.id, type: 'insights_chats', total: items.length, provider: selectedProvider };
  }

  private async runBatchBackground(
    jobId: string,
    ids: string[],
    processor: (id: string) => Promise<any>,
  ) {
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
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

    await this.batchJobRepo.update(jobId, {
      status: 'completed',
      completedAt: new Date(),
      errorsJson: errors.length ? JSON.stringify(errors.slice(-50)) : null,
    });
  }
}
