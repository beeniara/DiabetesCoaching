import { type HealthEvent } from "./health-events";

export type TimelineFreshness = "current" | "delayed" | "stale" | "limited";

export type TimelineSummary = {
  events: HealthEvent[];
  freshness: TimelineFreshness;
  warning: string;
  latestEvent?: HealthEvent;
  latestGlucose?: Extract<HealthEvent, { type: "glucose" }>;
  counts: Record<HealthEvent["type"], number>;
  unreadableCount: number;
  unreadableNotice?: string;
};

export function sortHealthTimeline(events: HealthEvent[]): HealthEvent[] {
  return [...events].sort((a, b) => {
    const timeDelta = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    if (timeDelta !== 0) return timeDelta;
    return Date.parse(b.receivedAt) - Date.parse(a.receivedAt);
  });
}

export function summarizeTimeline(events: HealthEvent[], now = new Date(), unreadableCount = 0): TimelineSummary {
  const ordered = sortHealthTimeline(events);
  const counts: Record<HealthEvent["type"], number> = {
    glucose: 0,
    meal: 0,
    exercise: 0,
    medication: 0
  };

  for (const event of ordered) counts[event.type] += 1;

  const latestEvent = ordered[0];
  const latestGlucose = ordered.find((event): event is Extract<HealthEvent, { type: "glucose" }> => event.type === "glucose");
  const delayedGlucose = latestGlucose?.quality === "delayed" || (latestGlucose?.sensorDelayMinutes ?? 0) > 60;
  const glucoseAgeMinutes = latestGlucose ? Math.max(0, (now.getTime() - Date.parse(latestGlucose.occurredAt)) / 60000) : undefined;
  const freshness: TimelineFreshness = delayedGlucose
    ? "delayed"
    : glucoseAgeMinutes !== undefined && glucoseAgeMinutes > 180
      ? "stale"
      : latestEvent && unreadableCount === 0
        ? "current"
        : "limited";
  const warning = latestGlucose
    ? latestGlucose.quality === "conflicting"
      ? "Latest glucose conflicts with a nearby reading. Review the source data before relying on a trend."
      : latestGlucose.quality === "suspect"
        ? "Latest glucose has a data-quality issue. Review its timestamp, source, and device clock."
        : latestGlucose.compartment === "interstitial-fluid" && (latestGlucose.sensorDelayMinutes ?? 0) > 0
      ? "Latest glucose may lag behind blood glucose because it came from interstitial fluid."
      : latestGlucose.quality === "delayed"
        ? "Latest glucose was received late from the source device or cloud service."
        : glucoseAgeMinutes !== undefined && glucoseAgeMinutes > 180
          ? `Latest glucose was recorded ${Math.round(glucoseAgeMinutes / 60)} hours ago and may not reflect the current situation.`
          : "Latest glucose is current for the app's timeline."
    : "No glucose data has been logged yet.";

  const unreadableNotice = unreadableCount > 0
    ? `${unreadableCount} saved ${unreadableCount === 1 ? "record could not be read and is" : "records could not be read and are"} not shown, so this timeline and the latest reading may be incomplete.`
    : undefined;

  return { events: ordered, freshness, warning, latestEvent, latestGlucose, counts, unreadableCount, unreadableNotice };
}

export function describeTimelineFreshness(summary: Pick<TimelineSummary, "freshness" | "unreadableCount">): string {
  const alsoUnreadable = summary.unreadableCount > 0 ? " Some saved records also could not be read." : "";
  if (summary.freshness === "current") return "Data freshness status: current.";
  if (summary.freshness === "delayed") return `Data freshness status: delayed, because the latest glucose reading arrived late or carries a sensor delay.${alsoUnreadable}`;
  if (summary.freshness === "stale") return `Data freshness status: stale, because the latest glucose reading is more than 3 hours old.${alsoUnreadable}`;
  return summary.unreadableCount > 0
    ? "Data freshness status: limited, because some saved records could not be read."
    : "Data freshness status: limited, because nothing has been logged yet.";
}

export function formatTimelineLabel(event: HealthEvent): string {
  if (event.type === "glucose") return `Glucose ${event.valueMmolL.toFixed(1)} mmol/L`;
  if (event.type === "meal") {
    const carbs = event.carbohydrateRangeGrams
      ? `${event.carbohydrateRangeGrams.min}-${event.carbohydrateRangeGrams.max} g`
      : event.carbohydrateGrams !== undefined
        ? `${event.carbohydrateGrams} g`
        : "carbohydrate estimate pending";
    return `Meal ${carbs}`;
  }
  if (event.type === "exercise") return `${event.activity} for ${event.durationMinutes} min`;
  return `${event.medicationName} - ${event.status}`;
}
