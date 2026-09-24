import { describe, expect, it } from "vitest";
import { createDefaultWellnessGoals, summarizeWeeklyActivity } from "./coaching";
import { describeActivityRecognition, isAfterMealMovement, reviewGlucoseFriendlyHabits } from "./habits";
import { type ExerciseEvent, type HealthEvent, type MealEvent } from "./health-events";
import { type WellbeingCheckIn } from "./wellbeing";

const NOW = new Date("2026-09-18T04:00:00.000Z"); // Fri 16:00 NZST
const TZ = "Pacific/Auckland";
const goals = createDefaultWellnessGoals(NOW);

function at(daysAgo: number, minutesLater = 0) {
  return new Date(NOW.getTime() - daysAgo * 86400000 + minutesLater * 60000).toISOString();
}

function meal(occurredAt: string, overrides: Partial<MealEvent> = {}): MealEvent {
  return { id: `meal-${occurredAt}`, userId: "u", type: "meal", source: "manual", occurredAt, receivedAt: occurredAt, timezone: TZ, confidence: 1, quality: "valid", description: "Lunch", ...overrides };
}

function walk(occurredAt: string, overrides: Partial<ExerciseEvent> = {}): ExerciseEvent {
  return { id: `ex-${occurredAt}`, userId: "u", type: "exercise", source: "manual", occurredAt, receivedAt: occurredAt, timezone: TZ, confidence: 1, quality: "valid", activity: "walk", durationMinutes: 15, intensity: "moderate", detectedFromImu: false, ...overrides };
}

function sleep(occurredAt: string, sleepHours: number): WellbeingCheckIn {
  return { id: `ci-${occurredAt}`, userId: "u", occurredAt, timezone: TZ, sleepHours };
}

function review(events: HealthEvent[], checkIns: WellbeingCheckIn[] = []) {
  return reviewGlucoseFriendlyHabits(events, checkIns, goals, summarizeWeeklyActivity(events, goals, NOW, TZ), NOW, TZ);
}

const habit = (result: ReturnType<typeof review>, id: string) => result.habits.find((item) => item.id === id);

describe("after-meal movement", () => {
  it("counts movement within 90 minutes after a meal, not before it or long after", () => {
    const meals = [meal(at(1))];
    expect(isAfterMealMovement(walk(at(1, 30)), meals)).toBe(true);
    expect(isAfterMealMovement(walk(at(1, 90)), meals)).toBe(true);
    expect(isAfterMealMovement(walk(at(1, 91)), meals)).toBe(false);
    expect(isAfterMealMovement(walk(at(1, -10)), meals)).toBe(false);
  });

  it("counts days, not sessions, and ignores unreliable entries", () => {
    const events: HealthEvent[] = [
      meal(at(1)), walk(at(1, 20)), walk(at(1, 40)),
      meal(at(2)), walk(at(2, 30), { quality: "suspect" }),
      meal(at(3), { quality: "conflicting" }), walk(at(3, 30))
    ];
    expect(habit(review(events), "after-meal-movement")?.done).toBe(1);
  });

  it("recognises a walk logged soon after a meal", () => {
    const events = [meal(at(0, -40))];
    expect(describeActivityRecognition(walk(at(0)), events)).toContain("keep it going");
    expect(describeActivityRecognition(walk(at(0)), [])).toBeUndefined();
  });
});

describe("glucose-friendly habit review", () => {
  it("encourages a first step, without shaming, when nothing is logged", () => {
    const result = review([]);
    expect(result.headline).toBe("Small steps count");
    expect(result.wins).toEqual([]);
    expect(result.focus?.id).toBe("after-meal-movement");
    expect(result.habits.map((item) => item.id)).toEqual(["after-meal-movement", "active-days", "strength"]);
  });

  it("leads with the strongest habit so the person hears what to keep doing", () => {
    const events = [meal(at(1)), walk(at(1, 20)), meal(at(2)), walk(at(2, 20)), meal(at(3)), walk(at(3, 20)), walk(at(4), { activity: "resistance bands" })];
    const result = review(events);
    expect(result.headline).toBe("3 glucose-friendly habits going this week");
    expect(result.message).toContain("You were active on 4 days");
    expect(result.wins.map((item) => item.id)).toEqual(["active-days", "after-meal-movement", "strength"]);
    expect(result.focus?.id).toBe("strength");
  });

  it("only shows the sleep habit once sleep is being logged, and counts 7 to 9 hour nights", () => {
    expect(habit(review([]), "sleep")).toBeUndefined();
    const nights = [sleep(at(1), 7.5), sleep(at(2), 6), sleep(at(3), 10), sleep(at(4), 8)];
    expect(habit(review([], nights), "sleep")?.done).toBe(2);
  });

  it("celebrates when every habit is on track", () => {
    const events: HealthEvent[] = [];
    for (let day = 0; day < 5; day += 1) events.push(meal(at(day, -60)), walk(at(day, -30)));
    events.push(walk(at(1, -300), { activity: "gym weights" }), walk(at(2, -300), { activity: "squats" }));
    const nights = [0, 1, 2, 3, 4].map((day) => sleep(at(day, -600), 8));
    const result = review(events, nights);
    expect(result.habits.every((item) => item.achieved)).toBe(true);
    expect(result.headline).toBe("Every habit on track this week");
    expect(result.focus).toBeUndefined();
  });

  it("drops the strength habit when the goal is zero days", () => {
    const zero = { ...goals, resistanceDaysPerWeek: 0 };
    const result = reviewGlucoseFriendlyHabits([], [], zero, summarizeWeeklyActivity([], zero, NOW, TZ), NOW, TZ);
    expect(result.habits.map((item) => item.id)).not.toContain("strength");
  });

  it("stays within the wellness boundary", () => {
    const result = review([meal(at(1)), walk(at(1, 20))], [sleep(at(1), 8)]);
    expect(result.safetyNote).toContain("do not replace your medicines");
    const copy = [result.headline, result.message, ...result.habits.flatMap((item) => [item.whyItHelps, item.keepGoing, item.startHere])].join(" ").toLowerCase();
    for (const word of ["dose", "insulin units", "stop taking", "reduce your medication", "diagnos"]) expect(copy).not.toContain(word);
  });
});
