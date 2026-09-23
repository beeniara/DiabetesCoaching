import { describe, expect, it } from "vitest";
import { mockDelayedCloudCgm, mockImuExercise, mockMealVision } from "./mocks";
import { describeTimelineFreshness, formatTimelineLabel, summarizeTimeline } from "./timeline";

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

  it("never reports an incomplete timeline as current and explains why", () => {
    const event = { ...mockDelayedCloudCgm(), quality: "valid" as const, sensorDelayMinutes: 0 };
    const now = new Date("2026-08-08T07:40:00+12:00");
    expect(summarizeTimeline([event], now).freshness).toBe("current");
    expect(summarizeTimeline([event], now).unreadableNotice).toBeUndefined();

    const incomplete = summarizeTimeline([event], now, 2);
    expect(incomplete.freshness).toBe("limited");
    expect(incomplete.unreadableNotice).toContain("2 saved records could not be read");
  });

  it("reports unreadable records even when nothing readable remains", () => {
    const summary = summarizeTimeline([], new Date(), 1);
    expect(summary.freshness).toBe("limited");
    expect(summary.unreadableNotice).toContain("1 saved record could not be read and is not shown");
  });

  it("explains every freshness status in words, including why it is limited", () => {
    const event = { ...mockDelayedCloudCgm(), quality: "valid" as const, sensorDelayMinutes: 0 };
    const now = new Date("2026-08-08T07:40:00+12:00");
    expect(describeTimelineFreshness(summarizeTimeline([event], now))).toBe("Data freshness status: current.");
    expect(describeTimelineFreshness(summarizeTimeline([event], now, 2))).toBe("Data freshness status: limited, because some saved records could not be read.");
    expect(describeTimelineFreshness(summarizeTimeline([], now))).toContain("nothing has been logged yet");
    expect(describeTimelineFreshness(summarizeTimeline([mockDelayedCloudCgm()], now))).toContain("delayed, because");
    const stale = summarizeTimeline([event], new Date("2026-08-08T14:30:00+12:00"), 1);
    expect(describeTimelineFreshness(stale)).toContain("stale, because");
    expect(describeTimelineFreshness(stale)).toContain("also could not be read");
  });
});
