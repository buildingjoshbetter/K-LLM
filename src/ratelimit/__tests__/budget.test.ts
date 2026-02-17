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
