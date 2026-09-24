import { describe, expect, it } from "vitest";
import { compareAfterMealGlucose } from "./habit-patterns";
import { type ExerciseEvent, type GlucoseCompartment, type GlucoseEvent, type HealthEvent, type MealEvent } from "./health-events";

const NOW = new Date("2026-09-18T04:00:00.000Z");
const TZ = "Pacific/Auckland";

function at(daysAgo: number, minutesAfterMeal = 0) {
  return new Date(NOW.getTime() - daysAgo * 86400000 - 6 * 3600000 + minutesAfterMeal * 60000).toISOString();
}

const base = { userId: "u", source: "manual" as const, timezone: TZ, confidence: 1, quality: "valid" as const };

function meal(day: number): MealEvent {
  return { ...base, id: `meal-${day}`, type: "meal", occurredAt: at(day), receivedAt: at(day), description: "Dinner" };
}

function reading(day: number, minutes: number, valueMmolL: number, overrides: Partial<GlucoseEvent> = {}): GlucoseEvent {
  return { ...base, id: `g-${day}-${minutes}`, type: "glucose", occurredAt: at(day, minutes), receivedAt: at(day, minutes), valueMmolL, compartment: "capillary-blood", ...overrides };
}

function walk(day: number, minutes: number): ExerciseEvent {
  return { ...base, id: `ex-${day}-${minutes}`, type: "exercise", occurredAt: at(day, minutes), receivedAt: at(day, minutes), activity: "walk", durationMinutes: 15, intensity: "moderate", detectedFromImu: false };
}

// Days 0.. hold meals followed by movement; days 10.. hold meals without movement.
function history(moved: number[], still: number[], compartment: GlucoseCompartment = "capillary-blood"): HealthEvent[] {
  const events: HealthEvent[] = [];
  moved.forEach((value, index) => events.push(meal(index), walk(index, 20), reading(index, 120, value, { compartment })));
  still.forEach((value, index) => events.push(meal(10 + index), reading(10 + index, 120, value, { compartment })));
  return events;
}

describe("after-meal glucose pattern", () => {
  it("stays silent and encourages logging until each group has five meals", () => {
    const result = compareAfterMealGlucose(history([7, 7, 7, 7], [9, 9, 9, 9, 9, 9]), NOW);
    expect(result.status).toBe("not-enough-data");
    expect(result.message).toContain("So far: 4 with movement, 6 without");
  });

  it("shows how much lower after-meal glucose was after meals with movement, using medians", () => {
    const result = compareAfterMealGlucose(history([7, 7.5, 8, 8.2, 7.8], [9.5, 10, 9.8, 10.2, 18]), NOW);
    expect(result.status).toBe("pattern");
    if (result.status !== "pattern") return;
    expect(result.direction).toBe("lower");
    expect(result.differenceMmolL).toBe(2.2);
    expect(result.message).toContain("2.2 mmol/L lower");
    expect(result.message).toContain("5 meals with movement and 5 without");
    expect(result.caveat).toContain("a pattern, not proof");
    expect(result.caveat).toContain("not a reason to change your medicines");
    expect(result.caveat).not.toContain("sensor readings");
  });

  it("never discourages movement when the numbers are similar or higher", () => {
    const similar = compareAfterMealGlucose(history([8, 8, 8, 8, 8], [8.2, 8.2, 8.2, 8.2, 8.2]), NOW);
    expect(similar.status === "pattern" && similar.direction).toBe("similar");
    expect(similar.message).toContain("keep it going");

    const higher = compareAfterMealGlucose(history([10, 10, 10, 10, 10], [8, 8, 8, 8, 8]), NOW);
    expect(higher.status === "pattern" && higher.direction).toBe("higher");
    expect(higher.message).toContain("Keep moving");
    expect(higher.message).toContain("care team");
  });

  it("uses the reading closest to 2 hours after the meal and ignores readings outside 60 to 150 minutes", () => {
    const events = history([7, 7, 7, 7, 7], [9, 9, 9, 9, 9]);
    events.push(reading(0, 65, 15), reading(1, 50, 20), reading(2, 160, 20));
    const result = compareAfterMealGlucose(events, NOW);
    expect(result.status === "pattern" && result.movedMedianMmolL).toBe(7);
  });

  it("does not count movement after the reading, and skips readings that follow two meals", () => {
    const events = history([7, 7, 7, 7, 7], [9, 9, 9, 9, 9]);
    events.push(meal(20), reading(20, 80, 12), walk(20, 85));
    events.push(meal(21), { ...meal(21), id: "snack-21", occurredAt: at(21, 40) }, reading(21, 120, 30));
    const result = compareAfterMealGlucose(events, NOW);
    expect(result.status === "pattern" && [result.movedMeals, result.otherMeals]).toEqual([5, 6]);
    expect(result.status === "pattern" && result.otherMedianMmolL).toBe(9);
  });

  it("excludes suspect readings, data older than 4 weeks, and never mixes compartments", () => {
    const suspect = history([7, 7, 7, 7, 7], [9, 9, 9, 9, 9]).map((event) => event.type === "glucose" && event.valueMmolL === 9 ? { ...event, quality: "suspect" as const } : event);
    expect(compareAfterMealGlucose(suspect, NOW).status).toBe("not-enough-data");

    const later = new Date(NOW.getTime() + 20 * 86400000);
    expect(compareAfterMealGlucose(history([7, 7, 7, 7, 7], [9, 9, 9, 9, 9]), later).status).toBe("not-enough-data");

    const mixed = [...history([7, 7, 7, 7, 7], []), ...history([], [9, 9, 9, 9, 9], "interstitial-fluid")];
    expect(compareAfterMealGlucose(mixed, NOW).status).toBe("not-enough-data");
  });

  it("notes sensor lag when the pattern comes from interstitial readings", () => {
    const result = compareAfterMealGlucose(history([7, 7, 7, 7, 7], [9, 9, 9, 9, 9], "interstitial-fluid"), NOW);
    expect(result.status === "pattern" && result.caveat).toContain("sensor readings, which can lag");
  });

  it("stays within the wellness boundary", () => {
    for (const result of [compareAfterMealGlucose([], NOW), compareAfterMealGlucose(history([7, 7, 7, 7, 7], [9, 9, 9, 9, 9]), NOW)]) {
      const copy = `${result.message} ${result.status === "pattern" ? result.caveat : ""}`.toLowerCase();
      for (const word of ["dose", "stop taking", "reduce your medication", "diagnos", "target"]) expect(copy).not.toContain(word);
    }
  });
});
