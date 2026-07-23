import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';

import { describeError } from '../utils/describe-error.util';

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface HealthCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  items?: Array<{ name: string; ok: boolean; note?: string }>;
}

export interface HealthReport {
  status: CheckStatus;
  generatedAt: string;
  checks: HealthCheck[];
}

// Migration manifest — the single source of truth for the drift guard. Each
// entry maps a SQL migration file to the tables/columns/indexes it provides, so
// a missing item reports EXACTLY which script to run on the server (the pain
// point when campaign_transcript_json wasn't deployed and every drawer 500'd).
// Add a row whenever a migration adds schema the app reads.
//
// Missing tables/columns are ERRORS (queries break); missing indexes are WARN
// (queries still work, just slower).
interface MigrationDef {
  file: string;
  tables?: string[];
  columns?: Array<[table: string, column: string]>;
  indexes?: string[];
}

const MIGRATION_MANIFEST: MigrationDef[] = [
  {
    file: 'base schema (create-prompt-templates.sql + initial setup)',
    tables: [
      'interactions',
      'interaction_insights',
      'interaction_transcripts',
      'insight_summaries',
      'prompt_templates',
      'prompt_template_history',
    ],
    columns: [
      ['interactions', 'outcome'],
      ['interactions', 'recordingUrl'],
      ['interactions', 'interactionDateTime'],
      ['interaction_insights', 'conversation_type'],
      ['interaction_insights', 'operations_scores_json'],
      ['interaction_insights', 'qa_scores_json'],
    ],
    indexes: ['IX_prompt_templates_type_kind', 'IX_prompt_template_history_template'],
  },
  {
    file: 'add-vehicle-make-model.sql',
    columns: [['interactions', 'vehicleMake'], ['interactions', 'vehicleModel']],
    indexes: ['IX_interactions_vehicleMake_vehicleModel'],
  },
  {
    file: 'add-dealer-to-interactions.sql',
    columns: [['interactions', 'dealer']],
    indexes: ['IX_interactions_dealer'],
  },
  {
    file: 'add-parity-campaign.sql',
    columns: [
      ['interactions', 'maturityDate'],
      ['interactions', 'daysToMaturityAtInteraction'],
      ['interaction_insights', 'campaign_answers_json'],
    ],
    indexes: ['IX_interactions_campaign_daysToMaturity', 'IX_interactions_campaign_maturityDate'],
  },
  {
    file: 'add-chat-response-metrics.sql',
    columns: [
      ['interaction_insights', 'chat_response_avg_seconds'],
      ['interaction_insights', 'chat_response_longest_seconds'],
      ['interaction_insights', 'chat_response_last_seconds'],
      ['interaction_insights', 'chat_response_sla_breach_count'],
      ['interaction_insights', 'chat_response_measured_count'],
      ['interaction_insights', 'chat_response_metrics_json'],
    ],
    indexes: ['IX_insights_chat_sla_breach'],
  },
  {
    file: 'add-insight-usage.sql',
    columns: [
      ['interaction_insights', 'insight_input_tokens'],
      ['interaction_insights', 'insight_output_tokens'],
      ['interaction_insights', 'insight_attempts'],
      ['interaction_insights', 'insight_failed_input_tokens'],
      ['interaction_insights', 'insight_failed_output_tokens'],
    ],
  },
  {
    file: 'add-scoring-flags.sql',
    columns: [
      ['interaction_insights', 'operations_partial_scoring'],
      ['interaction_insights', 'operations_low_score_alert'],
      ['interaction_insights', 'qa_partial_scoring'],
      ['interaction_insights', 'qa_low_score_alert'],
    ],
    indexes: [
      'IX_insights_ops_partial_scoring',
      'IX_insights_ops_low_score_alert',
      'IX_insights_qa_partial_scoring',
      'IX_insights_qa_low_score_alert',
    ],
  },
  {
    file: 'add-nmgb-survey-transcript.sql',
    columns: [['interaction_insights', 'campaign_transcript_json']],
  },
  {
    file: 'add-insight-prompt-versions.sql',
    columns: [['interaction_insights', 'prompt_versions_json']],
  },
  {
    file: 'add-transcription-confidence.sql',
    columns: [
      ['interaction_transcripts', 'confidence'],
      ['interaction_transcripts', 'lowConfidenceJson'],
    ],
  },
  {
    file: 'add-transcription-word-stats.sql',
    columns: [
      ['interaction_transcripts', 'wordCount'],
      ['interaction_transcripts', 'uncertainWordCount'],
    ],
  },
  {
    file: 'add-transcript-embeddings.sql',
    columns: [
      ['interaction_transcripts', 'embedding'],
      ['interaction_transcripts', 'embeddingModel'],
    ],
  },
  {
    file: 'add-transcription-vocab.sql',
    tables: ['transcription_vocab'],
  },
  {
    file: 'add-model-options.sql',
    tables: ['model_options'],
  },
  {
    file: 'add-insight-corrections.sql',
    tables: ['insight_corrections'],
  },
  {
    file: 'add-interaction-csat.sql',
    tables: ['interaction_csat'],
    columns: [['interactions', 'hasCsat']],
    indexes: [
      'IX_interaction_csat_tpsid',
      'IX_interaction_csat_recording',
      'IX_interaction_csat_status',
      'IX_interaction_csat_decision',
    ],
  },
  {
    file: 'add-llm-usage-log.sql',
    tables: ['llm_usage_log'],
    indexes: ['IX_llm_usage_log_createdAt'],
  },
  {
    file: 'add-transcription-usage-log.sql',
    tables: ['transcription_usage_log'],
    indexes: ['IX_transcription_usage_log_createdAt'],
  },
];

