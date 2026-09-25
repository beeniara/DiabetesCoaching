import { z } from "zod";
import { GptShelfValidationError, SHELF_ANALYSIS_JSON_SCHEMA, SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS, validateGptShelfResponse } from "./gpt4o.js";

// Optional local model through Ollama, so shelf photos can stay on the owner's
// own network. Output is held to the same strict schema as the OpenAI path.

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_SHELF_MODEL = "qwen2.5vl:7b";
const OLLAMA_TIMEOUT_MS = 120000;

const OllamaChatResponseSchema = z.object({
  message: z.object({ content: z.string() })
});

export function getOllamaBaseUrl(): string | undefined {
  const value = process.env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

export async function generateOllamaShelfAnalysis(input: { caption?: string; photoDataUrl: string }) {
  const baseUrl = getOllamaBaseUrl();
  if (!baseUrl) throw new Error("OLLAMA_URL is not a valid http or https origin.");
  const imageBase64 = input.photoDataUrl.slice(input.photoDataUrl.indexOf(",") + 1);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OLLAMA_SHELF_MODEL?.trim() || DEFAULT_OLLAMA_SHELF_MODEL,
        stream: false,
        format: SHELF_ANALYSIS_JSON_SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS },
          {
            role: "user",
            content: [
              "Analyze the shelf photo for food coaching only.",
              "Identify visibly supported product details, and describe limitations clearly.",
              input.caption ? `User caption: ${input.caption}` : "No user caption supplied."
            ].join(" "),
            images: [imageBase64]
          }
        ]
      })
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
    body = await response.json();
  } finally {
    clearTimeout(timeout);
  }

  const parsed = OllamaChatResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.message.content.trim()) throw new GptShelfValidationError("Ollama returned an empty shelf-analysis response.");
  let candidate: unknown;
  try {
    candidate = JSON.parse(parsed.data.message.content);
  } catch {
    throw new GptShelfValidationError("Ollama returned invalid JSON for shelf analysis.");
  }
  return validateGptShelfResponse(candidate);
}
