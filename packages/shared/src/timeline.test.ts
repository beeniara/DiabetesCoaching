import { describe, expect, it } from "vitest";
import { mockDelayedCloudCgm, mockImuExercise, mockMealVision } from "./mocks";
import { formatTimelineLabel, summarizeTimeline } from "./timeline";

describe("timeline helpers", () => {
  it("sorts events and surfaces freshness warnings", () => {
    const summary = summarizeTimeline([mockMealVision(), mockImuExercise(), mockDelayedCloudCgm()]);
    expect(summary.freshness).toBe("delayed");
    expect(summary.counts.glucose).toBe(1);
    expect(summary.warning).toContain("interstitial");
  });

  it("formats concise labels for the dashboard", () => {
    expect(formatTimelineLabel(mockMealVision())).toContain("Meal");
    expect(formatTimelineLabel(mockImuExercise())).toContain("Cycling");
  });

  it("distinguishes stale real data from current data", () => {
    const event = { ...mockDelayedCloudCgm(), quality: "valid" as const, sensorDelayMinutes: 0 };
    const summary = summarizeTimeline([event], new Date("2026-08-08T14:30:00+12:00"));
    expect(summary.freshness).toBe("stale");
    expect(summary.warning).toContain("hours ago");
  });
});
