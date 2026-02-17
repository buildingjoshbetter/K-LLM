import { describe, it, expect, vi, beforeEach } from "vitest";
import { distribute, type DistributorOptions } from "../distributor.js";
import { RateLimiter } from "../../ratelimit/limiter.js";
import { BudgetTracker } from "../../ratelimit/budget.js";
import type { AnalystConfig } from "../../models/types.js";

// Mock callModel
vi.mock("../../models/provider.js", () => ({
  callModel: vi.fn().mockResolvedValue({
    content: "Mock analysis",
    tokensUsed: 500,
  }),
}));

// Mock role prompts
vi.mock("../../roles/index.js", () => ({
  ROLE_PROMPTS: {
    critic: "You are the critic.",
    strategist: "You are the strategist.",
  },
}));

import { callModel } from "../../models/provider.js";

const mockCallModel = callModel as ReturnType<typeof vi.fn>;

function makeAnalystConfig(overrides?: Partial<AnalystConfig>): AnalystConfig {
  return {
    model: "test/model",
    maxTokens: 2000,
    label: "Test Analyst",
    icon: "🧪",
    description: "Test analyst",
    ...overrides,
  };
}

describe("distributor", () => {
  let rateLimiter: RateLimiter;
  let budget: BudgetTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter = new RateLimiter(10, 30);
    budget = new BudgetTracker(1.0, 100000);
  });

  it("runs all analysts in parallel and returns results", async () => {
    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig({ label: "The Critic", icon: "🔍" }),
        strategist: makeAnalystConfig({ label: "The Strategist", icon: "📐" }),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const results = await distribute("test prompt", opts);

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("Mock analysis");
    expect(results[0].tokensUsed).toBe(500);
    expect(results[0].role).toBe("critic");
    expect(results[1].role).toBe("strategist");
  });

  it("calls callModel with correct arguments", async () => {
    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig({
          model: "anthropic/claude-opus-4-6",
          maxTokens: 2000,
        }),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await distribute("my prompt", opts);

    expect(mockCallModel).toHaveBeenCalledWith(
      "anthropic/claude-opus-4-6",
      "You are the critic.",
      "my prompt",
      2000
    );
  });

  it("uses fallback prompt for unknown roles", async () => {
    const opts: DistributorOptions = {
      analysts: {
        unknown_role: makeAnalystConfig(),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await distribute("test", opts);

    expect(mockCallModel).toHaveBeenCalledWith(
      "test/model",
      "Analyze the following prompt.",
      "test",
      2000
    );
  });

  it("skips analyst when budget is exceeded", async () => {
    const tightBudget = new BudgetTracker(0.001, 100);

    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig({
          model: "anthropic/claude-opus-4-6",
          maxTokens: 2000,
        }),
      },
      rateLimiter,
      budget: tightBudget,
      perModelRpm: 10,
    };

    const results = await distribute("test", opts);

    expect(results[0].content).toBe("[Skipped: budget exceeded]");
    expect(results[0].tokensUsed).toBe(0);
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("handles callModel errors gracefully", async () => {
    mockCallModel.mockRejectedValueOnce(new Error("API rate limit"));

    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig(),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const results = await distribute("test", opts);

    expect(results[0].content).toBe("[Error: API rate limit]");
    expect(results[0].tokensUsed).toBe(0);
  });

  it("handles non-Error throws gracefully", async () => {
    mockCallModel.mockRejectedValueOnce("string error");

    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig(),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const results = await distribute("test", opts);
    expect(results[0].content).toBe("[Error: string error]");
  });

  it("fires onProgress callbacks", async () => {
    const progress: Array<[string, string]> = [];

    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig(),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
      onProgress: (role, status) => progress.push([role, status]),
    };

    await distribute("test", opts);

    expect(progress).toEqual([
      ["critic", "start"],
      ["critic", "done"],
    ]);
  });

  it("records tokens in budget after successful call", async () => {
    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig({ model: "deepseek/deepseek-v3" }),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await distribute("test", opts);

    expect(budget.getTokensUsed()).toBe(500);
    expect(budget.getSpent()).toBeGreaterThan(0);
  });

  it("populates durationMs for each result", async () => {
    const opts: DistributorOptions = {
      analysts: {
        critic: makeAnalystConfig(),
      },
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const results = await distribute("test", opts);
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
