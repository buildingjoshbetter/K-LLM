#!/usr/bin/env node

/**
 * K-LLM Consensus Script for OpenClaw
 *
 * Called by OpenClaw's exec tool with:
 *   node consensus.mjs --prompt "your question" [--chatId 123] [--verbose]
 *
 * When --chatId is provided, sends formatted messages directly to Telegram:
 *   1. Ack message (immediate)
 *   2. Individual analyses (after models complete)
 *   3. Synthesis (final message)
 *
 * Returns minimal JSON to stdout for OpenClaw/DeepSeek.
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse CLI arguments
const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    chatId: { type: "string" },
    verbose: { type: "boolean", short: "v", default: false },
  },
  strict: false,
});

if (!values.prompt) {
  console.error(JSON.stringify({ error: "Missing --prompt argument" }));
  process.exit(1);
}

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) {
  console.error(JSON.stringify({ error: "OPENROUTER_API_KEY not set" }));
  process.exit(1);
}

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = values.chatId?.trim();

// --- Telegram messaging ---
async function sendTelegram(text) {
  if (!botToken || !chatId) return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
    if (!resp.ok) {
      // Retry without markdown if formatting fails
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    }
  } catch (e) {
    console.error(`[telegram] send failed: ${e.message}`);
  }
}

// --- Friendly model names ---
const MODEL_NAMES = {
  "anthropic/claude-opus-4-6": "Claude Opus 4.6",
  "openai/gpt-5.2": "GPT-5.2",
  "openai/gpt-5.2-pro": "GPT-5.2 Pro",
  "deepseek/deepseek-chat": "DeepSeek V3",
  "deepseek/deepseek-v3": "DeepSeek V3",
  "meta-llama/llama-4-maverick": "Llama 4 Maverick",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
};

function friendlyModel(modelId) {
  return MODEL_NAMES[modelId] || modelId.split("/").pop();
}

// --- Format analyses message ---
function formatAnalyses(analyses, config) {
  const lines = ["\u{1F9E0} *K-LLM \u2014 5 Model Perspectives*\n"];

  for (const a of analyses) {
    const cfg = config.analysts[a.role] || {};
    const icon = cfg.icon || "\u25AA\uFE0F";
    const label = cfg.label || a.role;
    const model = friendlyModel(a.model);
    const content = a.content?.trim() || "(no response)";

    lines.push(`${icon} *${model}* \u2014 ${label}`);
    lines.push(`${content}\n`);
  }

  return lines.join("\n");
}

// --- Replace ## headers with context-relevant emojis ---
const HEADER_EMOJIS = {
  "consensus response": "\u2728",
  "consensus": "\u2728",
  "summary": "\u2728",
  "key points of agreement": "\u{1F91D}",
  "agreement": "\u{1F91D}",
  "points of agreement": "\u{1F91D}",
  "common ground": "\u{1F91D}",
  "points of divergence": "\u2696\uFE0F",
  "divergence": "\u2696\uFE0F",
  "disagreements": "\u2696\uFE0F",
  "areas of disagreement": "\u2696\uFE0F",
  "recommended action": "\u{1F680}",
  "recommendation": "\u{1F680}",
  "recommendations": "\u{1F680}",
  "next steps": "\u{1F680}",
  "action items": "\u{1F680}",
  "key takeaway": "\u{1F4A1}",
  "key takeaways": "\u{1F4A1}",
  "takeaways": "\u{1F4A1}",
  "risks": "\u26A0\uFE0F",
  "concerns": "\u26A0\uFE0F",
  "caveats": "\u26A0\uFE0F",
  "limitations": "\u26A0\uFE0F",
  "technical details": "\u2699\uFE0F",
  "implementation": "\u2699\uFE0F",
  "context": "\u{1F4CB}",
  "background": "\u{1F4CB}",
  "analysis": "\u{1F50D}",
  "overview": "\u{1F30D}",
  "conclusion": "\u2705",
  "final answer": "\u2705",
  "bottom line": "\u2705",
};

function replaceHeaders(text) {
  return text.replace(/^##\s+(.+)$/gm, (match, heading) => {
    const key = heading.trim().toLowerCase();
    const emoji = HEADER_EMOJIS[key] || "\u{1F4CC}";
    return `${emoji} *${heading.trim()}*`;
  });
}

// --- Format synthesis message ---
function formatSynthesis(synthesis, meta) {
  let content = synthesis.content?.trim() || "(no synthesis)";
  content = replaceHeaders(content);
  const cost = meta.estimatedCost?.toFixed(3) || "?";
  const secs = Math.round((meta.totalDurationMs || 0) / 1000);
  const tokens = meta.totalTokens || 0;

  return [
    "\u2728 *Synthesis*\n",
    content,
    "",
    `\u{1F4CA} _5 models \u00B7 ${tokens.toLocaleString()} tokens \u00B7 $${cost} \u00B7 ${secs}s_`,
  ].join("\n");
}

// --- Load engine ---
const configPath = resolve(__dirname, "..", "config.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch {
  // Fallback: try repo root config
  try {
    config = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "config.json"), "utf-8"));
  } catch {
    console.error(JSON.stringify({ error: `Cannot load config.json` }));
    process.exit(1);
  }
}

const distRoot = resolve(__dirname, "..", "dist");
let initProvider, runConsensus;
try {
  const providerMod = await import(resolve(distRoot, "models", "provider.js"));
  const pipelineMod = await import(resolve(distRoot, "engine", "pipeline.js"));
  initProvider = providerMod.initProvider;
  runConsensus = pipelineMod.runConsensus;
} catch (err) {
  // Fallback: try repo root dist
  try {
    const distRoot2 = resolve(__dirname, "..", "..", "dist");
    const providerMod = await import(resolve(distRoot2, "models", "provider.js"));
    const pipelineMod = await import(resolve(distRoot2, "engine", "pipeline.js"));
    initProvider = providerMod.initProvider;
    runConsensus = pipelineMod.runConsensus;
  } catch (err2) {
    console.error(JSON.stringify({ error: `Failed to load K-LLM engine: ${err2.message}` }));
    process.exit(1);
  }
}

// --- Run ---
initProvider(apiKey);

// Send ack immediately
await sendTelegram(`\u{1F9E0} Running consensus on your question...\n\n_Querying Claude, GPT, DeepSeek, Llama, and Gemini in parallel_`);

try {
  const result = await runConsensus(values.prompt, config);

  const meta = {
    totalTokens: result.totalTokens,
    totalDurationMs: result.totalDurationMs,
    estimatedCost: result.estimatedCost,
  };

  // Send analyses message
  const analysesText = formatAnalyses(result.analyses, config);
  await sendTelegram(analysesText);

  // Small delay so messages arrive in order
  await new Promise((r) => setTimeout(r, 500));

  // Send synthesis message
  const synthesisText = formatSynthesis(result.synthesis, meta);
  await sendTelegram(synthesisText);

  // If Telegram was used, return minimal result so the host model doesn't repeat everything
  if (botToken && chatId) {
    console.log(JSON.stringify({
      status: "done",
      note: "Consensus results already sent to user via Telegram. Do NOT repeat or summarize them. Reply with just: NO_REPLY",
    }));
  } else {
    // No Telegram — output full result to stdout
    const output = {
      consensus: result.synthesis.content,
      meta,
    };
    if (values.verbose) {
      output.analyses = result.analyses.map((a) => ({
        role: a.role,
        label: a.label,
        model: a.model,
        content: a.content,
      }));
    }
    console.log(JSON.stringify(output, null, 2));
  }

} catch (err) {
  console.error(JSON.stringify({ error: err.message || String(err) }));
  process.exit(1);
}
