#!/usr/bin/env node
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { initProvider } from "./models/provider.js";
import { runConsensus } from "./engine/pipeline.js";
import type { Config } from "./models/types.js";

const BANNER = `
╔══════════════════════════════════════════════╗
║  K-LLM Consensus Engine v1.0               ║
║  5 models. 5 lenses. 1 answer.             ║
╚══════════════════════════════════════════════╝
`;

const ROLES_DISPLAY: Record<string, { icon: string; label: string; model: string }> = {};

function loadConfig(): Config {
  const cwd = process.cwd();
  const configPath = path.resolve(cwd, "config.json");
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
  // Try the directory where the script lives
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const fallback = path.resolve(scriptDir, "..", "config.json");
  if (fs.existsSync(fallback)) {
    return JSON.parse(fs.readFileSync(fallback, "utf-8"));
  }
  console.error("config.json not found. Run from the K-LLM directory.");
  process.exit(1);
}

function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

function formatCost(cost: number): string {
  return "$" + cost.toFixed(4);
}

function printResult(result: Awaited<ReturnType<typeof runConsensus>>, config: Config): void {
  console.log();

  if (config.output.showIndividualAnalyses) {
    console.log("━━━ Individual Analyses ━━━\n");
    for (const a of result.analyses) {
      console.log(`${a.icon} ${a.label} (${a.model})`);
      console.log("─".repeat(50));
      console.log(a.content);
      console.log();
    }
  }

  console.log("━━━ Consensus Response ━━━\n");
  console.log(result.synthesis.content);
  console.log();

  const footer: string[] = [];
  if (config.output.showCostBreakdown) {
    footer.push(`Cost: ~${formatCost(result.estimatedCost)}`);
  }
  footer.push(`Tokens: ${result.totalTokens.toLocaleString()}`);
  if (config.output.showTimings) {
    footer.push(`Time: ${formatDuration(result.totalDurationMs)}`);
  }

  console.log("━".repeat(50));
  console.log(footer.join(" | "));
  console.log();
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Populate display info
  for (const [role, analyst] of Object.entries(config.analysts)) {
    ROLES_DISPLAY[role] = {
      icon: analyst.icon,
      label: analyst.label,
      model: analyst.model,
    };
  }

  // Get API key
  let apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    // Check .env file
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf-8");
      const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
      if (match) apiKey = match[1].trim();
    }
  }

  console.log(BANNER);

  if (!apiKey) {
    console.log("Welcome to K-LLM! Here's what I can do:\n");
    console.log("  I take your prompt and route it to 5 AI models,");
    console.log("  each analyzing through the lens it's natively best at:\n");
    for (const [, info] of Object.entries(config.analysts)) {
      console.log(`    ${info.icon} ${info.label} → ${info.model}`);
    }
    console.log(`\n  Then a separate model (${config.synthesizer.model})`);
    console.log("  synthesizes all perspectives into one authoritative answer.\n");
    console.log("  To get started, please provide your OpenRouter API key.");
    console.log("  Get one at: https://openrouter.ai/keys\n");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    apiKey = await new Promise<string>((resolve) => {
      rl.question("  OpenRouter API Key: ", (answer) => {
        resolve(answer.trim());
      });
    });

    rl.close();

    if (!apiKey) {
      console.error("\n  No API key provided. Exiting.");
      process.exit(1);
    }

    // Save to .env for future use
    fs.writeFileSync(
      path.resolve(process.cwd(), ".env"),
      `OPENROUTER_API_KEY=${apiKey}\n`
    );
    console.log("  Key saved to .env for future sessions.\n");
  }

  initProvider(apiKey);

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Ready. Type your prompt and press Enter. Type 'quit' to exit.\n");

  process.on("SIGINT", () => {
    console.log("\nGoodbye!");
    rl.close();
    process.exit(0);
  });

  const ask = (): void => {
    rl.question("You: ", async (input) => {
      const prompt = input.trim();
      if (!prompt || prompt.toLowerCase() === "quit") {
        console.log("\nGoodbye!");
        rl.close();
        return;
      }

      console.log("\n━━━ Analyzing with 5 specialized models... ━━━\n");

      const activeAnalysts = new Set<string>();

      const result = await runConsensus(prompt, config, {
        onAnalystStart: (role) => {
          const info = ROLES_DISPLAY[role];
          if (info) {
            activeAnalysts.add(role);
            process.stdout.write(`  ${info.icon} ${info.label.padEnd(16)} analyzing...\n`);
          }
        },
        onAnalystDone: (role, durationMs) => {
          const info = ROLES_DISPLAY[role];
          if (info) {
            activeAnalysts.delete(role);
            process.stdout.write(
              `  ${info.icon} ${info.label.padEnd(16)} done  [${formatDuration(durationMs)}]\n`
            );
          }
        },
        onSynthesisStart: () => {
          console.log(`\n━━━ Synthesizing via ${config.synthesizer.model}... ━━━`);
        },
        onSynthesisDone: (durationMs) => {
          process.stdout.write(`  Synthesis complete [${formatDuration(durationMs)}]\n`);
        },
      });

      printResult(result, config);
      ask();
    });
  };

  ask();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
