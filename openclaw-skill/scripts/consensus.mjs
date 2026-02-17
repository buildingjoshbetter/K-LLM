#!/usr/bin/env node

/**
 * K-LLM Consensus Script for OpenClaw
 *
 * Called by OpenClaw's exec tool with:
 *   node consensus.mjs --prompt "your question" [--verbose]
 *
 * Outputs JSON to stdout. Errors go to stderr.
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
  console.error(
    JSON.stringify({
      error:
        "OPENROUTER_API_KEY not set. Get a key at https://openrouter.ai/keys",
    })
  );
  process.exit(1);
}

// Load config from the repo root (one level up from scripts/)
const configPath = resolve(__dirname, "..", "..", "config.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch {
  console.error(
    JSON.stringify({ error: `Cannot load config.json at ${configPath}` })
  );
  process.exit(1);
}

// Dynamic imports from the built dist/ directory
const distRoot = resolve(__dirname, "..", "..", "dist");

let initProvider, runConsensus;
try {
  const providerMod = await import(resolve(distRoot, "models", "provider.js"));
  const pipelineMod = await import(resolve(distRoot, "engine", "pipeline.js"));
  initProvider = providerMod.initProvider;
  runConsensus = pipelineMod.runConsensus;
} catch (err) {
  console.error(
    JSON.stringify({
      error: `Failed to load K-LLM engine. Run 'npm run build' first. Detail: ${err.message}`,
    })
  );
  process.exit(1);
}

// Run consensus
initProvider(apiKey);

try {
  const result = await runConsensus(values.prompt, config);

  const output = {
    consensus: result.synthesis.content,
    meta: {
      totalTokens: result.totalTokens,
      totalDurationMs: result.totalDurationMs,
      estimatedCost: result.estimatedCost,
    },
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
} catch (err) {
  console.error(JSON.stringify({ error: err.message || String(err) }));
  process.exit(1);
}
