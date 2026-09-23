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
  valueMmolL: z.number().finite().positive().max(100),
  compartment: GlucoseCompartmentSchema,
  trendMmolLPerMin: z.number().finite().optional(),
  sensorDelayMinutes: z.number().finite().nonnegative().optional(),
  context: z.enum(["fasting", "postprandial", "exercise", "random"]).optional()
});
export type GlucoseEvent = z.infer<typeof GlucoseEventSchema>;

const MacronutrientRangeSchema = z.object({
  min: z.number().finite().nonnegative(),
  max: z.number().finite().nonnegative()
}).refine((range) => range.min <= range.max, {
  message: "Estimated range minimum must not exceed its maximum.",
  path: ["max"]
});

export const MealEventSchema = BaseEventSchema.extend({
  type: z.literal("meal"),
  description: z.string().min(1),
  carbohydrateGrams: z.number().finite().nonnegative().optional(),
  carbohydrateRangeGrams: MacronutrientRangeSchema.optional(),
  proteinGrams: z.number().finite().nonnegative().optional(),
  fatGrams: z.number().finite().nonnegative().optional(),
  fiberGrams: z.number().finite().nonnegative().optional(),
  imageUri: z.string().optional(),
  portionConfidence: z.number().min(0).max(1).optional()
});
export type MealEvent = z.infer<typeof MealEventSchema>;

export const ExerciseCategorySchema = z.enum(["aerobic", "resistance", "flexibility", "balance", "everyday"]);
export type ExerciseCategory = z.infer<typeof ExerciseCategorySchema>;

export const ExerciseEventSchema = BaseEventSchema.extend({
  type: z.literal("exercise"),
  activity: z.string().min(1),
  durationMinutes: z.number().finite().positive().max(24 * 60),
  intensity: z.enum(["light", "moderate", "vigorous"]),
  category: ExerciseCategorySchema.optional(),
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

export function parseHealthEvent(input: unknown, now = new Date()): { event?: HealthEvent; issues: ValidationIssue[] } {
  const parsed = HealthEventSchema.safeParse(input);
  if (!parsed.success) return { issues: [{ code: "invalid", message: parsed.error.issues.map((issue) => issue.message).join("; ") }] };

  const event = parsed.data;
  const issues: ValidationIssue[] = [];
  const occurredAtMs = Date.parse(event.occurredAt);
  const receivedAtMs = Date.parse(event.receivedAt);
  const delayMinutes = Math.max(0, (receivedAtMs - occurredAtMs) / 60000);
  if (receivedAtMs + 5 * 60000 < occurredAtMs) {
    issues.push({ code: "invalid", message: "Received time is earlier than the event time; review the device clock and timezone.", eventId: event.id });
  }
  if (occurredAtMs > now.getTime() + 5 * 60000) {
    issues.push({ code: "invalid", message: "Event time is in the future; review the device clock and timezone.", eventId: event.id });
  }
  if (delayMinutes > 60) issues.push({ code: "delayed", message: `Reading was received ${Math.round(delayMinutes)} minutes after it occurred.`, eventId: event.id });
  if (event.type === "glucose" && event.compartment === "interstitial-fluid") {
    const rate = Math.abs(event.trendMmolLPerMin ?? 0);
    if (rate >= 0.1 || event.context === "postprandial" || event.context === "exercise") {
      issues.push({ code: "lag-risk", message: "Interstitial glucose may lag behind capillary blood glucose during rapid change, meals, or exercise.", eventId: event.id });
    }
  }
  return { event, issues };
}

export function normalizeHealthEvent(input: unknown, now = new Date()): { event?: HealthEvent; issues: ValidationIssue[] } {
  const parsed = parseHealthEvent(input, now);
  if (!parsed.event) return parsed;
  return {
    event: { ...parsed.event, quality: classifyEventQuality(parsed.event, parsed.issues) } as HealthEvent,
    issues: parsed.issues
  };
}

export function parseStoredHealthEvents(payloads: string[], now = new Date()): { events: HealthEvent[]; unreadableCount: number } {
  const events: HealthEvent[] = [];
  let unreadableCount = 0;
  for (const payload of payloads) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(payload);
    } catch {
      unreadableCount += 1;
      continue;
    }
    const parsed = normalizeHealthEvent(candidate, now);
    if (parsed.event) events.push(parsed.event);
    else unreadableCount += 1;
  }
  return { events, unreadableCount };
}

export function classifyEventQuality(event: HealthEvent, issues: ValidationIssue[]): DataQuality {
  if (event.quality === "conflicting") return "conflicting";
  if (issues.some((issue) => issue.code === "conflict")) return "conflicting";
  if (issues.some((issue) => issue.code === "invalid")) return "suspect";
  if (issues.some((issue) => issue.code === "delayed")) return "delayed";
  if (event.type === "meal" && event.portionConfidence !== undefined && event.portionConfidence < 0.7) return "estimated";
  if (event.type === "glucose" && event.compartment === "interstitial-fluid" && issues.some((issue) => issue.code === "lag-risk")) return "suspect";
  return event.quality;
}

export function mergeHealthEvents(events: HealthEvent[]): { events: HealthEvent[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();
  let lastSeenOccurredAt = Number.NEGATIVE_INFINITY;
  const byTimestamp = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const merged: HealthEvent[] = [];
  const lastGlucoseIndexByCompartment = new Map<GlucoseCompartment, number>();
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
    const existingIndex = seen.get(event.id);
    if (existingIndex !== undefined) {
      issues.push({ code: "duplicate", message: "Duplicate event ignored.", eventId: event.id });
      const existing = merged[existingIndex];
      if (JSON.stringify(existing) !== JSON.stringify(event)) {
        issues.push({ code: "conflict", message: "Duplicate event ID contained contradictory data; review the source before relying on it.", eventId: event.id });
        merged[existingIndex] = { ...existing, quality: "conflicting" } as HealthEvent;
      }
      continue;
    }
    seen.set(event.id, merged.length);
    if (event.type === "glucose") {
      const previousIndex = lastGlucoseIndexByCompartment.get(event.compartment);
      const previous = previousIndex !== undefined ? (merged[previousIndex] as GlucoseEvent) : undefined;
      if (previous && Math.abs(Date.parse(previous.occurredAt) - Date.parse(event.occurredAt)) < 120000 && Math.abs(previous.valueMmolL - event.valueMmolL) > 3) {
        issues.push({ code: "conflict", message: "Nearby glucose readings conflict materially; review before relying on the trend.", eventId: event.id });
        merged[previousIndex as number] = { ...previous, quality: "conflicting" };
        merged.push({ ...event, quality: "conflicting" });
        lastGlucoseIndexByCompartment.set(event.compartment, merged.length - 1);
        continue;
      }
      merged.push(event);
      lastGlucoseIndexByCompartment.set(event.compartment, merged.length - 1);
      continue;
    }
    merged.push(event);
  }
  return { events: merged, issues };
}

export function safeGlucoseDisplay(event: GlucoseEvent): { label: string; warning?: string } {
  const lagWarning = event.compartment === "interstitial-fluid" && (event.sensorDelayMinutes ?? 0) > 0
    ? "Interstitial-fluid reading; it may lag behind blood glucose."
    : undefined;
  const freshness = event.quality === "delayed"
    ? "Delayed reading"
    : event.quality === "suspect" || event.quality === "conflicting"
      ? "Review reading"
      : "Recorded reading";
  return { label: `${freshness}: ${event.valueMmolL.toFixed(1)} mmol/L`, warning: lagWarning };
}
