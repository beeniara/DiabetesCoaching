import { describeGlucose, type CareTargets, type GlucoseContext } from "./clinical";
import { type GlucoseEvent, type HealthEvent } from "./health-events";
import { sortHealthTimeline } from "./timeline";

export type GlucoseTrendDirection = "rising" | "falling" | "stable" | "limited";

export type GlucoseTrendSummary = {
  direction: GlucoseTrendDirection;
  deltaMmolL?: number;
  comparison?: {
    from: GlucoseEvent;
    to: GlucoseEvent;
  };
  message: string;
  safetyNote: string;
};

export type ClinicianReviewSummary = {
  title: string;
  generatedAt: string;
  totalEvents: number;
  glucoseReadings: number;
  mealEvents: number;
  exerciseEvents: number;
  medicationEvents: number;
  latestGlucose?: GlucoseEvent;
  glucoseTrend: GlucoseTrendSummary;
  targetReview: ReturnType<typeof describeGlucose>;
  notes: string[];
};

export function deriveGlucoseTrend(events: HealthEvent[], targetContext: GlucoseContext, targets: CareTargets): GlucoseTrendSummary {
  const glucoseEvents = sortHealthTimeline(events).filter((event): event is GlucoseEvent => event.type === "glucose");
  const latest = glucoseEvents[0];
  const previous = glucoseEvents[1];

  if (!latest) {
    return {
      direction: "limited",
      message: "No glucose readings are available yet.",
      safetyNote: "Trend interpretation stays limited until at least one glucose reading is logged."
    };
  }

  const targetReview = describeGlucose(latest.valueMmolL, targetContext, targets);

  if (!previous) {
    return {
      direction: "limited",
      message: `Latest glucose is ${latest.valueMmolL.toFixed(1)} mmol/L. Trend is limited because there is only one reading.`,
      safetyNote: targetReview.safetyNote
    };
  }

  const delta = latest.valueMmolL - previous.valueMmolL;
  const magnitude = Math.abs(delta);
  const direction: GlucoseTrendDirection = magnitude < 0.4 ? "stable" : delta > 0 ? "rising" : "falling";
  const label = direction === "stable" ? "stable" : direction;

  return {
    direction,
    deltaMmolL: delta,
    comparison: { from: previous, to: latest },
    message: `Latest glucose is ${latest.valueMmolL.toFixed(1)} mmol/L and appears ${label} versus the prior reading (${previous.valueMmolL.toFixed(1)} mmol/L).`,
    safetyNote: latest.compartment === "interstitial-fluid"
      ? "Interpret this trend cautiously because interstitial glucose may lag behind capillary blood glucose."
      : targetReview.safetyNote
  };
}

export function buildClinicianReviewSummary(
  events: HealthEvent[],
  targetContext: GlucoseContext,
  targets: CareTargets
): ClinicianReviewSummary {
  const ordered = sortHealthTimeline(events);
  const glucoseTrend = deriveGlucoseTrend(ordered, targetContext, targets);
  const latestGlucose = ordered.find((event): event is GlucoseEvent => event.type === "glucose");
  const targetReview = latestGlucose
    ? describeGlucose(latestGlucose.valueMmolL, targetContext, targets)
    : describeGlucose(targetContext === "fasting" ? targets.fastingMinMmolL : targets.postprandialMaxMmolL, targetContext, targets);

  return {
    title: "Clinician review summary",
    generatedAt: new Date().toISOString(),
    totalEvents: ordered.length,
    glucoseReadings: ordered.filter((event) => event.type === "glucose").length,
    mealEvents: ordered.filter((event) => event.type === "meal").length,
    exerciseEvents: ordered.filter((event) => event.type === "exercise").length,
    medicationEvents: ordered.filter((event) => event.type === "medication").length,
    latestGlucose,
    glucoseTrend,
    targetReview,
    notes: [
      "This summary is for discussion and pattern review only.",
      "It does not diagnose, calculate doses, change medication, or replace urgent care."
    ]
  };
}

export function formatClinicianReviewSummary(summary: ClinicianReviewSummary) {
  const lines = [
    summary.title,
    `Generated: ${summary.generatedAt}`,
    `Events: ${summary.totalEvents} total | glucose ${summary.glucoseReadings} | meals ${summary.mealEvents} | exercise ${summary.exerciseEvents} | medication ${summary.medicationEvents}`,
    summary.latestGlucose ? `Latest glucose: ${summary.latestGlucose.valueMmolL.toFixed(1)} mmol/L (${summary.latestGlucose.compartment})` : "Latest glucose: none recorded",
    `Trend: ${summary.glucoseTrend.message}`,
    `Target review: ${summary.targetReview.message}`,
    `Safety note: ${summary.glucoseTrend.safetyNote}`,
    ...summary.notes.map((note) => `Note: ${note}`)
  ];
  return lines.join("\n");
}
