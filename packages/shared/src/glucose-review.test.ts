import { describe, expect, it } from "vitest";
import { DEFAULT_CARE_TARGETS } from "./clinical";
import { buildClinicianReviewSummary, deriveGlucoseTrend, formatClinicianReviewSummary } from "./glucose-review";
import { mockDelayedCloudCgm, mockImuExercise, mockMealVision } from "./mocks";

describe("glucose review", () => {
  it("derives a cautious glucose trend and clinician summary", () => {
    const prior = { ...mockDelayedCloudCgm(), id: "prior", occurredAt: "2026-08-08T07:10:00+12:00", receivedAt: "2026-08-08T07:20:00+12:00", valueMmolL: 7.9 };
    const latest = { ...prior, id: "latest", occurredAt: "2026-08-08T07:40:00+12:00", receivedAt: "2026-08-08T07:50:00+12:00", valueMmolL: 8.8, quality: "valid" as const, sensorDelayMinutes: 20 };
    const summary = buildClinicianReviewSummary([mockMealVision(), mockImuExercise(), prior, latest], "postprandial", DEFAULT_CARE_TARGETS);
    expect(summary.totalEvents).toBe(4);
    expect(summary.latestGlucose?.valueMmolL).toBe(8.8);
    expect(summary.glucoseTrend.direction).toBe("rising");
    expect(formatClinicianReviewSummary(summary)).toContain("Trend:");
  });

  it("returns a limited trend when only one glucose reading exists", () => {
    const trend = deriveGlucoseTrend([mockDelayedCloudCgm()], "fasting", DEFAULT_CARE_TARGETS);
    expect(trend.direction).toBe("limited");
    expect(trend.message).toContain("only one reading");
  });
});
