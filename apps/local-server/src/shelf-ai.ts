import { generateGptShelfAnalysis, isOpenAiConfigured } from "./gpt4o.js";
import { generateOllamaShelfAnalysis, getOllamaBaseUrl } from "./ollama.js";

export type ShelfAiProvider = "openai" | "ollama";

export function getShelfAiProvider(): ShelfAiProvider {
  return process.env.SHELF_AI_PROVIDER?.trim().toLowerCase() === "ollama" ? "ollama" : "openai";
}

export function isShelfAiConfigured() {
  return getShelfAiProvider() === "ollama" ? getOllamaBaseUrl() !== undefined : isOpenAiConfigured();
}

export function describeShelfAiProvider(provider = getShelfAiProvider()) {
  return provider === "ollama" ? "Ollama" : "OpenAI";
}

export function shelfAiNotConfiguredMessage(provider = getShelfAiProvider()) {
  return provider === "ollama"
    ? "OLLAMA_URL is not a valid http or https origin. Fix it on the local server, or unset SHELF_AI_PROVIDER to use OpenAI."
    : "Set OPENAI_API_KEY on the local server, or set SHELF_AI_PROVIDER=ollama to use a local model.";
}

export function generateShelfAiAnalysis(input: { caption?: string; photoDataUrl: string }) {
  return getShelfAiProvider() === "ollama" ? generateOllamaShelfAnalysis(input) : generateGptShelfAnalysis(input);
}
