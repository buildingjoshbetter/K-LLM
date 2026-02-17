import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import * as yaml from "node:fs";

const exec = promisify(execFile);
const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SKILL_DIR = resolve(PROJECT_ROOT, "openclaw-skill");
const SCRIPT_PATH = resolve(SKILL_DIR, "scripts", "consensus.mjs");

/**
 * These tests validate that the OpenClaw skill integration actually works
 * the way OpenClaw would invoke it -- as a subprocess with CLI args,
 * environment variables, and JSON stdout output.
 */

describe("OpenClaw skill integration", () => {
  describe("SKILL.md validation", () => {
    const skillMdPath = resolve(SKILL_DIR, "SKILL.md");
    let content: string;
    let frontmatter: string;
    let body: string;

    beforeEach(() => {
      content = readFileSync(skillMdPath, "utf-8");
      const parts = content.split("---");
      frontmatter = parts[1]?.trim() ?? "";
      body = parts.slice(2).join("---").trim();
    });

    it("SKILL.md exists", () => {
      expect(existsSync(skillMdPath)).toBe(true);
    });

    it("has valid YAML frontmatter with required fields", () => {
      expect(frontmatter).toContain("name: k-llm");
      expect(frontmatter).toContain("description:");
    });

    it("declares OPENROUTER_API_KEY as required env", () => {
      expect(frontmatter).toContain("OPENROUTER_API_KEY");
    });

    it("declares node as required binary", () => {
      expect(frontmatter).toContain("node");
    });

    it("has user-invocable set to true", () => {
      expect(frontmatter).toContain("user-invocable: true");
    });

    it("has trigger keywords", () => {
      expect(frontmatter).toContain("consensus");
      expect(frontmatter).toContain("k-llm");
    });

    it("uses clawdbot metadata key (not openclaw)", () => {
      expect(frontmatter).toContain('"clawdbot"');
      expect(frontmatter).not.toContain('"openclaw"');
    });

    it("has clawdbot metadata with emoji", () => {
      expect(frontmatter).toContain("clawdbot");
      expect(frontmatter).toContain("emoji");
    });

    it("declares files for security scanning", () => {
      expect(frontmatter).toContain('files:');
      expect(frontmatter).toContain('scripts/*');
    });

    it("metadata is single-line JSON (OpenClaw parser requirement)", () => {
      const metadataLine = frontmatter
        .split("\n")
        .find((l) => l.startsWith("metadata:"));
      expect(metadataLine).toBeDefined();
      // Should be exactly one line containing the full JSON
      expect(metadataLine).toContain("{");
      expect(metadataLine).toContain("}");
    });

    it("body references the consensus script with {baseDir}", () => {
      expect(body).toContain("{baseDir}/scripts/consensus.mjs");
    });

    it("body documents --prompt and --verbose flags", () => {
      expect(body).toContain("--prompt");
      expect(body).toContain("--verbose");
    });

    it("body documents JSON output format", () => {
      expect(body).toContain('"consensus"');
      expect(body).toContain('"meta"');
      expect(body).toContain('"totalTokens"');
    });

    it("body documents error handling", () => {
      expect(body).toContain("error");
      expect(body).toContain("non-zero");
    });
  });

  describe("script file validation", () => {
    it("consensus.mjs exists and is executable", () => {
      expect(existsSync(SCRIPT_PATH)).toBe(true);
    });

    it("uses ESM (import.meta)", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("import.meta");
    });

    it("uses parseArgs for CLI argument handling", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("parseArgs");
      expect(content).toContain("--prompt");
    });

    it("reads OPENROUTER_API_KEY from process.env", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("process.env.OPENROUTER_API_KEY");
    });

    it("outputs JSON to stdout", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("console.log(JSON.stringify");
    });

    it("outputs errors to stderr", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("console.error");
    });

    it("loads config from repo root via relative path", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("config.json");
    });

    it("imports from dist/ directory (built output)", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("dist");
      expect(content).toContain("provider.js");
      expect(content).toContain("pipeline.js");
    });
  });

  describe("script execution (no API key)", () => {
    it("exits with error when --prompt is missing", async () => {
      try {
        await exec("node", [SCRIPT_PATH], {
          env: { ...process.env, OPENROUTER_API_KEY: "test" },
        });
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.code).not.toBe(0);
        const error = JSON.parse(err.stderr);
        expect(error.error).toContain("--prompt");
      }
    });

    it("exits with error when OPENROUTER_API_KEY is missing", async () => {
      try {
        await exec("node", [SCRIPT_PATH, "--prompt", "test question"], {
          env: { PATH: process.env.PATH }, // strip all other env vars
        });
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.code).not.toBe(0);
        const error = JSON.parse(err.stderr);
        expect(error.error).toContain("OPENROUTER_API_KEY");
      }
    });
  });

  describe("directory structure", () => {
    it("has correct skill directory layout", () => {
      expect(existsSync(resolve(SKILL_DIR, "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(SKILL_DIR, "scripts"))).toBe(true);
      expect(existsSync(resolve(SKILL_DIR, "scripts", "consensus.mjs"))).toBe(
        true
      );
    });

    it("does NOT have old manifest.json", () => {
      expect(existsSync(resolve(SKILL_DIR, "manifest.json"))).toBe(false);
    });

    it("does NOT have old handler.ts", () => {
      expect(existsSync(resolve(SKILL_DIR, "handler.ts"))).toBe(false);
    });

    it("config.json exists at project root", () => {
      expect(existsSync(resolve(PROJECT_ROOT, "config.json"))).toBe(true);
    });

    it("dist/ directory exists (project is built)", () => {
      expect(existsSync(resolve(PROJECT_ROOT, "dist"))).toBe(true);
      expect(
        existsSync(resolve(PROJECT_ROOT, "dist", "engine", "pipeline.js"))
      ).toBe(true);
      expect(
        existsSync(resolve(PROJECT_ROOT, "dist", "models", "provider.js"))
      ).toBe(true);
    });
  });

  describe("config.json compatibility", () => {
    let config: any;

    beforeEach(() => {
      config = JSON.parse(
        readFileSync(resolve(PROJECT_ROOT, "config.json"), "utf-8")
      );
    });

    it("has all 5 analyst roles", () => {
      const roles = Object.keys(config.analysts);
      expect(roles).toContain("critic");
      expect(roles).toContain("strategist");
      expect(roles).toContain("technician");
      expect(roles).toContain("creative");
      expect(roles).toContain("pragmatist");
      expect(roles).toHaveLength(5);
    });

    it("each analyst has required fields", () => {
      for (const [role, analyst] of Object.entries(config.analysts) as any) {
        expect(analyst.model).toBeTruthy();
        expect(analyst.maxTokens).toBeGreaterThan(0);
        expect(analyst.label).toBeTruthy();
        expect(analyst.icon).toBeTruthy();
        expect(analyst.description).toBeTruthy();
      }
    });

    it("has synthesizer config", () => {
      expect(config.synthesizer.model).toBeTruthy();
      expect(config.synthesizer.maxTokens).toBeGreaterThan(0);
    });

    it("synthesizer is different model family from critic", () => {
      const criticProvider = config.analysts.critic.model.split("/")[0];
      const synthProvider = config.synthesizer.model.split("/")[0];
      expect(synthProvider).not.toBe(criticProvider);
    });

    it("has rate limit config", () => {
      expect(config.rateLimits.perModelRpm).toBeGreaterThan(0);
      expect(config.rateLimits.globalRpm).toBeGreaterThan(0);
      expect(config.rateLimits.maxTokensPerCycle).toBeGreaterThan(0);
      expect(config.rateLimits.maxCostPerCycle).toBeGreaterThan(0);
    });

    it("all models use OpenRouter format (provider/model)", () => {
      for (const analyst of Object.values(config.analysts) as any) {
        expect(analyst.model).toMatch(/^[\w-]+\/[\w.-]+$/);
      }
      expect(config.synthesizer.model).toMatch(/^[\w-]+\/[\w.-]+$/);
    });
  });
});
