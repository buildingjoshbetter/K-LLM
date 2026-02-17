import express from "express";
import * as fs from "fs";
import * as path from "path";
import { initProvider } from "../models/provider.js";
import { runConsensus } from "../engine/pipeline.js";
import type { Config } from "../models/types.js";

const app = express();
app.use(express.json());

// Handle malformed JSON request bodies
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if ("type" in err && (err as any).type === "entity.parse.failed") {
      res.status(400).json({ error: "Malformed JSON in request body" });
      return;
    }
    next(err);
  }
);

function loadConfig(): Config {
  const configPath = path.resolve(process.cwd(), "config.json");
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load config.json: ${message}`);
    process.exit(1);
  }
}

const config = loadConfig();

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

// Model info
app.get("/models", (_req, res) => {
  res.json({
    analysts: Object.entries(config.analysts).map(([role, c]) => ({
      role,
      label: c.label,
      model: c.model,
      description: c.description,
    })),
    synthesizer: {
      model: config.synthesizer.model,
      description: config.synthesizer.description,
    },
  });
});

// Run consensus
app.post("/consensus", async (req, res) => {
  const { prompt, apiKey } = req.body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt' in request body" });
    return;
  }

  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) {
    res.status(401).json({
      error: "No API key. Set OPENROUTER_API_KEY or pass 'apiKey' in body.",
    });
    return;
  }

  initProvider(key);

  try {
    const result = await runConsensus(prompt, config);
    res.json({
      prompt: result.prompt,
      consensus: result.synthesis.content,
      analyses: result.analyses.map((a) => ({
        role: a.role,
        label: a.label,
        model: a.model,
        content: a.content,
        tokensUsed: a.tokensUsed,
        durationMs: a.durationMs,
      })),
      meta: {
        totalTokens: result.totalTokens,
        totalDurationMs: result.totalDurationMs,
        estimatedCost: result.estimatedCost,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const PORT = parseInt(process.env.PORT || "3147", 10);
app.listen(PORT, () => {
  console.log(`K-LLM API running on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  GET  /health     - Health check");
  console.log("  GET  /models     - List analyst models and roles");
  console.log("  POST /consensus  - Run consensus (body: { prompt, apiKey? })");
});
