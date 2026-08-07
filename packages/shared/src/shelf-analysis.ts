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
