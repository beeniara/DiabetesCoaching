import { describe, expect, it } from "vitest";
import { ACTIVITY_GUIDELINES, buildEncouragement, createDefaultWellnessGoals, inferExerciseCategory, pickDailyTip, suggestTipsForWeek, summarizeWeeklyActivity, WELLNESS_TIPS, WellnessGoalsSchema } from "./coaching";
import { type ExerciseEvent, type HealthEvent } from "./health-events";

const NOW = new Date("2026-09-18T04:00:00.000Z"); // 16:00 NZST
const TZ = "Pacific/Auckland";

function exercise(overrides: Partial<ExerciseEvent> & { occurredAt: string }): ExerciseEvent {
  return {
    id: `ex-${overrides.occurredAt}-${overrides.activity ?? "walk"}`,
    userId: "demo-user",
    type: "exercise",
    source: "manual",
    receivedAt: overrides.occurredAt,
    timezone: TZ,
    confidence: 1,
    quality: "valid",
    activity: "walk",
    durationMinutes: 30,
    intensity: "moderate",
    detectedFromImu: false,
    ...overrides
  };
}

function hoursAgo(hours: number) {
  return new Date(NOW.getTime() - hours * 3600000).toISOString();
}

describe("summarizeWeeklyActivity", () => {
  const goals = createDefaultWellnessGoals(NOW);

  it("counts the streak by local calendar day across the daylight-saving change", () => {
    // NZ clocks go forward on Sunday 27 Sep 2026, so that local day lasts only 23 hours.
    const justAfterMidnightMonday = new Date("2026-09-27T11:30:00.000Z"); // Mon 28 Sep 00:30 NZDT
    const monday = exercise({ occurredAt: "2026-09-27T11:10:00.000Z" }); // Mon 00:10 NZDT
    const sunday = exercise({ occurredAt: "2026-09-26T23:00:00.000Z" }); // Sun 12:00 NZDT
    const saturday = exercise({ occurredAt: "2026-09-26T00:00:00.000Z" }); // Sat 12:00 NZST
    expect(summarizeWeeklyActivity([monday, sunday, saturday], goals, justAfterMidnightMonday, TZ).currentStreakDays).toBe(3);
    expect(summarizeWeeklyActivity([monday, saturday], goals, justAfterMidnightMonday, TZ).currentStreakDays).toBe(1);
  });

  it("reports an empty week safely", () => {
    const summary = summarizeWeeklyActivity([], goals, NOW, TZ);
    expect(summary.sessions).toBe(0);
    expect(summary.progressPercent).toBe(0);
    expect(summary.goalMet).toBe(false);
    expect(summary.currentStreakDays).toBe(0);
    expect(summary.daysSinceLastActivity).toBeUndefined();
  });

  it("counts vigorous minutes double and tracks active days", () => {
    const events: HealthEvent[] = [
      exercise({ occurredAt: hoursAgo(2), durationMinutes: 30, intensity: "moderate" }),
      exercise({ occurredAt: hoursAgo(26), durationMinutes: 20, intensity: "vigorous", activity: "run" }),
      exercise({ occurredAt: hoursAgo(50), durationMinutes: 40, intensity: "light", activity: "stroll" })
    ];
    const summary = summarizeWeeklyActivity(events, goals, NOW, TZ);
    expect(summary.sessions).toBe(3);
    expect(summary.activeDays).toBe(3);
    expect(summary.totalMinutes).toBe(90);
    expect(summary.equivalentModerateMinutes).toBe(70);
    expect(summary.lightMinutes).toBe(40);
    expect(summary.progressPercent).toBe(47);
    expect(summary.currentStreakDays).toBe(3);
    expect(summary.daysSinceLastActivity).toBe(0);
  });

  it("ignores events outside the 7-day window and in the future", () => {
    const events: HealthEvent[] = [
      exercise({ occurredAt: hoursAgo(24 * 8), durationMinutes: 200 }),
      exercise({ occurredAt: hoursAgo(-24), durationMinutes: 200 })
    ];
    const summary = summarizeWeeklyActivity(events, goals, NOW, TZ);
    expect(summary.sessions).toBe(0);
    expect(summary.daysSinceLastActivity).toBe(8);
  });

  it("excludes suspect or conflicting sessions and reports the count", () => {
    const events: HealthEvent[] = [
      exercise({ occurredAt: hoursAgo(3), durationMinutes: 60, quality: "suspect" }),
      exercise({ occurredAt: hoursAgo(4), durationMinutes: 60, quality: "conflicting", activity: "bike" })
    ];
    const summary = summarizeWeeklyActivity(events, goals, NOW, TZ);
    expect(summary.sessions).toBe(0);
    expect(summary.excludedSuspectSessions).toBe(2);
  });

  it("recognises resistance days by category or activity name", () => {
    const events: HealthEvent[] = [
      exercise({ occurredAt: hoursAgo(1), activity: "Strength", category: "resistance" }),
      exercise({ occurredAt: hoursAgo(30), activity: "Resistance bands" }),
      exercise({ occurredAt: hoursAgo(31), activity: "Gym weights" })
    ];
    const summary = summarizeWeeklyActivity(events, goals, NOW, TZ);
    expect(summary.resistanceDays).toBe(2);
    expect(summary.resistanceGoalMet).toBe(true);
  });

  it("meets the goal at 150 equivalent minutes", () => {
    const events: HealthEvent[] = [
      exercise({ occurredAt: hoursAgo(1), durationMinutes: 75, intensity: "vigorous" })
    ];
    const summary = summarizeWeeklyActivity(events, goals, NOW, TZ);
    expect(summary.equivalentModerateMinutes).toBe(ACTIVITY_GUIDELINES.weeklyModerateMinutes);
    expect(summary.goalMet).toBe(true);
    expect(summary.progressPercent).toBe(100);
  });
});

