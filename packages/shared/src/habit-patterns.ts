import { AFTER_MEAL_WINDOW_MINUTES } from "./habits";
import { type ExerciseEvent, type GlucoseCompartment, type GlucoseEvent, type HealthEvent, type MealEvent } from "./health-events";

// Compares the person's own after-meal glucose with and without movement after
// the meal. It reports a pattern in their records, never a cause, a target, or
// a reason to change treatment, and stays silent until there is enough data.

export const PATTERN_WINDOW_DAYS = 28;
export const PATTERN_MIN_MEALS_PER_GROUP = 5;
export const PATTERN_READING_MIN_MINUTES = 60;
export const PATTERN_READING_MAX_MINUTES = 150;
const PATTERN_READING_IDEAL_MINUTES = 120;
export const PATTERN_MEANINGFUL_DIFFERENCE_MMOL_L = 0.5;

const USABLE_READING = new Set(["valid", "delayed"]);
const UNRELIABLE = new Set(["suspect", "conflicting", "missing"]);

export type AfterMealPattern =
  | {
    status: "not-enough-data";
    movedMeals: number;
    otherMeals: number;
    minimumPerGroup: number;
    message: string;
  }
  | {
    status: "pattern";
    direction: "lower" | "similar" | "higher";
    differenceMmolL: number;
    movedMedianMmolL: number;
    otherMedianMmolL: number;
    movedMeals: number;
    otherMeals: number;
    compartment: GlucoseCompartment;
    message: string;
    caveat: string;
  };

type Pair = { reading: GlucoseEvent; moved: boolean };

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pairMeals(meals: MealEvent[], readings: GlucoseEvent[], exercise: ExerciseEvent[], compartment: GlucoseCompartment): Pair[] {
  const pairs: Pair[] = [];
  const candidates = readings.filter((reading) => reading.compartment === compartment);
  for (const meal of meals) {
    const mealAt = Date.parse(meal.occurredAt);
    const reading = candidates
      .filter((candidate) => {
        const minutes = (Date.parse(candidate.occurredAt) - mealAt) / 60000;
        return minutes >= PATTERN_READING_MIN_MINUTES && minutes <= PATTERN_READING_MAX_MINUTES;
      })
      .sort((a, b) => Math.abs(Date.parse(a.occurredAt) - mealAt - PATTERN_READING_IDEAL_MINUTES * 60000) - Math.abs(Date.parse(b.occurredAt) - mealAt - PATTERN_READING_IDEAL_MINUTES * 60000))[0];
    if (!reading) continue;
    const readingAt = Date.parse(reading.occurredAt);
    // Any other meal in the reading's window, before or after this one, would mix two meals into one number.
    const windowStart = readingAt - PATTERN_READING_MAX_MINUTES * 60000;
    if (meals.some((other) => other !== meal && Date.parse(other.occurredAt) >= windowStart && Date.parse(other.occurredAt) <= readingAt)) continue;
    const movementEnd = Math.min(readingAt, mealAt + AFTER_MEAL_WINDOW_MINUTES * 60000);
    const moved = exercise.some((session) => {
      const at = Date.parse(session.occurredAt);
      return at >= mealAt && at <= movementEnd;
    });
    pairs.push({ reading, moved });
  }
  return pairs;
}

