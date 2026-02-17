/**
 * OpenClaw Skill Handler for K-LLM
 *
 * This is the entry point that OpenClaw calls when the skill is triggered.
 * It wraps the core consensus engine with OpenClaw's skill interface.
 */

import * as fs from "fs";
import * as path from "path";
import { handleConsensus } from "../src/openclaw/skill.js";
import type { Config } from "../src/models/types.js";

interface OpenClawSkillContext {
  params: {
    prompt?: string;
    verbose?: boolean;
  };
  env: Record<string, string>;
  reply: (message: string) => Promise<void>;
}

function loadConfig(): Config {
  const configPath = path.resolve(__dirname, "..", "config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

export default async function handler(ctx: OpenClawSkillContext): Promise<void> {
  const { prompt, verbose } = ctx.params;

  if (!prompt) {
    await ctx.reply(
      "Hey! I'm K-LLM, a multi-model consensus engine.\n\n" +
        "I take your prompt and route it to 5 AI models, each analyzing " +
        "through the lens it's natively best at:\n\n" +
        "🔍 The Critic (Claude Opus 4.6) - finds flaws & risks\n" +
        "📐 The Strategist (GPT-5.2) - big-picture frameworks\n" +
        "⚙️ The Technician (DeepSeek V3) - technical feasibility\n" +
        "💡 The Creative (Llama 4 Maverick) - unconventional angles\n" +
        "🎯 The Pragmatist (Gemini 2.5 Pro) - actionable reality\n\n" +
        "Then a separate synthesizer (GPT-5.2 Pro) fuses all 5 into one answer.\n\n" +
        "To get started, please provide your OpenRouter API key.\n" +
        "Get one at: https://openrouter.ai/keys\n\n" +
        "Then just give me any prompt and I'll run the consensus!"
    );
    return;
  }

  const apiKey = ctx.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await ctx.reply(
      "I need your OpenRouter API key to run the consensus engine.\n\n" +
        "Please set it with:\n" +
        "  `set OPENROUTER_API_KEY sk-or-your-key-here`\n\n" +
        "Get a key at: https://openrouter.ai/keys"
    );
    return;
  }

  await ctx.reply("🧠 Running consensus with 5 specialized models...\n");

  const config = loadConfig();

  try {
    const result = await handleConsensus(
      { prompt, apiKey, verbose },
      config
    );

    let response = result.consensus + "\n\n";

    if (result.analyses) {
      response += "━━━ Individual Analyses ━━━\n\n";
      for (const a of result.analyses) {
        response += `**${a.label}** (${a.model})\n${a.content}\n\n`;
      }
    }

    response += `━━━\nTokens: ${result.meta.totalTokens.toLocaleString()} | `;
    response += `Cost: ~$${result.meta.estimatedCost.toFixed(4)} | `;
    response += `Time: ${(result.meta.totalDurationMs / 1000).toFixed(1)}s`;

    await ctx.reply(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Error running consensus: ${message}`);
  }
}
