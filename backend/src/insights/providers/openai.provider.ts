import OpenAI from 'openai';
import {
  InsightsProvider,
  InsightsProviderResult,
} from './insights-provider.interface';

export class OpenAIProvider implements InsightsProvider {
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  private readonly model = 'gpt-4o-mini';

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
