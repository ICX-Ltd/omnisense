import OpenAI from 'openai';
import {
  InsightsProvider,
  InsightsProviderResult,
} from './insights-provider.interface';

export class GrokProvider implements InsightsProvider {
  // maxRetries lets the SDK ride out 429s on its own: it honors the Retry-After
  // header with exponential backoff. Higher than the SDK default (2) so a
  // saturated batch survives short rate-limit windows. Tunable via env.
  private client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
    maxRetries: parseInt(process.env.XAI_MAX_RETRIES ?? '6', 10) || 6,
  });

  private readonly model: string;

  // Per-run override (batch UI) → GROK_INSIGHTS_MODEL env → fast default.
  constructor(model?: string) {
    this.model = model?.trim() || process.env.GROK_INSIGHTS_MODEL || 'grok-4-1-fast-non-reasoning';
  }

  async extract(prompt: string): Promise<InsightsProviderResult> {
    const resp = await this.client.responses.create({
      model: this.model,
      input: prompt,
      temperature: 0.1,
    });

    // x.ai's OpenAI-compatible surface doesn't reliably support json_object mode,
    // so we lean on cleanJsonText salvage + retry instead. Still flag truncation.
    return {
      text: (resp.output_text ?? '').trim(),
      model: this.model,
      provider: 'grok',
      truncated: resp.status === 'incomplete',
      usage: {
        inputTokens: resp.usage?.input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
      },
    };
  }
}
