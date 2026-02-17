<p align="center">
  <img src="assets/k-llm-logo.png" alt="K-LLM" width="120" />
</p>

<h1 align="center">K-LLM</h1>

<p align="center">
  <strong>Five models. Five lenses. One answer.</strong><br>
  A multi-model consensus engine that actually uses each model's native strengths.
</p>

<p align="center">
  <a href="#installation">Install</a> · <a href="#what-it-does">What It Does</a> · <a href="#why-these-models">Why</a> · <a href="#demo">Demo</a>
</p>

---

## What It Does

K-LLM is an [OpenClaw](https://openclaw.ai) skill and standalone CLI that takes any prompt, routes it to 5 different AI models in parallel, and synthesizes their responses into a single authoritative answer.

The difference: each model is assigned the role it was **born to play**. We didn't randomly assign personas. We researched 2026 benchmarks, then ran a multi-model consensus debate (Gemini 2.5 Pro vs GPT-5.2, arguing for and against the mapping) to validate every assignment. Each model wears the skin it was built to wear.

The synthesizer is a **different model family** from any of the analysts. This prevents anchor bias, where the loudest critic's priorities would dominate the final answer.

```
Your Prompt
     |
     |--- 🔍 The Critic     (Claude Opus 4.6)    finds flaws and risks
     |--- 📐 The Strategist  (GPT-5.2)            big-picture frameworks
     |--- ⚙️  The Technician  (DeepSeek V3)        technical feasibility
     |--- 💡 The Creative    (Llama 4 Maverick)   unconventional angles
     |--- 🎯 The Pragmatist  (Gemini 2.5 Pro)     actionable reality
     |
     v
  🧠 Synthesizer (GPT-5.2 Pro) --> One unified answer
```

### Features

- **Native strength mapping** -- Every model plays the role that matches what it's actually best at, validated by cross-model consensus
- **Parallel execution** -- All 5 analysts run concurrently, not sequentially. Typical round-trip is 3-5 seconds total
- **Cross-family synthesis** -- The condenser model is from a different provider than the critic, preventing any one model from dominating the final output
- **Built-in cost guards** -- Token bucket rate limiting per model and globally, plus a hard cost cap per prompt (default $0.50)
- **Three interfaces** -- Interactive CLI, REST API, and OpenClaw skill. Pick the one that fits your workflow
- **Fully configurable** -- Swap any model for any role via `config.json`. All models referenced by [OpenRouter](https://openrouter.ai) IDs
- **Budget tracking** -- See exactly what each consensus costs in tokens and dollars

## Why These Models

| Role | Model | Why |
|------|-------|-----|
| **Critic** | Claude Opus 4.6 | Highest novel reasoning score on record (68.8% ARC-AGI-2). Best self-correction. Built to find what others miss. |
| **Strategist** | GPT-5.2 | Perfect 100% on AIME 2025 math. 98.7% on multi-turn reasoning. Structured, systematic analysis is its strongest axis. |
| **Technician** | DeepSeek V3 | Top LiveCodeBench performer. 671B MoE architecture purpose-built for code and technical knowledge. |
| **Creative** | Llama 4 Maverick | 128-expert MoE trained on 200+ languages. Different training data means genuinely different cognitive patterns. |
| **Pragmatist** | Gemini 2.5 Pro | Most concise output style of any frontier model. Best price-performance ratio. Built for efficiency. |
| **Synthesizer** | GPT-5.2 Pro | Cross-family from the Critic. 65% fewer hallucinations than predecessors. Strong at reconciling competing viewpoints. |

We validated this mapping by running a formal consensus: Gemini 2.5 Pro argued **for** the mapping (9/10 confidence), GPT-5.2 argued **against** (7/10 confidence, but agreed on all 5 analyst assignments). The key refinement came from GPT-5.2's critique: don't use the same model as both Critic and Synthesizer. That creates anchor bias. We split them across model families.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org) 18 or later
- An [OpenRouter](https://openrouter.ai/keys) API key (gives you access to all 6 models through one key)

### Quick Start

```bash
git clone https://github.com/buildingjoshbetter/K-LLM.git
cd K-LLM
npm install
npm run dev
```

On first run, K-LLM will introduce itself and ask for your OpenRouter API key. It saves the key locally so you only enter it once.

### OpenClaw Skill

If you're running [OpenClaw](https://openclaw.ai):

```bash
openclaw skills install ./openclaw-skill
```

Then in any OpenClaw chat:

```
consensus Should I raise a seed round or bootstrap my SaaS?
```

### REST API

```bash
npm run api
```

```bash
curl -X POST http://localhost:3147/consensus \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Should I raise a seed round or bootstrap?", "apiKey": "sk-or-..."}'
```

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/models` | List all analyst models and their roles |
| `POST` | `/consensus` | Run a consensus analysis |

## Demo

Start the CLI and type any prompt. Here's what it looks like:

```
╔══════════════════════════════════════════════╗
║  K-LLM Consensus Engine v1.0               ║
║  5 models. 5 lenses. 1 answer.             ║
╚══════════════════════════════════════════════╝

You: Should I raise a seed round or bootstrap my SaaS?

  Analyzing with 5 specialized models...

  🔍 The Critic      done  [2.3s]
  📐 The Strategist   done  [1.8s]
  ⚙️  The Technician   done  [1.5s]
  💡 The Creative     done  [2.1s]
  🎯 The Pragmatist   done  [1.2s]

  Synthesizing via GPT-5.2 Pro...

  ## Consensus Response

  Bootstrap first, raise later from a position of strength.
  Four of five models converge on this: early revenue
  validates demand, preserves equity, and gives you
  real leverage when you do raise...

  ## Key Points of Agreement
  - Bootstrapping de-risks the fundraise itself
  - SaaS unit economics favor early self-funding
  - Seed rounds optimize for speed, not survival

  ## Points of Divergence
  - The Creative suggests a third path: revenue-based
    financing as a middle ground...

  ## Recommended Action
  1. Get to $5K MRR on your own
  2. Use those metrics as proof points
  3. Raise a seed round at 2-3x the valuation you'd
     get today...

  Cost: ~$0.12 | Tokens: 18,420 | Time: 4.2s
```

## Configuration

Edit `config.json` to swap models, adjust token limits, or change cost caps:

```json
{
  "analysts": {
    "critic":     { "model": "anthropic/claude-opus-4-6",     "maxTokens": 2000 },
    "strategist": { "model": "openai/gpt-5.2",               "maxTokens": 2000 },
    "technician": { "model": "deepseek/deepseek-v3",         "maxTokens": 2000 },
    "creative":   { "model": "meta-llama/llama-4-maverick",   "maxTokens": 2000 },
    "pragmatist": { "model": "google/gemini-2.5-pro",         "maxTokens": 2000 }
  },
  "synthesizer": { "model": "openai/gpt-5.2-pro", "maxTokens": 4000 },
  "rateLimits": {
    "perModelRpm": 10,
    "globalRpm": 30,
    "maxTokensPerCycle": 50000,
    "maxCostPerCycle": 0.50
  }
}
```

All models use [OpenRouter model IDs](https://openrouter.ai/models). Swap in any model you want.

## Rate Limiting

Built-in protection so you don't accidentally burn through your API credits:

- **Per-model cap** -- 10 requests per minute per model
- **Global cap** -- 30 requests per minute total across all models
- **Token budget** -- 50,000 tokens max per consensus cycle
- **Cost guard** -- $0.50 max per prompt (configurable)
- **Exponential backoff** -- Automatic retry with jitter on rate limit errors

## Project Structure

```
K-LLM/
  src/
    index.ts              CLI entry point
    engine/
      distributor.ts      Routes prompt to 5 models in parallel
      synthesizer.ts      Cross-family condenser layer
      pipeline.ts         Orchestrates the full flow
    models/
      provider.ts         OpenRouter API client
      types.ts            TypeScript type definitions
    roles/
      critic.ts           Critic role prompt (Claude)
      strategist.ts       Strategist role prompt (GPT)
      technician.ts       Technician role prompt (DeepSeek)
      creative.ts         Creative role prompt (Llama)
      pragmatist.ts       Pragmatist role prompt (Gemini)
    ratelimit/
      limiter.ts          Token bucket rate limiter
      budget.ts           Cost tracking and budget enforcement
    api/
      server.ts           REST API server
    openclaw/
      skill.ts            OpenClaw skill wrapper
  openclaw-skill/
    manifest.json         OpenClaw skill manifest
    handler.ts            Skill entry point
  config.json             Model and rate limit configuration
```

## Built With

- [OpenRouter](https://openrouter.ai) for unified multi-model API access
- [OpenClaw](https://openclaw.ai) for agent platform integration
- Node.js + TypeScript

## Built By

**[@Building_Josh](https://twitter.com/Building_Josh)**

## License

[MIT](LICENSE)

---

<p align="center">
  <em>"5 minds are better than 1."</em>
</p>

<p align="center">🧠</p>
