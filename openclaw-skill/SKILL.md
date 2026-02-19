---
name: k-llm
description: "Multi-model consensus engine. Routes your prompt to 5 AI models (Claude, GPT, DeepSeek, Llama, Gemini), each analyzing through its native strength, then synthesizes all 5 into one authoritative answer. Use when you want thorough, multi-perspective analysis on any question."
metadata: { "clawdbot": { "emoji": "🧠", "primaryEnv": "OPENROUTER_API_KEY", "requires": { "bins": ["node"], "env": ["OPENROUTER_API_KEY"] } } }
files: ["scripts/*"]
user-invocable: true
triggers:
  - consensus
  - analyze this
  - multi-model
  - k-llm
  - 5 perspectives
---

# K-LLM Consensus Engine

A multi-model consensus engine that routes any prompt to 5 AI models in parallel, each analyzing through its native strength, then synthesizes all perspectives into one answer.

## Models & Roles

| Role | Model | Strength |
|------|-------|----------|
| Critic | Claude Opus 4.6 | Finds flaws, challenges assumptions, identifies risks |
| Strategist | GPT-5.2 | Big-picture frameworks, second-order effects |
| Technician | DeepSeek V3 | Technical feasibility, implementation details |
| Creative | Llama 4 Maverick | Unconventional angles, reframing the question |
| Pragmatist | Gemini 2.5 Pro | Actionable reality, real-world constraints |
| Synthesizer | GPT-5.2 Pro | Fuses all 5 perspectives into one coherent answer |

## How to Use

When the user asks for consensus analysis, multi-model analysis, or uses any trigger phrase:

1. Run the consensus script with the user's prompt:

```bash
node {baseDir}/scripts/consensus.mjs --prompt "USER_PROMPT_HERE"
```

2. For verbose output (includes individual analyst responses):

```bash
node {baseDir}/scripts/consensus.mjs --prompt "USER_PROMPT_HERE" --verbose
```

3. For direct Telegram delivery (sends ack + analyses + synthesis as separate messages):

```bash
TELEGRAM_BOT_TOKEN='your-token' node {baseDir}/scripts/consensus.mjs --prompt "USER_PROMPT_HERE" --chatId "TELEGRAM_CHAT_ID"
```

4. Parse the JSON output from stdout and present the result to the user.

## Output Format

The script outputs JSON to stdout:

```json
{
  "consensus": "The synthesized answer from all 5 models",
  "analyses": [
    {
      "role": "critic",
      "label": "The Critic",
      "model": "anthropic/claude-opus-4-6",
      "content": "Individual analysis..."
    }
  ],
  "meta": {
    "totalTokens": 18420,
    "totalDurationMs": 4200,
    "estimatedCost": 0.12
  }
}
```

Note: The `analyses` array is only included when `--verbose` is passed.

When `--chatId` is provided with `TELEGRAM_BOT_TOKEN`, results are sent directly to Telegram and stdout returns a minimal status JSON instead.

## Presenting Results

Format the response like this:

**Consensus:** Show the main `consensus` field as the primary answer.

**Meta:** At the end, show a footer line:
`Tokens: {totalTokens} | Cost: ~${estimatedCost} | Time: {totalDurationMs/1000}s`

If verbose, show each analyst's response under a "Individual Analyses" heading before the consensus.

## First-Time Setup

When the user runs a consensus command for the first time and `OPENROUTER_API_KEY` is not set, guide them through setup:

1. Tell the user they need an OpenRouter API key to use K-LLM
2. Direct them to https://openrouter.ai/keys to create one
3. Once they provide the key, set it in the environment:
   ```bash
   # Add to your OpenClaw .env or docker-compose environment:
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   ```
4. For Telegram direct messaging (optional), also set:
   ```bash
   TELEGRAM_BOT_TOKEN=your-bot-token-here
   ```

## Requirements

- Node.js 18+
- `OPENROUTER_API_KEY` environment variable set (get one at https://openrouter.ai/keys)
- Optional: `TELEGRAM_BOT_TOKEN` for direct Telegram message delivery
- The script handles all dependencies internally (openai SDK)

## Error Handling

If the script exits with a non-zero code, it prints an error JSON to stderr:
```json
{ "error": "Error message here" }
```

If the error is about a missing API key, guide the user through the First-Time Setup above.

## Timing

A typical consensus run takes 3-8 seconds (all 5 models run in parallel, then synthesis). The 120-second timeout is generous but accounts for slow model responses.
