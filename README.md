# X-LLM

**Multi-model consensus engine.** Drop a prompt in, get back the distilled intelligence of 5 AI models — each analyzing through the lens it's natively best at — fused into one definitive response.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![OpenRouter](https://img.shields.io/badge/Powered%20by-OpenRouter-blue.svg)](https://openrouter.ai)

## How It Works

```
Your Prompt
     │
     ├──► 🔍 The Critic     (Claude Opus 4.6)    — finds flaws & risks
     ├──► 📐 The Strategist  (GPT-5.2)            — big-picture frameworks
     ├──► ⚙️  The Technician  (DeepSeek V3)        — technical feasibility
     ├──► 💡 The Creative    (Llama 4 Maverick)   — unconventional angles
     ├──► 🎯 The Pragmatist  (Gemini 2.5 Pro)     — actionable reality
     │
     ▼
  🧠 Synthesizer (GPT-5.2 Pro) → One unified answer
```

Each model was assigned the role that matches its **native strengths** — not an arbitrary persona. We validated the mapping using multi-model consensus (Gemini 2.5 Pro + GPT-5.2 debating the assignments).

**Key design decision:** The Synthesizer is a *different model family* from any analyst to avoid anchor bias.

## Why These Models?

| Role | Model | Native Strength |
|------|-------|----------------|
| **Critic** | Claude Opus 4.6 | Highest novel reasoning (68.8% ARC-AGI-2), best self-correction |
| **Strategist** | GPT-5.2 | 100% AIME math, strongest structured analytical reasoning |
| **Technician** | DeepSeek V3 | Top LiveCodeBench, purpose-built for code + technical knowledge |
| **Creative** | Llama 4 Maverick | 200+ language training = diverse priors, strong abstract reasoning |
| **Pragmatist** | Gemini 2.5 Pro | Most concise style, best price-performance, search grounding |
| **Synthesizer** | GPT-5.2 Pro | Cross-family fusion, 65% fewer hallucinations |

## Quick Start

```bash
git clone https://github.com/buildingjoshbetter/X-LLM.git
cd X-LLM
npm install
npm run dev
```

You'll be asked for your [OpenRouter API key](https://openrouter.ai/keys) on first run.

## Usage

### Interactive CLI

```bash
npm run dev
```

Type any prompt and get a 5-model consensus response.

### REST API

```bash
npm run api
```

```bash
curl -X POST http://localhost:3147/consensus \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Should I raise a seed round or bootstrap?", "apiKey": "sk-or-..."}'
```

### OpenClaw Skill

```bash
openclaw skills install ./openclaw-skill
```

Then in any OpenClaw chat: `consensus Should I raise a seed round or bootstrap?`

## Configuration

Edit `config.json` to swap models, adjust rate limits, or change token budgets:

```json
{
  "analysts": {
    "critic": { "model": "anthropic/claude-opus-4-6", "maxTokens": 2000 },
    "strategist": { "model": "openai/gpt-5.2", "maxTokens": 2000 },
    "technician": { "model": "deepseek/deepseek-v3", "maxTokens": 2000 },
    "creative": { "model": "meta-llama/llama-4-maverick", "maxTokens": 2000 },
    "pragmatist": { "model": "google/gemini-2.5-pro", "maxTokens": 2000 }
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

All models are configurable via [OpenRouter model IDs](https://openrouter.ai/models).

## Rate Limiting

Built-in protection against runaway costs:

- **Per-model**: 10 req/min per model
- **Global**: 30 req/min total
- **Token budget**: 50k tokens per cycle
- **Cost guard**: $0.50 max per prompt
- **Backoff**: Exponential retry with jitter on 429s

## Built With

- [OpenRouter](https://openrouter.ai) — unified API for 100+ models
- [OpenClaw](https://openclaw.ai) — open-source AI agent platform
- Node.js + TypeScript

## License

MIT
