import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ModelOption } from '../db/entities/model-option.entity';
import { describeError } from '../utils/describe-error.util';

// Live model-listing config per insights provider — used by discover() to spot
// models a provider now offers that aren't in the registry yet. `keyEnv` is the
// API key; `list` fetches and normalises the provider's models endpoint to plain
// ids; `relevant` keeps only chat/insights-capable models (providers also return
// embeddings, TTS, image models we don't want cluttering the list).
interface ProviderCatalog {
  provider: string;
  keyEnv: string;
  list: (apiKey: string) => Promise<string[]>;
  relevant: (id: string) => boolean;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 12000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      let msg = body;
      try {
        const j = JSON.parse(body);
        msg = j?.error?.message ?? j?.message ?? j?.error ?? body;
        if (typeof msg !== 'string') msg = JSON.stringify(msg);
      } catch {
        /* raw */
      }
      throw new Error(`HTTP ${res.status}: ${String(msg).replace(/\s+/g, ' ').trim().slice(0, 180)}`);
    }
    return body ? JSON.parse(body) : {};
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDER_CATALOGS: ProviderCatalog[] = [
  {
    provider: 'openai',
    keyEnv: 'OPENAI_API_KEY',
    relevant: (id) => /^(gpt-|o[0-9]|chatgpt)/i.test(id),
    list: async (apiKey) => {
      const j = await fetchJson('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return (j.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
    },
  },
  {
    provider: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    relevant: (id) => /^claude/i.test(id),
    list: async (apiKey) => {
      const j = await fetchJson('https://api.anthropic.com/v1/models?limit=1000', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      return (j.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
    },
  },
  {
    provider: 'grok',
    keyEnv: 'XAI_API_KEY',
    relevant: (id) => /^grok/i.test(id),
    list: async (apiKey) => {
      const j = await fetchJson('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return (j.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
    },
  },
  {
    provider: 'gemini',
    keyEnv: 'GEMINI_API_KEY',
    relevant: (id) => /gemini|gemma/i.test(id),
    list: async (apiKey) => {
      const j = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`,
        {},
      );
      // Gemini ids arrive as "models/gemini-1.5-flash" — strip the prefix.
      return (j.models ?? [])
        .map((m: any) => String(m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    },
  },
];

export interface DiscoverProviderResult {
  provider: string;
  ok: boolean;
  error?: string;
  newModels: string[];
  registeredCount: number;
  totalOffered: number;
}

export interface DiscoverResult {
  generatedAt: string;
  providers: DiscoverProviderResult[];
}

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

  // Ask each configured provider what models it currently offers and flag the
  // ones not yet in the registry — the "keep an eye out for new/updated models"
  // check. Providers without a key set are skipped (ok:false, explained).
  async discover(): Promise<DiscoverResult> {
    // What insights modelIds we already track per provider. '' (provider
    // default) can't map to a concrete id, so it never suppresses a real id.
    const rows = await this.repo.find({ where: { kind: 'insights' } });
    const knownByProvider = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.modelId?.trim()) continue;
      (knownByProvider.get(r.provider) ?? knownByProvider.set(r.provider, new Set()).get(r.provider)!).add(
        r.modelId.trim().toLowerCase(),
      );
    }

    const providers = await Promise.all(
      PROVIDER_CATALOGS.map(async (cat): Promise<DiscoverProviderResult> => {
        const apiKey = process.env[cat.keyEnv]?.trim();
        if (!apiKey) {
          return {
            provider: cat.provider,
            ok: false,
            error: `${cat.keyEnv} not set`,
            newModels: [],
            registeredCount: 0,
            totalOffered: 0,
          };
        }
        try {
          const offered = (await cat.list(apiKey)).filter(cat.relevant);
          const known = knownByProvider.get(cat.provider) ?? new Set<string>();
          const newModels = [...new Set(offered)]
            .filter((id) => !known.has(id.toLowerCase()))
            .sort();
          return {
            provider: cat.provider,
            ok: true,
            newModels,
            registeredCount: known.size,
            totalOffered: offered.length,
          };
        } catch (e) {
          return {
            provider: cat.provider,
            ok: false,
            error: describeError(e),
            newModels: [],
            registeredCount: (knownByProvider.get(cat.provider) ?? new Set()).size,
            totalOffered: 0,
          };
        }
      }),
    );

    return { generatedAt: new Date().toISOString(), providers };
  }
}
