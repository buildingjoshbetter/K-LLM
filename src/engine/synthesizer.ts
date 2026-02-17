import { callModel } from "../models/provider.js";
import { SYNTHESIS_SYSTEM_PROMPT } from "../roles/index.js";
import { RateLimiter } from "../ratelimit/limiter.js";
import { BudgetTracker } from "../ratelimit/budget.js";
import type { AnalystResult, SynthesizerConfig, SynthesisResult } from "../models/types.js";

export interface SynthesizerOptions {
  config: SynthesizerConfig;
  rateLimiter: RateLimiter;
  budget: BudgetTracker;
  perModelRpm: number;
  onProgress?: (status: "start" | "done", durationMs?: number) => void;
}

function buildSynthesisPrompt(
  originalPrompt: string,
  analyses: AnalystResult[]
): string {
  let prompt = `## Original Prompt\n${originalPrompt}\n\n## Analyst Responses\n\n`;
  for (const a of analyses) {
    prompt += `### ${a.icon} ${a.label} (${a.model})\n${a.content}\n\n`;
  }
  return prompt;
}

export async function synthesize(
  originalPrompt: string,
  analyses: AnalystResult[],
  opts: SynthesizerOptions
): Promise<SynthesisResult> {
  opts.onProgress?.("start");
  const start = Date.now();

  const validAnalyses = analyses.filter(
    (a) => a.content && !a.content.startsWith("[Skipped:") && !a.content.startsWith("[Error:")
  );

  if (validAnalyses.length === 0) {
    const durationMs = Date.now() - start;
    opts.onProgress?.("done", durationMs);
    return {
      content: "[Synthesis error: No valid analyst responses to synthesize]",
      tokensUsed: 0,
      durationMs,
    };
  }

  await opts.rateLimiter.acquire(opts.config.model, opts.perModelRpm);

  const userPrompt = buildSynthesisPrompt(originalPrompt, validAnalyses);

  try {
    const { content, tokensUsed } = await callModel(
      opts.config.model,
      SYNTHESIS_SYSTEM_PROMPT,
      userPrompt,
      opts.config.maxTokens
    );

    opts.budget.record(opts.config.model, tokensUsed);
    const durationMs = Date.now() - start;
    opts.onProgress?.("done", durationMs);

    return { content, tokensUsed, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    opts.onProgress?.("done", durationMs);
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `[Synthesis error: ${message}]`,
      tokensUsed: 0,
      durationMs,
    };
  }
}
