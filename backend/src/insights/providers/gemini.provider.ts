import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  InsightsProvider,
  InsightsProviderResult,
} from './insights-provider.interface';

export class GeminiProvider implements InsightsProvider {
  private client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  private readonly model = 'gemini-1.5-flash';

  async extract(prompt: string): Promise<InsightsProviderResult> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      // Structured output: native JSON mode.
      generationConfig: { responseMimeType: 'application/json' },
    });

    const resp = await model.generateContent(prompt);

    const text = resp.response.text();
    const truncated =
      resp.response.candidates?.[0]?.finishReason === 'MAX_TOKENS';
    const um = resp.response.usageMetadata;

    return {
      text: text.trim(),
      model: this.model,
      provider: 'gemini',
      truncated,
      usage: {
        inputTokens: um?.promptTokenCount ?? 0,
        outputTokens: um?.candidatesTokenCount ?? 0,
      },
    };
  }
}
