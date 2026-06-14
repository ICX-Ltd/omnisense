export interface InsightsProviderResult {
  text: string;
  model: string;
  provider: string;
  /**
   * True when the model stopped because it hit the output-token ceiling, so the
   * JSON is almost certainly truncated mid-structure. Lets the extraction layer
   * retry (re-roll) rather than persist a partial/invalid record.
   */
  truncated?: boolean;
  /** Token usage for this single call, for cost tracking. */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface InsightsProvider {
  extract(prompt: string): Promise<InsightsProviderResult>;
}
