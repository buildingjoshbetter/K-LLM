/**
 * OpenClaw Skill Integration for X-LLM
 *
 * This module exports the consensus engine as an OpenClaw-compatible skill.
 * Install by copying the openclaw-skill/ directory to your OpenClaw skills folder
 * or by running: openclaw skills install ./openclaw-skill
 */

import { initProvider } from "../models/provider.js";
import { runConsensus } from "../engine/pipeline.js";
import type { Config } from "../models/types.js";

export interface SkillInput {
  prompt: string;
  apiKey?: string;
  verbose?: boolean;
}

export interface SkillOutput {
  consensus: string;
  analyses?: Array<{
    role: string;
    label: string;
    model: string;
    content: string;
  }>;
  meta: {
    totalTokens: number;
    totalDurationMs: number;
    estimatedCost: number;
  };
}

export async function handleConsensus(
  input: SkillInput,
  config: Config
): Promise<SkillOutput> {
  const key = input.apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "No OpenRouter API key. Please provide your key:\n" +
        "  Get one at: https://openrouter.ai/keys\n" +
        "  Then say: set my OpenRouter key to sk-or-..."
    );
  }

  initProvider(key);

  const result = await runConsensus(input.prompt, config);

  const output: SkillOutput = {
    consensus: result.synthesis.content,
    meta: {
      totalTokens: result.totalTokens,
      totalDurationMs: result.totalDurationMs,
      estimatedCost: result.estimatedCost,
    },
  };

  if (input.verbose) {
    output.analyses = result.analyses.map((a) => ({
      role: a.role,
      label: a.label,
      model: a.model,
      content: a.content,
    }));
  }

  return output;
}
