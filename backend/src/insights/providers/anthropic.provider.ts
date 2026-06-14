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
  // past 16k tokens. Cap high enough that the model never truncates mid-JSON —
  // it only bills for tokens actually generated, so the ceiling is effectively
  // free. Haiku 4.5's output ceiling is 64k; tunable via env.
  private readonly maxTokens =
    parseInt(process.env.ANTHROPIC_INSIGHTS_MAX_TOKENS ?? '32000', 10) || 32000;

  async extract(prompt: string): Promise<InsightsProviderResult> {
    // Stream: above ~16k max_tokens a single non-streamed request risks an SDK
    // HTTP timeout, and we want the headroom. finalMessage() reassembles the
    // full message once the stream completes.
    const resp = await this.client.messages
      .stream({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      })
      .finalMessage();

    // Hit the token ceiling → JSON is truncated. Flag it so the extraction
    // layer re-rolls instead of failing later as a generic "invalid JSON".
    const truncated = resp.stop_reason === 'max_tokens';
    if (truncated) {
      this.logger.warn(
        `Response hit max_tokens (${this.maxTokens}) and was truncated — ` +
          `insights JSON is incomplete; extraction will retry.`,
      );
    }

    const firstBlock = resp.content[0];
    const text = firstBlock && 'text' in firstBlock ? firstBlock.text : '';

    return {
      text: text.trim(),
      model: this.model,
      provider: 'anthropic',
      truncated,
      usage: {
        inputTokens: resp.usage?.input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
      },
    };
  }
}
