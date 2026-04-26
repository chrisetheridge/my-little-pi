/**
 * Format provider/model IDs into human-readable display names.
 */

const KNOWN_PROVIDERS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  google: "Google",
  moonshotai: "MoonshotAI",
  xai: "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  mistralai: "MistralAI",
  groq: "Groq",
  openrouter: "OpenRouter",
};

const KNOWN_ACRONYMS = new Set(["gpt", "ai", "llm", "api", "moe", "ssm", "vl"]);

/** Title-case a word, preserving known acronyms. */
function titleCaseWord(word: string): string {
  const lower = word.toLowerCase();
  if (KNOWN_ACRONYMS.has(lower)) return lower.toUpperCase();
  // Words starting with a digit stay unchanged
  if (/^\d/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Format a provider/model ID into a display name. */
export function formatModelDisplay(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";

  const slashIndex = trimmed.indexOf("/");
  let provider: string | undefined;
  let modelPart: string;

  if (slashIndex !== -1) {
    provider = trimmed.slice(0, slashIndex);
    modelPart = trimmed.slice(slashIndex + 1);
  } else {
    modelPart = trimmed;
  }

  // Title-case the model part
  const words = modelPart.split(/[-_]+/);
  const formattedModel = words.map(titleCaseWord).join(" ");

  // Format provider if present
  if (provider) {
    const displayName = KNOWN_PROVIDERS[provider] || titleCaseWord(provider);
    return `${displayName}: ${formattedModel}`;
  }

  return formattedModel;
}