export function compareAfterMealGlucose(events: HealthEvent[], now = new Date()): AfterMealPattern {
  const windowStart = now.getTime() - PATTERN_WINDOW_DAYS * 86400000;
  const windowEnd = now.getTime() + 5 * 60000;
  const inWindow = (iso: string) => {
    const at = Date.parse(iso);
    return Number.isFinite(at) && at >= windowStart && at <= windowEnd;
  };
  const meals = events.filter((event): event is MealEvent => event.type === "meal" && !UNRELIABLE.has(event.quality) && inWindow(event.occurredAt));
  const readings = events.filter((event): event is GlucoseEvent => event.type === "glucose" && USABLE_READING.has(event.quality) && inWindow(event.occurredAt));
  const exercise = events.filter((event): event is ExerciseEvent => event.type === "exercise" && !UNRELIABLE.has(event.quality));

  const byCompartment = (["capillary-blood", "interstitial-fluid"] as const).map((compartment) => {
    const pairs = pairMeals(meals, readings, exercise, compartment);
    const moved = pairs.filter((pair) => pair.moved);
    const other = pairs.filter((pair) => !pair.moved);
    return { compartment, moved, other, qualifies: moved.length >= PATTERN_MIN_MEALS_PER_GROUP && other.length >= PATTERN_MIN_MEALS_PER_GROUP };
  });
  const best = byCompartment
    .filter((group) => group.qualifies)
    .sort((a, b) => b.moved.length + b.other.length - (a.moved.length + a.other.length))[0];

  if (!best) {
    const closest = [...byCompartment].sort((a, b) =>
      Math.min(b.moved.length, PATTERN_MIN_MEALS_PER_GROUP) + Math.min(b.other.length, PATTERN_MIN_MEALS_PER_GROUP)
      - (Math.min(a.moved.length, PATTERN_MIN_MEALS_PER_GROUP) + Math.min(a.other.length, PATTERN_MIN_MEALS_PER_GROUP)))[0];
    return {
      status: "not-enough-data",
      movedMeals: closest.moved.length,
      otherMeals: closest.other.length,
      minimumPerGroup: PATTERN_MIN_MEALS_PER_GROUP,
      message: `Keep logging meals, any movement afterwards, and a glucose check about 2 hours after eating. Once there are ${PATTERN_MIN_MEALS_PER_GROUP} meals with movement and ${PATTERN_MIN_MEALS_PER_GROUP} without from the last 4 weeks, the app can show you a pattern from your own records. So far: ${closest.moved.length} with movement, ${closest.other.length} without.`
    };
  }

  const movedMedian = median(best.moved.map((pair) => pair.reading.valueMmolL));
  const otherMedian = median(best.other.map((pair) => pair.reading.valueMmolL));
  const difference = otherMedian - movedMedian;
  const rounded = Math.round(Math.abs(difference) * 10) / 10;
  const direction = difference >= PATTERN_MEANINGFUL_DIFFERENCE_MMOL_L ? "lower" : difference <= -PATTERN_MEANINGFUL_DIFFERENCE_MMOL_L ? "higher" : "similar";
  const counts = `${best.moved.length} meals with movement and ${best.other.length} without`;
  const message = direction === "lower"
    ? `In your records from the last 4 weeks, glucose about 2 hours after eating was typically ${rounded.toFixed(1)} mmol/L lower after meals you followed with movement (${counts}). Keep those after-meal walks going.`
    : direction === "similar"
      ? `In your records from the last 4 weeks, glucose about 2 hours after eating was about the same after meals with and without movement (${counts}). Regular movement still helps your body use glucose over time, so keep it going.`
      : `In your records from the last 4 weeks, glucose about 2 hours after eating was not lower after meals with movement (${counts}). Meal size, timing, and other factors can explain this. Keep moving, and this is worth talking through with your care team.`;
  const caveat = [
    "This compares your own logged readings; it is a pattern, not proof. Meal size and type, timing, medicines, stress, illness, and how the reading was taken also affect after-meal glucose.",
    best.compartment === "interstitial-fluid" ? "These are sensor readings, which can lag behind blood glucose." : "",
    "Share it with your care team; it is not a reason to change your medicines."
  ].filter(Boolean).join(" ");

  return {
    status: "pattern",
    direction,
    differenceMmolL: Math.round(difference * 10) / 10,
    movedMedianMmolL: Math.round(movedMedian * 10) / 10,
    otherMedianMmolL: Math.round(otherMedian * 10) / 10,
    movedMeals: best.moved.length,
    otherMeals: best.other.length,
    compartment: best.compartment,
    message,
    caveat
  };
}
