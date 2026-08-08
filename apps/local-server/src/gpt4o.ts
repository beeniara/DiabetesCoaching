import { ShelfAnalysisSchema, type ShelfAnalysis } from "../../../packages/shared/src/shelf-analysis.js";

/**
 * Integration seam only. Implement this on the local server after consent,
 * approved retention settings, and production authentication are in place.
 * Never return an LLM response until it passes the shared strict schema.
 */
export async function validateGptShelfResponse(candidate: unknown): Promise<ShelfAnalysis> {
  return ShelfAnalysisSchema.parse(candidate);
}

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export const SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS = [
  "Return JSON only; no Markdown or prose outside JSON.",
  "Identify only visibly supported product information; state limitations when labels are unclear.",
  "Do not diagnose, prescribe, recommend medication changes, or provide emergency advice.",
  "Use the agreed ShelfAnalysis schema exactly."
].join(" ");
