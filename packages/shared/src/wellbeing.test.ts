import { describe, expect, it } from "vitest";
import { formatCheckInLabel, parseWellbeingCheckIn, reviewWellbeing, type WellbeingCheckIn } from "./wellbeing";

const NOW = new Date("2026-09-18T04:00:00.000Z");

function checkIn(overrides: Partial<WellbeingCheckIn> & { occurredAt: string }): WellbeingCheckIn {
  return { id: `ci-${overrides.occurredAt}`, userId: "demo-user", timezone: "Pacific/Auckland", ...overrides };
}

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86400000).toISOString();
}

describe("parseWellbeingCheckIn", () => {
  it("rejects empty check-ins", () => {
    expect(parseWellbeingCheckIn(checkIn({ occurredAt: daysAgo(0) }), NOW).issue).toMatch(/at least one detail/);
    expect(parseWellbeingCheckIn(checkIn({ occurredAt: daysAgo(0), notes: "   " }), NOW).issue).toMatch(/at least one detail/);
  });

  it("rejects future and out-of-range values", () => {
    expect(parseWellbeingCheckIn(checkIn({ occurredAt: daysAgo(-1), mood: "good" }), NOW).issue).toMatch(/future/);
    expect(parseWellbeingCheckIn(checkIn({ occurredAt: daysAgo(0), sleepHours: 30 }), NOW).issue).toBeDefined();
    expect(parseWellbeingCheckIn({ ...checkIn({ occurredAt: daysAgo(0) }), mood: "ecstatic" }, NOW).issue).toBeDefined();
  });

  it("accepts a valid check-in", () => {
    const result = parseWellbeingCheckIn(checkIn({ occurredAt: daysAgo(0), sleepHours: 7.5, mood: "good", footCheckDone: true }), NOW);
    expect(result.checkIn?.sleepHours).toBe(7.5);
    expect(result.issue).toBeUndefined();
  });
});

describe("reviewWellbeing", () => {
  it("prompts for check-ins when none exist", () => {
    const review = reviewWellbeing([], NOW);
    expect(review.checkInsInWindow).toBe(0);
    expect(review.messages[0]).toMatch(/No check-ins/);
  });

  it("flags short sleep, high stress, low mood, and missing foot checks", () => {
    const checkIns = [0, 1, 2, 3].map((day) => checkIn({ occurredAt: daysAgo(day), sleepHours: 5.5, stress: "high", mood: "low" }));
    const review = reviewWellbeing(checkIns, NOW);
    expect(review.averageSleepHours).toBe(5.5);
    expect(review.shortSleepNights).toBe(4);
    expect(review.highStressDays).toBe(4);
    expect(review.lowMoodDays).toBe(4);
    expect(review.messages.join(" ")).toMatch(/under 7 hours/);
    expect(review.messages.join(" ")).toMatch(/Stress has been high/);
    expect(review.messages.join(" ")).toMatch(/Mood has been low/);
    expect(review.messages.join(" ")).toMatch(/No foot checks/);
  });

  it("ignores check-ins outside the window", () => {
    const review = reviewWellbeing([checkIn({ occurredAt: daysAgo(9), sleepHours: 4 })], NOW);
    expect(review.checkInsInWindow).toBe(0);
    expect(review.averageSleepHours).toBeUndefined();
  });

  it("stays quiet when things look steady", () => {
    const checkIns = [0, 1, 2].map((day) => checkIn({ occurredAt: daysAgo(day), sleepHours: 8, stress: "low", mood: "good", footCheckDone: true }));
    const review = reviewWellbeing(checkIns, NOW);
    expect(review.messages).toHaveLength(0);
  });
});

describe("formatCheckInLabel", () => {
  it("summarises the recorded fields", () => {
    expect(formatCheckInLabel(checkIn({ occurredAt: daysAgo(0), sleepHours: 7, mood: "okay", footCheckDone: true }))).toBe("sleep 7 h · mood okay · feet checked");
    expect(formatCheckInLabel(checkIn({ occurredAt: daysAgo(0), notes: "Long day at work" }))).toBe("Long day at work");
  });
});
