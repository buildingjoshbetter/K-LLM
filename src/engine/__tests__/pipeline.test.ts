import { describe, it, expect, vi, beforeEach } from "vitest";
import { runConsensus, type PipelineCallbacks } from "../pipeline.js";
import type { Config } from "../../models/types.js";

// Mock distribute and synthesize
vi.mock("../distributor.js", () => ({
  distribute: vi.fn().mockResolvedValue([
    {
      role: "critic",
      label: "The Critic",
      icon: "🔍",
      model: "anthropic/claude-opus-4-6",
      content: "Critical analysis",
      tokensUsed: 400,
      durationMs: 1200,
    },
    {
      role: "strategist",
      label: "The Strategist",
      icon: "📐",
      model: "openai/gpt-5.2",
      content: "Strategic analysis",
      tokensUsed: 350,
      durationMs: 1100,
    },
  ]),
}));

vi.mock("../synthesizer.js", () => ({
  synthesize: vi.fn().mockResolvedValue({
    content: "Synthesized consensus response",
    tokensUsed: 800,
    durationMs: 2000,
  }),
}));

import { distribute } from "../distributor.js";
import { synthesize } from "../synthesizer.js";

const mockDistribute = distribute as ReturnType<typeof vi.fn>;
const mockSynthesize = synthesize as ReturnType<typeof vi.fn>;

const testConfig: Config = {
  analysts: {
    critic: {
      model: "anthropic/claude-opus-4-6",
      maxTokens: 2000,
      label: "The Critic",
      icon: "🔍",
      description: "Finds flaws",
    },
    strategist: {
      model: "openai/gpt-5.2",
      maxTokens: 2000,
      label: "The Strategist",
      icon: "📐",
      description: "Big picture",
    },
  },
  synthesizer: {
    model: "openai/gpt-5.2-pro",
    maxTokens: 4000,
    label: "Synthesizer",
    description: "Cross-family synthesis",
  },
  rateLimits: {
    perModelRpm: 10,
    globalRpm: 30,
    maxTokensPerCycle: 50000,
    maxCostPerCycle: 0.5,
  },
  output: {
    showIndividualAnalyses: false,
    showCostBreakdown: true,
    showTimings: true,
  },
};

describe("pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a complete ConsensusResult", async () => {
    const result = await runConsensus("test prompt", testConfig);

    expect(result.prompt).toBe("test prompt");
    expect(result.analyses).toHaveLength(2);
    expect(result.synthesis.content).toBe("Synthesized consensus response");
    expect(result.totalTokens).toBe(1550); // 400 + 350 + 800
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.estimatedCost).toBeGreaterThanOrEqual(0);
  });

  it("calls distribute with correct config", async () => {
    await runConsensus("my prompt", testConfig);

    expect(mockDistribute).toHaveBeenCalledOnce();
    const [prompt, opts] = mockDistribute.mock.calls[0];
    expect(prompt).toBe("my prompt");
    expect(opts.analysts).toBe(testConfig.analysts);
    expect(opts.perModelRpm).toBe(10);
  });

  it("passes analyst results to synthesize", async () => {
    await runConsensus("test", testConfig);

    expect(mockSynthesize).toHaveBeenCalledOnce();
    const [prompt, analyses] = mockSynthesize.mock.calls[0];
    expect(prompt).toBe("test");
    expect(analyses).toHaveLength(2);
    expect(analyses[0].role).toBe("critic");
  });

  it("sums tokens across all analysts and synthesis", async () => {
    const result = await runConsensus("test", testConfig);
    expect(result.totalTokens).toBe(400 + 350 + 800);
  });

  it("fires callbacks in correct order", async () => {
    const events: string[] = [];

    // Override mocks to fire onProgress immediately
    mockDistribute.mockImplementation(async (_prompt: string, opts: any) => {
      opts.onProgress?.("critic", "start");
      opts.onProgress?.("critic", "done", 100);
      return [
        {
          role: "critic",
          label: "The Critic",
          icon: "🔍",
          model: "test",
          content: "test",
          tokensUsed: 100,
          durationMs: 100,
        },
      ];
    });

    mockSynthesize.mockImplementation(async (_prompt: string, _analyses: any, opts: any) => {
      opts.onProgress?.("start");
      opts.onProgress?.("done", 200);
      return { content: "synth", tokensUsed: 200, durationMs: 200 };
    });

    const callbacks: PipelineCallbacks = {
      onAnalystStart: (role) => events.push(`analyst:start:${role}`),
      onAnalystDone: (role) => events.push(`analyst:done:${role}`),
      onSynthesisStart: () => events.push("synthesis:start"),
      onSynthesisDone: () => events.push("synthesis:done"),
    };

    await runConsensus("test", testConfig, callbacks);

    expect(events).toEqual([
      "analyst:start:critic",
      "analyst:done:critic",
      "synthesis:start",
      "synthesis:done",
    ]);
  });

});
