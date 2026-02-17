import { describe, it, expect } from "vitest";
import {
  CRITIC_SYSTEM_PROMPT,
  STRATEGIST_SYSTEM_PROMPT,
  TECHNICIAN_SYSTEM_PROMPT,
  CREATIVE_SYSTEM_PROMPT,
  PRAGMATIST_SYSTEM_PROMPT,
  ROLE_PROMPTS,
  SYNTHESIS_SYSTEM_PROMPT,
} from "../index.js";

describe("roles", () => {
  const allRoles = [
    { name: "critic", prompt: CRITIC_SYSTEM_PROMPT },
    { name: "strategist", prompt: STRATEGIST_SYSTEM_PROMPT },
    { name: "technician", prompt: TECHNICIAN_SYSTEM_PROMPT },
    { name: "creative", prompt: CREATIVE_SYSTEM_PROMPT },
    { name: "pragmatist", prompt: PRAGMATIST_SYSTEM_PROMPT },
  ];

  it("exports all 5 role prompts", () => {
    expect(Object.keys(ROLE_PROMPTS)).toHaveLength(5);
    expect(Object.keys(ROLE_PROMPTS).sort()).toEqual([
      "creative",
      "critic",
      "pragmatist",
      "strategist",
      "technician",
    ]);
  });

  for (const { name, prompt } of allRoles) {
    it(`${name} prompt is a non-empty string`, () => {
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(50);
    });

    it(`${name} prompt exists in ROLE_PROMPTS map`, () => {
      expect(ROLE_PROMPTS[name]).toBe(prompt);
    });

    it(`${name} prompt mentions its role identity`, () => {
      const lower = prompt.toLowerCase();
      expect(lower).toContain(name === "critic" ? "critic" : name);
    });

    it(`${name} prompt enforces word limit`, () => {
      expect(prompt.toLowerCase()).toContain("500 words");
    });
  }

  describe("synthesis prompt", () => {
    it("is a non-empty string", () => {
      expect(typeof SYNTHESIS_SYSTEM_PROMPT).toBe("string");
      expect(SYNTHESIS_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it("mentions all 5 analyst roles", () => {
      const lower = SYNTHESIS_SYSTEM_PROMPT.toLowerCase();
      expect(lower).toContain("critic");
      expect(lower).toContain("strategist");
      expect(lower).toContain("technician");
      expect(lower).toContain("creative");
      expect(lower).toContain("pragmatist");
    });

    it("specifies output structure sections", () => {
      expect(SYNTHESIS_SYSTEM_PROMPT).toContain("## Consensus Response");
      expect(SYNTHESIS_SYSTEM_PROMPT).toContain("## Key Points of Agreement");
      expect(SYNTHESIS_SYSTEM_PROMPT).toContain("## Points of Divergence");
      expect(SYNTHESIS_SYSTEM_PROMPT).toContain("## Recommended Action");
    });

    it("instructs to synthesize not summarize", () => {
      const lower = SYNTHESIS_SYSTEM_PROMPT.toLowerCase();
      expect(lower).toContain("synthesize");
      expect(lower).toContain("don't just summarize");
    });
  });
});
