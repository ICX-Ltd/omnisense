import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ModelOption } from '../db/entities/model-option.entity';

// The previous hardcoded options — used to seed the table on first boot so
// nothing is lost. After that the table is the source of truth.
const SEED: Array<Partial<ModelOption>> = [
  // ── insights (modelId '' = the provider's own default) ──
  { kind: 'insights', provider: 'openai', modelId: '', label: 'Default — gpt-4o-mini (fast)', isDefault: true, sortOrder: 0 },
  { kind: 'insights', provider: 'openai', modelId: 'gpt-4o', label: 'gpt-4o (higher quality)', sortOrder: 1 },
  { kind: 'insights', provider: 'anthropic', modelId: '', label: 'Default — claude-haiku-4-5 (fast)', isDefault: true, sortOrder: 0 },
  { kind: 'insights', provider: 'anthropic', modelId: 'claude-sonnet-5', label: 'claude-sonnet-5 (higher quality)', sortOrder: 1 },
  { kind: 'insights', provider: 'anthropic', modelId: 'claude-opus-4-8', label: 'claude-opus-4-8 (highest quality)', sortOrder: 2 },
  { kind: 'insights', provider: 'grok', modelId: '', label: 'Default — grok-4-1-fast', isDefault: true, sortOrder: 0 },
  { kind: 'insights', provider: 'gemini', modelId: '', label: 'Default — gemini-1.5-flash (fast)', isDefault: true, sortOrder: 0 },
  { kind: 'insights', provider: 'gemini', modelId: 'gemini-1.5-pro', label: 'gemini-1.5-pro (higher quality)', sortOrder: 1 },
  // ── transcription ──
  { kind: 'transcription', provider: 'deepgram', modelId: 'nova-3', label: 'nova-3 (default — accents, keyterm prompting)', isDefault: true, sortOrder: 0 },
  { kind: 'transcription', provider: 'deepgram', modelId: 'nova-2-phonecall', label: 'nova-2-phonecall (phone-tuned)', sortOrder: 1 },
  { kind: 'transcription', provider: 'deepgram', modelId: 'nova-2', label: 'nova-2', sortOrder: 2 },
  { kind: 'transcription', provider: 'openai', modelId: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', sortOrder: 3 },
];

@Injectable()
export class ModelRegistryService {
  private readonly logger = new Logger(ModelRegistryService.name);
  private txCache: { model: string; at: number } | null = null;
  private readonly TTL_MS = 60_000;

  constructor(
    @InjectRepository(ModelOption)
    private readonly repo: Repository<ModelOption>,
  ) {}

  async onModuleInit() {
    try {
      if ((await this.repo.count()) === 0) {
        await this.repo.save(SEED.map((s) => this.repo.create(s)));
        this.logger.log(`Seeded ${SEED.length} model options from defaults.`);
      }
    } catch (e: any) {
      this.logger.warn(
        `Model options seed skipped — run sql/add-model-options.sql. Reason: ${e?.message ?? e}`,
      );
    }
  }

  private invalidate() {
    this.txCache = null;
  }

  list(kind?: string) {
    const where =
      kind === 'insights' || kind === 'transcription'
        ? { kind: kind as 'insights' | 'transcription' }
        : {};
    return this.repo.find({ where, order: { kind: 'ASC', provider: 'ASC', sortOrder: 'ASC' } });
  }

  // Active insights options grouped by provider, for the dashboard dropdowns.
  async insightsByProvider(): Promise<Record<string, Array<{ value: string; label: string }>>> {
    const rows = await this.repo.find({
      where: { kind: 'insights', active: true },
      order: { provider: 'ASC', sortOrder: 'ASC' },
    });
    const out: Record<string, Array<{ value: string; label: string }>> = {};
    for (const r of rows) {
      (out[r.provider] ??= []).push({ value: r.modelId, label: r.label });
    }
    return out;
  }

  // The Deepgram transcription model to use — the active default row, else env,
  // else nova-3. Cached briefly.
  async activeDeepgramModel(): Promise<string> {
    if (this.txCache && Date.now() - this.txCache.at < this.TTL_MS) return this.txCache.model;
    let model = process.env.DEEPGRAM_MODEL || 'nova-3';
    try {
      const row = await this.repo.findOne({
        where: { kind: 'transcription', provider: 'deepgram', active: true, isDefault: true },
      });
      if (row?.modelId?.trim()) model = row.modelId.trim();
    } catch {
      /* fall back to env/default */
    }
    this.txCache = { model, at: Date.now() };
    return model;
  }

  async add(row: Partial<ModelOption>) {
    const kind = row.kind === 'transcription' ? 'transcription' : 'insights';
    if (!row.provider?.trim()) throw new BadRequestException('provider is required');
    if (!row.label?.trim()) throw new BadRequestException('label is required');
    if (kind === 'transcription' && !row.modelId?.trim()) {
      throw new BadRequestException('modelId is required for a transcription model');
    }
    const saved = await this.repo.save(
      this.repo.create({
        kind,
        provider: row.provider.trim(),
        modelId: (row.modelId ?? '').trim(),
        label: row.label.trim(),
        active: row.active !== false,
        isDefault: false,
        sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : 99,
      }),
    );
    this.invalidate();
    return saved;
  }

  async update(id: string, patch: { label?: string; active?: boolean; sortOrder?: number }) {
    const set: Partial<ModelOption> = {};
    if (typeof patch.label === 'string') set.label = patch.label.trim();
    if (typeof patch.active === 'boolean') set.active = patch.active;
    if (typeof patch.sortOrder === 'number') set.sortOrder = patch.sortOrder;
    await this.repo.update(id, set);
    this.invalidate();
    return { ok: true };
  }

  // Make one row the default for its (kind, provider) — clears the others.
  async setDefault(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new BadRequestException('Not found');
    await this.repo.update({ kind: row.kind, provider: row.provider }, { isDefault: false });
    await this.repo.update(id, { isDefault: true, active: true });
    this.invalidate();
    return { ok: true };
  }

  async remove(id: string) {
    await this.repo.delete(id);
    this.invalidate();
    return { ok: true };
  }
}
