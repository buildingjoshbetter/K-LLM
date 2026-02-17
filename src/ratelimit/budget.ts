// Approximate cost per 1M tokens by provider (input + output blended)
const COST_PER_MILLION: Record<string, number> = {
  "anthropic/claude-opus-4-6": 30.0,
  "openai/gpt-5.2": 15.0,
  "openai/gpt-5.2-pro": 30.0,
  "deepseek/deepseek-v3": 2.0,
  "meta-llama/llama-4-maverick": 1.0,
  "google/gemini-2.5-pro": 7.0,
};

export class BudgetTracker {
  private spent: number = 0;
  private tokensUsed: number = 0;
  private maxCost: number;
  private maxTokens: number;

  constructor(maxCostPerCycle: number, maxTokensPerCycle: number) {
    this.maxCost = maxCostPerCycle;
    this.maxTokens = maxTokensPerCycle;
  }

  estimateCost(model: string, tokens: number): number {
    const rate = COST_PER_MILLION[model] ?? 10.0;
    return (tokens / 1_000_000) * rate;
  }

  canAfford(model: string, estimatedTokens: number): boolean {
    const cost = this.estimateCost(model, estimatedTokens);
    return (
      this.spent + cost <= this.maxCost &&
      this.tokensUsed + estimatedTokens <= this.maxTokens
    );
  }

  record(model: string, tokens: number): void {
    const cost = this.estimateCost(model, tokens);
    this.spent += cost;
    this.tokensUsed += tokens;
  }

  getSpent(): number {
    return this.spent;
  }

  getTokensUsed(): number {
    return this.tokensUsed;
  }

  reset(): void {
    this.spent = 0;
    this.tokensUsed = 0;
  }
}
