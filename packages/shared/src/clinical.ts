import { z } from "zod";

export type GlucoseContext = "fasting" | "postprandial";

export const CareTargetsSchema = z.object({
  fastingMinMmolL: z.number().finite().positive().max(40),
  fastingMaxMmolL: z.number().finite().positive().max(40),
  postprandialMaxMmolL: z.number().finite().positive().max(40),
  hba1cMaxMmolMol: z.number().finite().positive().max(250),
  clinicianReviewed: z.boolean()
}).refine((targets) => targets.fastingMinMmolL <= targets.fastingMaxMmolL, {
  message: "Fasting minimum must not exceed fasting maximum.",
  path: ["fastingMaxMmolL"]
});
export type CareTargets = z.infer<typeof CareTargetsSchema>;

export const DEFAULT_CARE_TARGETS: CareTargets = CareTargetsSchema.parse({
  fastingMinMmolL: 6.0,
  fastingMaxMmolL: 8.0,
  postprandialMaxMmolL: 10.0,
  hba1cMaxMmolMol: 53,
  clinicianReviewed: false
});

export const MEDICATION_CONTEXT = {
  glipizide: "Record as prescribed. Do not offer dose or missed-dose changes; prompt pharmacist or clinician review.",
  jardiamet: "Contains empagliflozin/metformin. Record as prescribed; do not offer dose or sick-day changes.",
  atorvastatin: "Record as prescribed. Do not offer dose changes.",
  candesartan: "Record as prescribed. Do not offer dose changes."
} as const;

export function describeGlucose(valueMmolL: number, context: GlucoseContext, targets: CareTargets) {
  const validatedTargets = CareTargetsSchema.parse(targets);
  const inRange = context === "fasting"
    ? valueMmolL >= validatedTargets.fastingMinMmolL && valueMmolL <= validatedTargets.fastingMaxMmolL
    : valueMmolL < validatedTargets.postprandialMaxMmolL;
  return {
    inRange,
    message: inRange
      ? "This result is within the current app target context. Continue your agreed care plan."
      : "This result is outside the current app target context. Record how you feel and discuss patterns with your diabetes care team.",
    safetyNote: "This app does not diagnose, change medication, or manage urgent situations. If you feel very unwell or are concerned, seek urgent local care."
  };
}
