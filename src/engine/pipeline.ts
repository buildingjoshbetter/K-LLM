import { distribute } from "./distributor.js";
import { synthesize } from "./synthesizer.js";
import { RateLimiter } from "../ratelimit/limiter.js";
import { BudgetTracker } from "../ratelimit/budget.js";
import type { Config, ConsensusResult } from "../models/types.js";

export interface PipelineCallbacks {
  onAnalystStart?: (role: string) => void;
  onAnalystDone?: (role: string, durationMs: number) => void;
  onSynthesisStart?: () => void;
  onSynthesisDone?: (durationMs: number) => void;
}

export async function runConsensus(
  prompt: string,
  config: Config,
  callbacks?: PipelineCallbacks
): Promise<ConsensusResult> {
  const pipelineStart = Date.now();

  const rateLimiter = new RateLimiter(
    config.rateLimits.perModelRpm,
    config.rateLimits.globalRpm
  );

  const budget = new BudgetTracker(
    config.rateLimits.maxCostPerCycle,
    config.rateLimits.maxTokensPerCycle
  );

  // Phase 1: Distribute to all 5 analysts in parallel
  const analyses = await distribute(prompt, {
    analysts: config.analysts,
    rateLimiter,
    budget,
    perModelRpm: config.rateLimits.perModelRpm,
    onProgress: (role, status, durationMs) => {
      if (status === "start") callbacks?.onAnalystStart?.(role);
      if (status === "done" && durationMs !== undefined)
        callbacks?.onAnalystDone?.(role, durationMs);
    },
  });

  // Phase 2: Synthesize all analyses through condenser model
  const synthesis = await synthesize(prompt, analyses, {
    config: config.synthesizer,
    rateLimiter,
    budget,
    perModelRpm: config.rateLimits.perModelRpm,
    onProgress: (status, durationMs) => {
      if (status === "start") callbacks?.onSynthesisStart?.();
      if (status === "done" && durationMs !== undefined)
        callbacks?.onSynthesisDone?.(durationMs);
    },
  });

  const totalTokens =
    analyses.reduce((sum, a) => sum + a.tokensUsed, 0) + synthesis.tokensUsed;

  return {
    prompt,
    analyses,
    synthesis,
    totalTokens,
    totalDurationMs: Date.now() - pipelineStart,
    estimatedCost: budget.getSpent(),
  };
}
