import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleConsensus, type SkillInput } from "../skill.js";
import type { Config } from "../../models/types.js";

// Mock provider
vi.mock("../../models/provider.js", () => ({
  initProvider: vi.fn(),
}));

// Mock pipeline
vi.mock("../../engine/pipeline.js", () => ({
  runConsensus: vi.fn().mockResolvedValue({
    prompt: "test prompt",
    analyses: [
      {
        role: "critic",
        label: "The Critic",
        icon: "🔍",
        model: "anthropic/claude-opus-4-6",
        content: "Critical analysis",
        tokensUsed: 400,
        durationMs: 1200,
      },
    ],
    synthesis: {
      content: "Synthesized answer",
      tokensUsed: 800,
      durationMs: 2000,
    },
    totalTokens: 1200,
    totalDurationMs: 3200,
    estimatedCost: 0.15,
  }),
}));

import { initProvider } from "../../models/provider.js";
import { runConsensus } from "../../engine/pipeline.js";

const mockInitProvider = initProvider as ReturnType<typeof vi.fn>;
const mockRunConsensus = runConsensus as ReturnType<typeof vi.fn>;

const testConfig: Config = {
  analysts: {
    critic: {
      model: "anthropic/claude-opus-4-6",
      maxTokens: 2000,
      label: "The Critic",
      icon: "🔍",
      description: "Finds flaws",
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

describe("OpenClaw skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("throws if no API key provided", async () => {
    const input: SkillInput = { prompt: "test" };
    await expect(handleConsensus(input, testConfig)).rejects.toThrow(
      "No OpenRouter API key"
    );
  });

  it("uses apiKey from input", async () => {
    const input: SkillInput = { prompt: "test", apiKey: "sk-test-123" };
    await handleConsensus(input, testConfig);
    expect(mockInitProvider).toHaveBeenCalledWith("sk-test-123");
  });

  it("uses env API key as fallback", async () => {
    process.env.OPENROUTER_API_KEY = "sk-env-key";
    const input: SkillInput = { prompt: "test" };
    await handleConsensus(input, testConfig);
    expect(mockInitProvider).toHaveBeenCalledWith("sk-env-key");
  });

  it("returns consensus without analyses by default", async () => {
    const input: SkillInput = { prompt: "test", apiKey: "sk-test" };
    const output = await handleConsensus(input, testConfig);

    expect(output.consensus).toBe("Synthesized answer");
    expect(output.analyses).toBeUndefined();
    expect(output.meta.totalTokens).toBe(1200);
    expect(output.meta.totalDurationMs).toBe(3200);
    expect(output.meta.estimatedCost).toBe(0.15);
  });

  it("includes analyses when verbose is true", async () => {
    const input: SkillInput = { prompt: "test", apiKey: "sk-test", verbose: true };
    const output = await handleConsensus(input, testConfig);

    expect(output.analyses).toBeDefined();
    expect(output.analyses).toHaveLength(1);
    expect(output.analyses![0].role).toBe("critic");
    expect(output.analyses![0].content).toBe("Critical analysis");
  });

  it("calls runConsensus with correct arguments", async () => {
    const input: SkillInput = { prompt: "my question", apiKey: "sk-test" };
    await handleConsensus(input, testConfig);

    expect(mockRunConsensus).toHaveBeenCalledWith("my question", testConfig);
  });
});
