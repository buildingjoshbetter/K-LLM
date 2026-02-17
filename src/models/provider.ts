import OpenAI from "openai";

let client: OpenAI | null = null;

export function initProvider(apiKey: string): void {
  client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: {
      "X-Title": "K-LLM Consensus Engine",
    },
  });
}

export function getClient(): OpenAI {
  if (!client) {
    throw new Error(
      "OpenRouter client not initialized. Call initProvider(apiKey) first."
    );
  }
  return client;
}

export async function callModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<{ content: string; tokensUsed: number }> {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  const tokensUsed =
    (response.usage?.prompt_tokens ?? 0) +
    (response.usage?.completion_tokens ?? 0);

  return { content, tokensUsed };
}
