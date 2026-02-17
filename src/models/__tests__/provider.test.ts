import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock openai before importing provider
vi.mock("openai", () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "mock response" } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      },
    },
  }));
  return { default: MockOpenAI };
});

import { initProvider, getClient, callModel } from "../provider.js";

describe("provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initProvider", () => {
    it("creates an OpenAI client with OpenRouter baseURL", () => {
      initProvider("test-key");
      const client = getClient();
      expect(client).toBeDefined();
    });
  });

  describe("callModel", () => {
    it("returns content and token count", async () => {
      initProvider("test-key");
      const result = await callModel("test-model", "system", "user", 2000);
      expect(result.content).toBe("mock response");
      expect(result.tokensUsed).toBe(150); // 100 + 50
    });

    it("defaults to empty content if no choices", async () => {
      initProvider("test-key");
      const client = getClient();
      (client.chat.completions.create as any).mockResolvedValueOnce({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });
      const result = await callModel("test-model", "system", "user", 2000);
      expect(result.content).toBe("");
    });

    it("defaults to 0 tokens if usage is missing", async () => {
      initProvider("test-key");
      const client = getClient();
      (client.chat.completions.create as any).mockResolvedValueOnce({
        choices: [{ message: { content: "test" } }],
        usage: undefined,
      });
      const result = await callModel("test-model", "system", "user", 2000);
      expect(result.tokensUsed).toBe(0);
    });
  });
});
