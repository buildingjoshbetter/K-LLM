import { callModel } from "../models/provider.js";
import { ROLE_PROMPTS } from "../roles/index.js";
import { RateLimiter } from "../ratelimit/limiter.js";
import { BudgetTracker } from "../ratelimit/budget.js";
import type { AnalystConfig, AnalystResult } from "../models/types.js";

export interface DistributorOptions {
  analysts: Record<string, AnalystConfig>;
  rateLimiter: RateLimiter;
  budget: BudgetTracker;
  perModelRpm: number;
  onProgress?: (role: string, status: "start" | "done", durationMs?: number) => void;
}

async function runAnalyst(
  role: string,
  config: AnalystConfig,
  prompt: string,
  opts: DistributorOptions
): Promise<AnalystResult> {
  opts.onProgress?.(role, "start");
  const start = Date.now();

  await opts.rateLimiter.acquire(config.model, opts.perModelRpm);

  if (!opts.budget.canAfford(config.model, config.maxTokens)) {
    const durationMs = Date.now() - start;
    opts.onProgress?.(role, "done", durationMs);
    return {
      role,
      label: config.label,
      icon: config.icon,
      model: config.model,
      content: "[Skipped: budget exceeded]",
      tokensUsed: 0,
      durationMs,
    };
  }

  const systemPrompt = ROLE_PROMPTS[role] ?? "Analyze the following prompt.";

  try {
    const { content, tokensUsed } = await callModel(
      config.model,
      systemPrompt,
      prompt,
      config.maxTokens
    );

    opts.budget.record(config.model, tokensUsed);
    const durationMs = Date.now() - start;
    opts.onProgress?.(role, "done", durationMs);

    return {
      role,
      label: config.label,
      icon: config.icon,
      model: config.model,
      content,
      tokensUsed,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    opts.onProgress?.(role, "done", durationMs);
    const message = err instanceof Error ? err.message : String(err);
    return {
      role,
      label: config.label,
      icon: config.icon,
      model: config.model,
      content: `[Error: ${message}]`,
      tokensUsed: 0,
      durationMs,
    };
  }
}

export async function distribute(
  prompt: string,
  opts: DistributorOptions
): Promise<AnalystResult[]> {
  const entries = Object.entries(opts.analysts);
  const promises = entries.map(([role, config]) =>
    runAnalyst(role, config, prompt, opts)
  );
  return Promise.all(promises);
}