describe("buildEncouragement", () => {
  const goals = createDefaultWellnessGoals(NOW);

  it("invites a first step when nothing is logged", () => {
    const encouragement = buildEncouragement(summarizeWeeklyActivity([], goals, NOW, TZ), goals);
    expect(encouragement.headline).toBe("Let's get moving");
    expect(encouragement.safetyNote).toMatch(/care team/);
  });

  it("acknowledges a lapse without shaming", () => {
    const events: HealthEvent[] = [exercise({ occurredAt: hoursAgo(24 * 10) })];
    const encouragement = buildEncouragement(summarizeWeeklyActivity(events, goals, NOW, TZ), goals);
    expect(encouragement.headline).toBe("Ready when you are");
    expect(encouragement.message).toContain("10 days");
  });

  it("celebrates the goal and points to strength work", () => {
    const events: HealthEvent[] = [exercise({ occurredAt: hoursAgo(1), durationMinutes: 160 })];
    const encouragement = buildEncouragement(summarizeWeeklyActivity(events, goals, NOW, TZ), goals);
    expect(encouragement.headline).toBe("Weekly goal reached");
    expect(encouragement.nextStep).toMatch(/muscle-strengthening/);
  });

  it("gives a concrete remaining-minutes step past halfway", () => {
    const events: HealthEvent[] = [exercise({ occurredAt: hoursAgo(1), durationMinutes: 130 })];
    const encouragement = buildEncouragement(summarizeWeeklyActivity(events, goals, NOW, TZ), goals);
    expect(encouragement.headline).toBe("More than halfway there");
    expect(encouragement.nextStep).toContain("20-minute walk");
  });

  it("never contains dosing or diagnosis language", () => {
    const samples = [
      buildEncouragement(summarizeWeeklyActivity([], goals, NOW, TZ), goals),
      buildEncouragement(summarizeWeeklyActivity([exercise({ occurredAt: hoursAgo(1), durationMinutes: 200 })], goals, NOW, TZ), goals)
    ];
    for (const sample of samples) {
      const text = `${sample.headline} ${sample.message} ${sample.nextStep}`.toLowerCase();
      expect(text).not.toMatch(/\bdose\b|\bunits\b|diagnos|insulin adjust/);
    }
  });
});

describe("tips and goals", () => {
  it("picks a deterministic daily tip", () => {
    const first = pickDailyTip(NOW);
    expect(pickDailyTip(NOW)).toEqual(first);
    expect(pickDailyTip(NOW, "footcare").category).toBe("footcare");
  });

  it("has unique tip ids and a source for every tip", () => {
    expect(new Set(WELLNESS_TIPS.map((tip) => tip.id)).size).toBe(WELLNESS_TIPS.length);
    expect(WELLNESS_TIPS.every((tip) => tip.sourceLabel.length > 0)).toBe(true);
  });

  it("suggests targeted tips and caps the list", () => {
    const goals = createDefaultWellnessGoals(NOW);
    const summary = summarizeWeeklyActivity([], goals, NOW, TZ);
    const tips = suggestTipsForWeek(summary, { averageSleepHours: 5.5, highStressDays: 3, footChecksDone: 0, hasCheckIns: true });
    expect(tips.length).toBeLessThanOrEqual(4);
    expect(tips.map((tip) => tip.id)).toContain("activity-after-meals");
    expect(tips.map((tip) => tip.id)).toContain("sleep-hours");
  });

  it("validates goal bounds", () => {
    expect(WellnessGoalsSchema.safeParse({ ...createDefaultWellnessGoals(NOW), weeklyActiveMinutes: 5 }).success).toBe(false);
    expect(WellnessGoalsSchema.safeParse(createDefaultWellnessGoals(NOW)).success).toBe(true);
  });

  it("infers categories from activity names", () => {
    expect(inferExerciseCategory({ activity: "Yoga" })).toBe("flexibility");
    expect(inferExerciseCategory({ activity: "Walking" })).toBe("aerobic");
    expect(inferExerciseCategory({ activity: "Walking", category: "everyday" })).toBe("everyday");
  });
});
