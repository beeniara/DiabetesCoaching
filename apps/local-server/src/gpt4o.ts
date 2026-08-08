import OpenAI from "openai";
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

const SHELF_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "items", "limitations", "safetyNotice"],
  properties: {
    schemaVersion: { type: "string", const: "1.0" },
    items: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "confidence", "visibleNutritionFacts", "coachingPrompt"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 120 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibleNutritionFacts: {
            type: "array",
            maxItems: 8,
            items: { type: "string", maxLength: 160 }
          },
          coachingPrompt: { type: "string", minLength: 1, maxLength: 280 }
        }
      }
    },
    limitations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 200 }
    },
    safetyNotice: {
      type: "string",
      const: "Confirm labels and ingredients before making food choices. This is general coaching information, not medical advice."
    }
  }
} as const;

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export async function generateGptShelfAnalysis(input: { caption?: string; photoDataUrl: string }) {
  const client = getOpenAiClient();
  if (!client) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await client.responses.create({
    model: process.env.OPENAI_SHELF_MODEL?.trim() || "gpt-4o",
    input: [
      {
        role: "system",
        content: SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Analyze the shelf photo for food coaching only.",
              "Identify visibly supported product details, and describe limitations clearly.",
              input.caption ? `User caption: ${input.caption}` : "No user caption supplied."
            ].join(" ")
          },
          {
            type: "input_image",
            image_url: input.photoDataUrl,
            detail: "low"
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "shelf_analysis",
        description: "Strict shelf-analysis summary for local diabetes coaching.",
        strict: true,
        schema: SHELF_ANALYSIS_JSON_SCHEMA
      }
    }
  });

  const outputText = response.output_text;
  if (!outputText) throw new Error("OpenAI returned an empty shelf-analysis response.");
  return validateGptShelfResponse(JSON.parse(outputText));
}

export const SHELF_ANALYSIS_SYSTEM_INSTRUCTIONS = [
  "Return JSON only; no Markdown or prose outside JSON.",
  "Identify only visibly supported product information; state limitations when labels are unclear.",
  "Do not diagnose, prescribe, recommend medication changes, or provide emergency advice.",
  "Use the agreed ShelfAnalysis schema exactly."
].join(" ");
