import { z } from "zod";

export const GlucoseCompartmentSchema = z.enum(["capillary-blood", "interstitial-fluid"]);
export type GlucoseCompartment = z.infer<typeof GlucoseCompartmentSchema>;

export const DataQualitySchema = z.enum([
  "valid",
  "delayed",
  "estimated",
  "suspect",
  "missing",
  "conflicting"
]);
export type DataQuality = z.infer<typeof DataQualitySchema>;

export const SourceTypeSchema = z.enum([
  "manual",
  "ble-bgm",
  "ble-cgm",
  "cloud-cgm",
  "health-platform",
  "meal-vision",
  "imu",
  "medication-plan"
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

const BaseEventSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum(["glucose", "meal", "exercise", "medication"]),
  source: SourceTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  receivedAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1),
  confidence: z.number().min(0).max(1),
  quality: DataQualitySchema,
  notes: z.string().max(1000).optional()
});

export const GlucoseEventSchema = BaseEventSchema.extend({
  type: z.literal("glucose"),
  valueMmolL: z.number().finite().positive(),
  compartment: GlucoseCompartmentSchema,
  trendMmolLPerMin: z.number().finite().optional(),
  sensorDelayMinutes: z.number().finite().nonnegative().optional(),
  context: z.enum(["fasting", "postprandial", "exercise", "random"]).optional()
});
export type GlucoseEvent = z.infer<typeof GlucoseEventSchema>;

export const MealEventSchema = BaseEventSchema.extend({
  type: z.literal("meal"),
  description: z.string().min(1),
  carbohydrateGrams: z.number().finite().nonnegative().optional(),
  carbohydrateRangeGrams: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }).optional(),
  proteinGrams: z.number().finite().nonnegative().optional(),
  fatGrams: z.number().finite().nonnegative().optional(),
  fiberGrams: z.number().finite().nonnegative().optional(),
  imageUri: z.string().optional(),
  portionConfidence: z.number().min(0).max(1).optional()
});
export type MealEvent = z.infer<typeof MealEventSchema>;

export const ExerciseEventSchema = BaseEventSchema.extend({
  type: z.literal("exercise"),
  activity: z.string().min(1),
  durationMinutes: z.number().finite().positive(),
  intensity: z.enum(["light", "moderate", "vigorous"]),
  detectedFromImu: z.boolean()
});
export type ExerciseEvent = z.infer<typeof ExerciseEventSchema>;

export const MedicationEventSchema = BaseEventSchema.extend({
  type: z.literal("medication"),
  medicationName: z.string().min(1),
  status: z.enum(["scheduled", "taken", "skipped", "snoozed", "unknown"]),
  prescribedDoseLabel: z.string().optional()
});
export type MedicationEvent = z.infer<typeof MedicationEventSchema>;

export const HealthEventSchema = z.discriminatedUnion("type", [
  GlucoseEventSchema,
  MealEventSchema,
  ExerciseEventSchema,
  MedicationEventSchema
]);
export type HealthEvent = z.infer<typeof HealthEventSchema>;

export type ValidationIssue = {
  code: "invalid" | "delayed" | "duplicate" | "out-of-order" | "conflict" | "lag-risk";
  message: string;
  eventId?: string;
};

export function parseHealthEvent(input: unknown): { event?: HealthEvent; issues: ValidationIssue[] } {
  const parsed = HealthEventSchema.safeParse(input);
  if (!parsed.success) return { issues: [{ code: "invalid", message: parsed.error.issues.map((issue) => issue.message).join("; ") }] };

  const event = parsed.data;
  const issues: ValidationIssue[] = [];
  const delayMinutes = Math.max(0, (Date.parse(event.receivedAt) - Date.parse(event.occurredAt)) / 60000);
  if (delayMinutes > 60) issues.push({ code: "delayed", message: `Reading was received ${Math.round(delayMinutes)} minutes after it occurred.`, eventId: event.id });
  if (event.type === "glucose" && event.compartment === "interstitial-fluid") {
    const rate = Math.abs(event.trendMmolLPerMin ?? 0);
    if (rate >= 0.1 || event.context === "postprandial" || event.context === "exercise") {
      issues.push({ code: "lag-risk", message: "Interstitial glucose may lag behind capillary blood glucose during rapid change, meals, or exercise.", eventId: event.id });
    }
  }
  return { event, issues };
}

export function classifyEventQuality(event: HealthEvent, issues: ValidationIssue[]): DataQuality {
  if (issues.some((issue) => issue.code === "conflict")) return "conflicting";
  if (issues.some((issue) => issue.code === "invalid")) return "suspect";
  if (issues.some((issue) => issue.code === "delayed")) return "delayed";
  if (event.type === "meal" && event.portionConfidence !== undefined && event.portionConfidence < 0.7) return "estimated";
  if (event.type === "glucose" && event.compartment === "interstitial-fluid" && issues.some((issue) => issue.code === "lag-risk")) return "suspect";
  return event.quality;
}

export function mergeHealthEvents(events: HealthEvent[]): { events: HealthEvent[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  let lastSeenOccurredAt = Number.NEGATIVE_INFINITY;
  const byTimestamp = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const merged: HealthEvent[] = [];
  for (const event of events) {
    const occurredAt = Date.parse(event.occurredAt);
    if (occurredAt < lastSeenOccurredAt) {
      issues.push({
        code: "out-of-order",
        message: "An event arrived out of sequence. The timeline was re-sorted before display.",
        eventId: event.id
      });
    }
    lastSeenOccurredAt = Math.max(lastSeenOccurredAt, occurredAt);
  }
  for (const event of byTimestamp) {
    if (seen.has(event.id)) {
      issues.push({ code: "duplicate", message: "Duplicate event ignored.", eventId: event.id });
      continue;
    }
    seen.add(event.id);
    const previous = merged.at(-1);
    if (previous?.type === "glucose" && event.type === "glucose" && previous.compartment === event.compartment && Math.abs(Date.parse(previous.occurredAt) - Date.parse(event.occurredAt)) < 120000 && Math.abs(previous.valueMmolL - event.valueMmolL) > 3) {
      issues.push({ code: "conflict", message: "Nearby glucose readings conflict materially; review before relying on the trend.", eventId: event.id });
    }
    merged.push(event);
  }
  return { events: merged, issues };
}

export function safeGlucoseDisplay(event: GlucoseEvent): { label: string; warning?: string } {
  const lagWarning = event.compartment === "interstitial-fluid" && (event.sensorDelayMinutes ?? 0) > 0
    ? "Interstitial-fluid reading; it may lag behind blood glucose."
    : undefined;
  const freshness = event.quality === "delayed" ? "Delayed reading" : event.quality === "suspect" ? "Review reading" : "Current reading";
  return { label: `${freshness}: ${event.valueMmolL.toFixed(1)} mmol/L`, warning: lagWarning };
}
