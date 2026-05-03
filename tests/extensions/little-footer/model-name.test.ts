import { describe, expect, it } from "vitest";
import { formatModelDisplay } from "../../../extensions/little-footer/model-name.ts";

describe("formatModelDisplay", () => {
  it("returns empty string for empty input", () => {
    expect(formatModelDisplay("")).toBe("");
  });

  it("returns empty string for whitespace input", () => {
    expect(formatModelDisplay("   ")).toBe("");
  });

  it("trims input", () => {
    expect(formatModelDisplay("  anthropic/claude-sonnet-4-6  ")).toContain(
      "Anthropic",
    );
  });

  it("formats provider/model with slash", () => {
    expect(formatModelDisplay("anthropic/claude-sonnet-4-6")).toBe(
      "Anthropic: Claude Sonnet 4 6",
    );
  });

  it("formats openai model", () => {
    expect(formatModelDisplay("openai/gpt-5.2")).toBe("OpenAI: GPT 5.2");
  });

  it("formats moonshotai model", () => {
    expect(formatModelDisplay("moonshotai/kimi-k2.6")).toBe(
      "MoonshotAI: Kimi K2.6",
    );
  });

  it("formats xai model", () => {
    expect(formatModelDisplay("xai/grok-3")).toBe("xAI: Grok 3");
  });

  it("formats deepseek model", () => {
    expect(formatModelDisplay("deepseek/deepseek-r1")).toBe(
      "DeepSeek: Deepseek R1",
    );
  });

  it("formats google model", () => {
    expect(formatModelDisplay("google/gemini-2.5")).toBe(
      "Google: Gemini 2.5",
    );
  });

  it("formats groq provider", () => {
    expect(formatModelDisplay("groq/llama-3.1")).toBe("Groq: Llama 3.1");
  });

  it("formats openrouter provider", () => {
    expect(formatModelDisplay("openrouter/model-x")).toBe(
      "OpenRouter: Model X",
    );
  });

  it("formats mistralai provider", () => {
    expect(formatModelDisplay("mistralai/mistral-large")).toBe(
      "MistralAI: Mistral Large",
    );
  });

  it("formats qwen provider", () => {
    expect(formatModelDisplay("qwen/qwq-32b")).toBe("Qwen: Qwq 32b");
  });

  it("preserves acronyms in model name", () => {
    expect(formatModelDisplay("openai/gpt-4-turbo")).toBe(
      "OpenAI: GPT 4 Turbo",
    );
  });

  it("preserves words starting with digits", () => {
    expect(formatModelDisplay("anthropic/claude-3-opus")).toBe(
      "Anthropic: Claude 3 Opus",
    );
  });

  it("title-cases without slash", () => {
    expect(formatModelDisplay("claude-sonnet-4-6")).toBe(
      "Claude Sonnet 4 6",
    );
  });

  it("capitalizes unknown provider", () => {
    expect(formatModelDisplay("acme/my-model")).toBe("Acme: My Model");
  });

  it("handles openai-codex provider", () => {
    expect(formatModelDisplay("openai-codex/codex-2")).toBe(
      "OpenAI Codex: Codex 2",
    );
  });

  it("preserves multiple acronyms", () => {
    expect(formatModelDisplay("openai/gpt-4o-mini")).toBe(
      "OpenAI: GPT 4o Mini",
    );
  });
});
