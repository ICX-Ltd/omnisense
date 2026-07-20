import OpenAI from 'openai';
import {
  InsightsProvider,
  InsightsProviderResult,
} from './insights-provider.interface';

export class OpenAIProvider implements InsightsProvider {
  // maxRetries lets the SDK ride out 429s (tokens-per-minute cap) on its own:
  // it honors the Retry-After header with exponential backoff. The account's
  // TPM tier is low, so a saturated batch needs more than the SDK default (2)
  // to survive the short retry windows. Tunable via env without a redeploy.
  private client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES ?? '6', 10) || 6,
  });
  private readonly model: string;

  // Model resolves in priority order: explicit per-run override (from the batch
  // UI) → OPENAI_INSIGHTS_MODEL env → the fast default. Lets the operator pick a
  // higher-quality model (e.g. gpt-4o) for a run without a redeploy.
  constructor(model?: string) {
    this.model = model?.trim() || process.env.OPENAI_INSIGHTS_MODEL || 'gpt-4o-mini';
  }

  async extract(prompt: string): Promise<InsightsProviderResult> {
    const resp = await this.client.responses.create({
      model: this.model,
      input: prompt,
      temperature: 0.1,
      // Structured output: force a syntactically valid JSON object so the model
      // can't wrap it in prose or markdown fences.
      text: { format: { type: 'json_object' } },
    });

    return {
      text: (resp.output_text ?? '').trim(),
      model: this.model,
      provider: 'openai',
      truncated: resp.status === 'incomplete',
      usage: {
        inputTokens: resp.usage?.input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
      },
    };
  }
}