// Provider → env var that must be set for that provider to work.
const PROVIDER_KEYS: Array<[name: string, env: string]> = [
  ['OpenAI', 'OPENAI_API_KEY'],
  ['Anthropic', 'ANTHROPIC_API_KEY'],
  ['Grok (x.ai)', 'XAI_API_KEY'],
  ['Gemini', 'GEMINI_API_KEY'],
];

// Live provider probes — a real, minimal (max 1-token) generation call per
// provider so the on-demand check can tell apart: valid key / invalid-or-expired
// key / out-of-tokens (quota) / unreachable. `build` is a function because the
// key is only read at probe time, and the model mirrors the same env override →
// fast default that each insights provider uses. Costs a trivial number of
// tokens, which is why it runs on demand rather than on every page load.
interface ProviderProbe {
  key: string;
  label: string;
  keyEnv: string;
  build: (apiKey: string) => { url: string; init: RequestInit; model: string };
}

const PROVIDER_PROBES: ProviderProbe[] = [
  {
    key: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    build: (apiKey) => {
      const model = process.env.OPENAI_INSIGHTS_MODEL || 'gpt-4o-mini';
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        model,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        },
      };
    },
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    build: (apiKey) => {
      const model = process.env.ANTHROPIC_INSIGHTS_MODEL || 'claude-haiku-4-5';
      return {
        url: 'https://api.anthropic.com/v1/messages',
        model,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        },
      };
    },
  },
  {
    key: 'grok',
    label: 'Grok (x.ai)',
    keyEnv: 'XAI_API_KEY',
    build: (apiKey) => {
      const model = process.env.GROK_INSIGHTS_MODEL || 'grok-4-1-fast-non-reasoning';
      return {
        url: 'https://api.x.ai/v1/chat/completions',
        model,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        },
      };
    },
  },
  {
    key: 'gemini',
    label: 'Gemini',
    keyEnv: 'GEMINI_API_KEY',
    build: (apiKey) => {
      const model = process.env.GEMINI_INSIGHTS_MODEL || 'gemini-1.5-flash';
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        model,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 1 },
          }),
        },
      };
    },
  },
];

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('warn')) return 'warn';
  return 'ok';
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly jwt: JwtService,
  ) {}

  // Log migration drift loudly at startup so a forgotten prod migration is
  // visible in the boot log, not only when a query later 500s.
  async onModuleInit() {
    try {
      const check = await this.checkSchema();
      if (check.status !== 'ok') {
        this.logger.warn(`[health] schema drift at startup — ${check.detail}`);
      }
    } catch (e) {
      this.logger.warn(`[health] startup schema check skipped: ${describeError(e)}`);
    }
  }

  // ─── role gate (mirrors PromptsService) ─────────────────────────────────────
  requireRole(authHeader: string | undefined, allowed: string[]): void {
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    let roleId: string | null = null;
    try {
      const payload: any = this.jwt.verify(authHeader.slice('Bearer '.length));
      roleId = (payload.roleId as string | null) ?? null;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!allowed.includes(String(roleId ?? '').trim().toLowerCase())) {
      throw new ForbiddenException('Insufficient role');
    }
  }

  // ─── cheap checks (always-on) ───────────────────────────────────────────────
  async getReport(): Promise<HealthReport> {
    const checks: HealthCheck[] = [];
    checks.push(await this.checkDatabase());
    checks.push(await this.checkSchema());
    checks.push(await this.checkPrompts());
    checks.push(this.checkProviders());
    checks.push(this.checkTranscriptionConfig());
    return {
      status: worst(checks.map((c) => c.status)),
      generatedAt: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    try {
      await this.ds.query('SELECT 1');
      return { key: 'database', label: 'Database', status: 'ok', detail: 'Connected.' };
    } catch (e) {
      return { key: 'database', label: 'Database', status: 'error', detail: describeError(e) };
    }
  }

  private async checkSchema(): Promise<HealthCheck> {
    try {
      const cols = await this.ds.query<Array<{ t: string; c: string }>>(
        `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
         FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'app'`,
      );
      const colSet = new Set(cols.map((r) => `${r.t}.${r.c}`.toLowerCase()));
      const tableSet = new Set(cols.map((r) => r.t.toLowerCase()));
      const idxRows = await this.ds.query<Array<{ name: string }>>(
        `SELECT name FROM sys.indexes WHERE name IS NOT NULL`,
      );
      const idxSet = new Set(idxRows.map((r) => r.name.toLowerCase()));

      // Only surface what's MISSING — a green list of 40 items is noise. Each
      // missing item carries the migration file that provides it.
      const items: Array<{ name: string; ok: boolean; note?: string }> = [];
      let total = 0;
      let missingCritical = 0; // tables/columns → error
      let missingIndex = 0; // indexes → warn
      const filesToRun = new Set<string>();

      for (const m of MIGRATION_MANIFEST) {
        for (const tbl of m.tables ?? []) {
          total++;
          if (!tableSet.has(tbl.toLowerCase())) {
            missingCritical++;
            filesToRun.add(m.file);
            items.push({ name: `table ${tbl}`, ok: false, note: m.file });
          }
        }
        for (const [t, c] of m.columns ?? []) {
          total++;
          if (!colSet.has(`${t}.${c}`.toLowerCase())) {
            missingCritical++;
            filesToRun.add(m.file);
            items.push({ name: `${t}.${c}`, ok: false, note: m.file });
          }
        }
        for (const idx of m.indexes ?? []) {
          total++;
          if (!idxSet.has(idx.toLowerCase())) {
            missingIndex++;
            filesToRun.add(m.file);
            items.push({ name: `index ${idx}`, ok: false, note: `${m.file} (perf only)` });
          }
        }
      }

      const status: CheckStatus = missingCritical ? 'error' : missingIndex ? 'warn' : 'ok';
      const detail =
        status === 'ok'
          ? `All ${total} expected tables, columns and indexes present.`
          : `${missingCritical} table/column${missingCritical === 1 ? '' : 's'} and ${missingIndex} index${missingIndex === 1 ? '' : 'es'} missing. Run: ${[...filesToRun].join(', ')}`;
      return { key: 'schema', label: 'Schema / migrations', status, detail, items };
    } catch (e) {
      return { key: 'schema', label: 'Schema / migrations', status: 'error', detail: describeError(e) };
    }
  }

  private async checkPrompts(): Promise<HealthCheck> {
    try {
      const rows = await this.ds.query<Array<{ key: string; body: string }>>(
        `SELECT [key] AS [key], body FROM app.prompt_templates`,
      );
      const byKey = new Map(rows.map((r) => [r.key, r.body ?? '']));
      const items: Array<{ name: string; ok: boolean; note?: string }> = [];

      const hasCallBase = byKey.has('call.base');
      const hasChatBase = byKey.has('chat.base');
      items.push({ name: 'call.base seeded', ok: hasCallBase });
      items.push({ name: 'chat.base seeded', ok: hasChatBase });

      // call.base must carry the transcript-section placeholder or the composer
      // has nowhere to inject campaign transcript extraction (stale base).
      const callBaseFresh =
        hasCallBase && byKey.get('call.base')!.includes('{{campaign_transcript_schema}}');
      items.push({
        name: 'call.base has transcript placeholder',
        ok: callBaseFresh,
        note: !hasCallBase ? 'call.base missing' : callBaseFresh ? undefined : 'stale — DELETE call.base and restart to reseed',
      });

      const hardMissing = !hasCallBase || !hasChatBase;
      return {
        key: 'prompts',
        label: 'Prompt fragments',
        status: hardMissing ? 'error' : callBaseFresh ? 'ok' : 'warn',
        detail: hardMissing
          ? 'Core base prompt(s) not seeded — restart backend or run the prompt seed SQL.'
          : callBaseFresh
            ? `${rows.length} prompt fragments seeded.`
            : 'call.base predates the transcript placeholders — reseed to enable campaign transcript extraction.',
        items,
      };
    } catch (e) {
      return { key: 'prompts', label: 'Prompt fragments', status: 'error', detail: describeError(e) };
    }
  }

  private checkProviders(): HealthCheck {
    const items = PROVIDER_KEYS.map(([name, env]) => ({
      name,
      ok: Boolean(process.env[env]?.trim()),
      note: process.env[env]?.trim() ? undefined : `${env} not set`,
    }));
    const anySet = items.some((i) => i.ok);
    return {
      key: 'providers',
      label: 'LLM provider keys',
      // At least one provider must be configured; missing others is only a warn.
      status: !anySet ? 'error' : items.every((i) => i.ok) ? 'ok' : 'warn',
      detail: !anySet
        ? 'No LLM provider API key is set — insights extraction cannot run.'
        : `${items.filter((i) => i.ok).length}/${items.length} provider keys set.`,
      items,
    };
  }

  private checkTranscriptionConfig(): HealthCheck {
    const dg = Boolean(process.env.DEEPGRAM_API_KEY?.trim());
    const model = process.env.DEEPGRAM_MODEL || 'nova-2-phonecall (default)';
    return {
      key: 'transcription',
      label: 'Transcription config',
      status: dg ? 'ok' : 'warn',
      detail: dg
        ? `Deepgram key set. Model: ${model}.`
        : 'DEEPGRAM_API_KEY not set — Deepgram transcription will fail (OpenAI fallback only).',
      items: [{ name: 'DEEPGRAM_API_KEY', ok: dg }],
    };
  }

  // ─── on-demand connectivity (outbound network) ──────────────────────────────
  async getConnectivity(): Promise<HealthReport> {
    const checks: HealthCheck[] = [];
    checks.push(await this.pingDeepgram());
    checks.push(await this.pingRecordingHost());
    return {
      status: worst(checks.map((c) => c.status)),
      generatedAt: new Date().toISOString(),
      checks,
    };
  }

  private async timedFetch(
    url: string,
    timeoutMs = 8000,
  ): Promise<{ reachable: boolean; status?: number; ms: number; error?: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const start = Date.now();
    try {
      // GET + manual redirect; we read only the status line, never the body.
      const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
      return { reachable: true, status: res.status, ms: Date.now() - start };
    } catch (e) {
      return { reachable: false, ms: Date.now() - start, error: describeError(e) };
    } finally {
      clearTimeout(timer);
      ctrl.abort(); // close the socket without draining the body
    }
  }

  private async pingDeepgram(): Promise<HealthCheck> {
    const url =
      (process.env.DEEPGRAM_LISTEN_URL || 'https://api.eu.deepgram.com/v1/listen');
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    const r = await this.timedFetch(url);
    // Any HTTP response (even 400/401/405) means the endpoint is reachable.
    return {
      key: 'deepgram_reachable',
      label: `Deepgram reachable (${host})`,
      status: r.reachable ? 'ok' : 'error',
      detail: r.reachable
        ? `Reachable — HTTP ${r.status} in ${r.ms}ms.`
        : `Unreachable after ${r.ms}ms: ${r.error}`,
    };
  }

  // ─── on-demand LLM provider probe (real minimal call) ───────────────────────
  // Answers the question env-key presence can't: is each key actually valid, and
  // does the account still have tokens/credit?
  async getProviderConnectivity(): Promise<HealthReport> {
    const checks = await Promise.all(PROVIDER_PROBES.map((p) => this.probeProvider(p)));
    return {
      status: worst(checks.map((c) => c.status)),
      generatedAt: new Date().toISOString(),
      checks,
    };
  }

  private async probeProvider(p: ProviderProbe): Promise<HealthCheck> {
    const apiKey = process.env[p.keyEnv]?.trim();
    if (!apiKey) {
      return {
        key: `provider_${p.key}`,
        label: p.label,
        status: 'warn',
        detail: `${p.keyEnv} not set — provider not configured, skipped.`,
      };
    }
    const { url, init, model } = p.build(apiKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const start = Date.now();
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const body = await res.text().catch(() => '');
      const ms = Date.now() - start;
      const cls = this.classifyLlmResponse(res.status, body);
      return {
        key: `provider_${p.key}`,
        label: p.label,
        status: cls.status,
        detail:
          cls.status === 'ok'
            ? `Key valid — reachable (HTTP ${res.status}, ${ms}ms, model ${model}).`
            : `${cls.summary} (HTTP ${res.status}, ${ms}ms, model ${model}). ${this.shortBody(body)}`.trim(),
      };
    } catch (e) {
      const ms = Date.now() - start;
      return {
        key: `provider_${p.key}`,
        label: p.label,
        status: 'error',
        detail: `Unreachable after ${ms}ms: ${describeError(e)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Map an HTTP status + error body to a health verdict. Detection is
  // best-effort string matching across the four providers' error shapes; quota
  // is checked before invalid-key because an exhausted account can 403.
  private classifyLlmResponse(
    httpStatus: number,
    body: string,
  ): { status: CheckStatus; summary: string } {
    if (httpStatus >= 200 && httpStatus < 300) return { status: 'ok', summary: 'key valid' };

    const outOfQuota =
      /insufficient_quota|insufficient quota|exceeded your current quota|credit balance is too low|resource_exhausted|out of credits|billing_hard_limit|quota exceeded/i.test(
        body,
      );
    if (outOfQuota) return { status: 'error', summary: 'OUT OF TOKENS / quota or credit exhausted' };

    const invalidKey =
      httpStatus === 401 ||
      httpStatus === 403 ||
      /invalid api key|incorrect api key|api key not valid|api_key_invalid|invalid_api_key|authentication_error|permission_denied|unauthorized/i.test(
        body,
      );
    if (invalidKey) return { status: 'error', summary: 'INVALID or expired API key' };

    if (httpStatus === 429) return { status: 'warn', summary: 'rate limited (transient — key looks OK)' };

    return { status: 'warn', summary: `unexpected response HTTP ${httpStatus}` };
  }

  // Compact a provider error body to one short line for the UI detail.
  private shortBody(body: string): string {
    if (!body) return '';
    let msg = body;
    try {
      const j = JSON.parse(body);
      msg = j?.error?.message ?? j?.error?.[0]?.message ?? j?.message ?? j?.error ?? body;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch {
      /* not JSON — use raw */
    }
    msg = msg.replace(/\s+/g, ' ').trim();
    return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
  }

  private async pingRecordingHost(): Promise<HealthCheck> {
    // Probe the newest real recording URL — this is the exact download the batch
    // transcription does, and the one that silently timed out on the prod box.
    let sample: string | null = null;
    try {
      const rows = await this.ds.query<Array<{ url: string }>>(
        `SELECT TOP 1 recordingUrl AS url FROM app.interactions
         WHERE recordingUrl LIKE 'http%' ORDER BY COALESCE(interactionDateTime, createdAt) DESC`,
      );
      sample = rows[0]?.url ?? null;
    } catch {
      /* fall through */
    }
    if (!sample) {
      return {
        key: 'recording_host',
        label: 'Recording host reachable',
        status: 'warn',
        detail: 'No http(s) recordingUrl found to probe.',
      };
    }
    const host = (() => { try { return new URL(sample).host; } catch { return sample!; } })();
    const r = await this.timedFetch(sample);
    return {
      key: 'recording_host',
      label: `Recording host reachable (${host})`,
      status: r.reachable ? 'ok' : 'error',
      detail: r.reachable
        ? `Reachable — HTTP ${r.status} in ${r.ms}ms.`
        : `Unreachable after ${r.ms}ms: ${r.error}. If the recording host runs on this same server, add a hosts-file entry mapping it to 127.0.0.1 (NAT hairpin).`,
    };
  }
}
