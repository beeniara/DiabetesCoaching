import { z } from "zod";

export const ShelfAnalysisSchema = z.object({
  schemaVersion: z.literal("1.0"),
  items: z.array(z.object({
    label: z.string().min(1).max(120),
    confidence: z.number().min(0).max(1),
    visibleNutritionFacts: z.array(z.string().max(160)).max(8),
    coachingPrompt: z.string().min(1).max(280)
  })).max(20),
  limitations: z.array(z.string().min(1).max(200)).min(1).max(5),
  safetyNotice: z.literal("Confirm labels and ingredients before making food choices. This is general coaching information, not medical advice.")
}).strict();

export type ShelfAnalysis = z.infer<typeof ShelfAnalysisSchema>;

export function createMockShelfAnalysis(input?: { caption?: string; photoUri?: string }): ShelfAnalysis {
  const caption = input?.caption?.trim().toLowerCase() ?? "";
  const itemLabel = caption.includes("drink")
    ? "Beverage"
    : caption.includes("snack")
      ? "Snack pack"
      : "Packaged food";

  return ShelfAnalysisSchema.parse({
    schemaVersion: "1.0",
    items: [
      {
        label: itemLabel,
        confidence: 0.82,
        visibleNutritionFacts: ["Label text may be partially visible", "Confirm serving size on the package"],
        coachingPrompt: "Check the label and ingredient list before using this estimate for meal planning."
      }
    ],
    limitations: [
      "This is a local mock response for app testing.",
      input?.photoUri ? "The photo URI was queued locally and was not sent to a server." : "No photo URI was supplied.",
      "Confirm the actual package details before making food choices."
    ],
    safetyNotice: "Confirm labels and ingredients before making food choices. This is general coaching information, not medical advice."
  });
}

export function formatShelfAnalysisSummary(analysis: ShelfAnalysis) {
  return [
    `Items: ${analysis.items.map((item) => `${item.label} (${Math.round(item.confidence * 100)}%)`).join(", ")}`,
    `Limitations: ${analysis.limitations.join(" | ")}`,
    analysis.safetyNotice
  ].join("\n");
}
