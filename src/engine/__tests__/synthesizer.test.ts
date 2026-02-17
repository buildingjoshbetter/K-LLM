import { describe, it, expect, vi, beforeEach } from "vitest";
import { synthesize, type SynthesizerOptions } from "../synthesizer.js";
import { RateLimiter } from "../../ratelimit/limiter.js";
import { BudgetTracker } from "../../ratelimit/budget.js";
import type { AnalystResult, SynthesizerConfig } from "../../models/types.js";

// Mock callModel
vi.mock("../../models/provider.js", () => ({
  callModel: vi.fn().mockResolvedValue({
    content: "## Consensus Response\nSynthesized answer.",
    tokensUsed: 1200,
  }),
}));

vi.mock("../../roles/index.js", () => ({
  SYNTHESIS_SYSTEM_PROMPT: "You are the synthesizer.",
}));

import { callModel } from "../../models/provider.js";

const mockCallModel = callModel as ReturnType<typeof vi.fn>;

function makeAnalystResult(overrides?: Partial<AnalystResult>): AnalystResult {
  return {
    role: "critic",
    label: "The Critic",
    icon: "🔍",
    model: "anthropic/claude-opus-4-6",
    content: "There are significant risks here.",
    tokensUsed: 400,
    durationMs: 1500,
    ...overrides,
  };
}

const synthConfig: SynthesizerConfig = {
  model: "openai/gpt-5.2-pro",
  maxTokens: 4000,
  label: "Synthesizer",
  description: "Cross-family synthesis",
};

describe("synthesizer", () => {
  let rateLimiter: RateLimiter;
  let budget: BudgetTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter = new RateLimiter(10, 30);
    budget = new BudgetTracker(1.0, 100000);
  });

  it("returns synthesized content and token count", async () => {
    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const result = await synthesize("test prompt", [makeAnalystResult()], opts);

    expect(result.content).toContain("Consensus Response");
    expect(result.tokensUsed).toBe(1200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("builds synthesis prompt with all analyst responses", async () => {
    const analyses = [
      makeAnalystResult({ role: "critic", label: "The Critic", icon: "🔍", content: "risk A" }),
      makeAnalystResult({ role: "strategist", label: "The Strategist", icon: "📐", content: "framework B" }),
    ];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await synthesize("original question", analyses, opts);

    const callArgs = mockCallModel.mock.calls[0];
    const userPrompt: string = callArgs[2];

    expect(userPrompt).toContain("## Original Prompt");
    expect(userPrompt).toContain("original question");
    expect(userPrompt).toContain("🔍 The Critic");
    expect(userPrompt).toContain("risk A");
    expect(userPrompt).toContain("📐 The Strategist");
    expect(userPrompt).toContain("framework B");
  });

  it("calls callModel with synthesis system prompt", async () => {
    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await synthesize("test", [makeAnalystResult()], opts);

    expect(mockCallModel).toHaveBeenCalledWith(
      "openai/gpt-5.2-pro",
      "You are the synthesizer.",
      expect.any(String),
      4000
    );
  });

  it("handles API errors gracefully", async () => {
    mockCallModel.mockRejectedValueOnce(new Error("timeout"));

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const result = await synthesize("test", [makeAnalystResult()], opts);

    expect(result.content).toBe("[Synthesis error: timeout]");
    expect(result.tokensUsed).toBe(0);
  });

  it("fires onProgress callbacks in order", async () => {
    const events: string[] = [];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
      onProgress: (status) => events.push(status),
    };

    await synthesize("test", [makeAnalystResult()], opts);

    expect(events).toEqual(["start", "done"]);
  });

  it("records tokens in budget", async () => {
    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await synthesize("test", [makeAnalystResult()], opts);

    expect(budget.getTokensUsed()).toBe(1200);
  });

  it("includes model name in synthesis prompt per analyst", async () => {
    const analyses = [
      makeAnalystResult({ model: "anthropic/claude-opus-4-6" }),
    ];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await synthesize("test", analyses, opts);

    const userPrompt: string = mockCallModel.mock.calls[0][2];
    expect(userPrompt).toContain("anthropic/claude-opus-4-6");
  });

  it("returns early when all analyses are skipped", async () => {
    const analyses = [
      makeAnalystResult({ content: "[Skipped: budget exceeded]", tokensUsed: 0 }),
      makeAnalystResult({ role: "strategist", content: "[Skipped: budget exceeded]", tokensUsed: 0 }),
    ];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const result = await synthesize("test", analyses, opts);

    expect(result.content).toBe("[Synthesis error: No valid analyst responses to synthesize]");
    expect(result.tokensUsed).toBe(0);
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("returns early when all analyses are errors", async () => {
    const analyses = [
      makeAnalystResult({ content: "[Error: API rate limit]", tokensUsed: 0 }),
      makeAnalystResult({ role: "strategist", content: "[Error: timeout]", tokensUsed: 0 }),
    ];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const result = await synthesize("test", analyses, opts);

    expect(result.content).toBe("[Synthesis error: No valid analyst responses to synthesize]");
    expect(result.tokensUsed).toBe(0);
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("filters out skipped analyses but synthesizes valid ones", async () => {
    const analyses = [
      makeAnalystResult({ role: "critic", content: "Good analysis here" }),
      makeAnalystResult({ role: "strategist", content: "[Skipped: budget exceeded]", tokensUsed: 0 }),
    ];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await synthesize("test", analyses, opts);

    expect(mockCallModel).toHaveBeenCalledOnce();
    const userPrompt: string = mockCallModel.mock.calls[0][2];
    expect(userPrompt).toContain("Good analysis here");
    expect(userPrompt).not.toContain("[Skipped:");
  });

  it("filters out errored analyses but synthesizes valid ones", async () => {
    const analyses = [
      makeAnalystResult({ role: "critic", content: "[Error: timeout]", tokensUsed: 0 }),
      makeAnalystResult({ role: "strategist", content: "Strategic insight" }),
    ];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    await synthesize("test", analyses, opts);

    expect(mockCallModel).toHaveBeenCalledOnce();
    const userPrompt: string = mockCallModel.mock.calls[0][2];
    expect(userPrompt).toContain("Strategic insight");
    expect(userPrompt).not.toContain("[Error:");
  });

  it("returns early for empty analyses array", async () => {
    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const result = await synthesize("test", [], opts);

    expect(result.content).toBe("[Synthesis error: No valid analyst responses to synthesize]");
    expect(result.tokensUsed).toBe(0);
    expect(mockCallModel).not.toHaveBeenCalled();
  });

  it("fires onProgress even when returning early with no valid analyses", async () => {
    const events: string[] = [];

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
      onProgress: (status) => events.push(status),
    };

    await synthesize("test", [], opts);

    expect(events).toContain("start");
    expect(events).toContain("done");
  });

  it("handles non-Error throws gracefully", async () => {
    mockCallModel.mockRejectedValueOnce("string rejection");

    const opts: SynthesizerOptions = {
      config: synthConfig,
      rateLimiter,
      budget,
      perModelRpm: 10,
    };

    const result = await synthesize("test", [makeAnalystResult()], opts);

    expect(result.content).toBe("[Synthesis error: string rejection]");
    expect(result.tokensUsed).toBe(0);
  });
});
