import OpenAI from 'openai';
import {
  InsightsProvider,
  InsightsProviderResult,
} from './insights-provider.interface';

export class GrokProvider implements InsightsProvider {
  private client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
  });

  private readonly model = 'grok-4-1-fast-non-reasoning';

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
