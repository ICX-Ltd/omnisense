import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  InsightsProvider,
  InsightsProviderResult,
} from './insights-provider.interface';

export class AnthropicProvider implements InsightsProvider {
  private readonly logger = new Logger(AnthropicProvider.name);

  private client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  private readonly model = 'claude-haiku-4-5';

  // Full call insights JSON (13 operations dimensions + coaching + client
  // services + the campaign Q&A blob for campaigns like Parity) can run well
  // past 8k tokens. Cap high enough that the model never truncates mid-JSON —
  // it only bills for tokens actually generated, so the ceiling is free.
  private readonly maxTokens = 16000;

  async extract(prompt: string): Promise<InsightsProviderResult> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    });

    // If the model stopped because it hit the token ceiling the JSON is
    // truncated — surface that explicitly rather than letting it fail later as
    // a generic "invalid JSON".
    if (resp.stop_reason === 'max_tokens') {
      this.logger.warn(
        `Response hit max_tokens (${this.maxTokens}) and was truncated — ` +
          `insights JSON will be incomplete. Consider raising maxTokens.`,
      );
    }

    const firstBlock = resp.content[0];
    const text = firstBlock && 'text' in firstBlock ? firstBlock.text : '';

    return {
      text: text.trim(),
      model: this.model,
      provider: 'anthropic',
    };
  }
}
