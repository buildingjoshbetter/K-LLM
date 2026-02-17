import { describe, it, expect, beforeEach } from "vitest";
import { BudgetTracker } from "../budget.js";

describe("BudgetTracker", () => {
  let budget: BudgetTracker;

  beforeEach(() => {
    budget = new BudgetTracker(0.5, 50000);
  });

  describe("estimateCost", () => {
    it("returns correct cost for known models", () => {
      // Claude Opus 4.6: $30/1M tokens
      expect(budget.estimateCost("anthropic/claude-opus-4-6", 1000)).toBeCloseTo(0.03);
      // DeepSeek V3: $2/1M tokens
      expect(budget.estimateCost("deepseek/deepseek-v3", 1000)).toBeCloseTo(0.002);
      // Llama 4: $1/1M tokens
      expect(budget.estimateCost("meta-llama/llama-4-maverick", 1000)).toBeCloseTo(0.001);
    });

    it("uses $10/1M fallback for unknown models", () => {
      expect(budget.estimateCost("unknown/model", 1000)).toBeCloseTo(0.01);
    });

    it("returns 0 for 0 tokens", () => {
      expect(budget.estimateCost("anthropic/claude-opus-4-6", 0)).toBe(0);
    });
  });

  describe("canAfford", () => {
    it("returns true when under budget", () => {
      expect(budget.canAfford("deepseek/deepseek-v3", 2000)).toBe(true);
    });

    it("returns false when cost would exceed max", () => {
      // $30/1M * 20000 tokens = $0.60, which exceeds $0.50 cap
      expect(budget.canAfford("anthropic/claude-opus-4-6", 20000)).toBe(false);
    });

    it("returns false when tokens would exceed max", () => {
      expect(budget.canAfford("deepseek/deepseek-v3", 60000)).toBe(false);
    });

    it("accounts for previously recorded spending", () => {
      budget.record("deepseek/deepseek-v3", 40000);
      // 40000 already used + 15000 = 55000 > 50000 max
      expect(budget.canAfford("deepseek/deepseek-v3", 15000)).toBe(false);
    });

    it("accounts for previously recorded cost", () => {
      // Record $0.45 of spending
      budget.record("openai/gpt-5.2", 30000); // 30000 * 15/1M = $0.45
      // Another 5000 tokens of GPT-5.2 = $0.075, total $0.525 > $0.50
      expect(budget.canAfford("openai/gpt-5.2", 5000)).toBe(false);
    });
  });

  describe("record", () => {
    it("tracks cumulative cost", () => {
      budget.record("deepseek/deepseek-v3", 1000);
      budget.record("deepseek/deepseek-v3", 1000);
      expect(budget.getSpent()).toBeCloseTo(0.004);
    });

    it("tracks cumulative tokens", () => {
      budget.record("deepseek/deepseek-v3", 1000);
      budget.record("anthropic/claude-opus-4-6", 500);
      expect(budget.getTokensUsed()).toBe(1500);
    });
  });

  describe("boundary conditions", () => {
    it("returns true when under cost limit with headroom", () => {
      // Budget: $0.50 max, 50000 max tokens
      // Record 20000 tokens of DeepSeek ($2/1M) = $0.04
      budget.record("deepseek/deepseek-v3", 20000);
      // Check 10000 more → total 30000 tokens ($0.06), both under limits
      expect(budget.canAfford("deepseek/deepseek-v3", 10000)).toBe(true);
    });

    it("returns false when just over cost limit", () => {
      // Max cost = $0.50. Record $0.49, then check if something pushes over
      // DeepSeek: $2/1M → 245000 tokens = $0.49
      budget.record("deepseek/deepseek-v3", 245000);
      // 10000 tokens of DeepSeek = $0.02, total $0.51 > $0.50
      expect(budget.canAfford("deepseek/deepseek-v3", 10000)).toBe(false);
    });

    it("returns true when exactly at token limit", () => {
      budget.record("deepseek/deepseek-v3", 48000);
      expect(budget.canAfford("deepseek/deepseek-v3", 2000)).toBe(true);
    });

    it("returns false when exceeding both limits", () => {
      budget.record("anthropic/claude-opus-4-6", 15000); // $0.45, 15000 tokens
      // 40000 more tokens of Claude = $1.20 cost, 55000 tokens total
      expect(budget.canAfford("anthropic/claude-opus-4-6", 40000)).toBe(false);
    });

    it("handles very large token counts", () => {
      const cost = budget.estimateCost("deepseek/deepseek-v3", 1_000_000_000);
      expect(cost).toBeCloseTo(2000); // $2/1M * 1B = $2000
    });
  });

  describe("reset", () => {
    it("clears spent and tokens", () => {
      budget.record("anthropic/claude-opus-4-6", 5000);
      expect(budget.getSpent()).toBeGreaterThan(0);
      expect(budget.getTokensUsed()).toBeGreaterThan(0);

      budget.reset();
      expect(budget.getSpent()).toBe(0);
      expect(budget.getTokensUsed()).toBe(0);
    });
  });
});
