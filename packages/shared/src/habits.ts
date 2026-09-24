import { EXERCISE_SAFETY_NOTE, localDayKey, type WeeklyActivitySummary, type WellnessGoals } from "./coaching";
import { type ExerciseEvent, type HealthEvent, type MealEvent } from "./health-events";
import { type WellbeingCheckIn } from "./wellbeing";

// Recognises logged habits that support glucose management and encourages the
// person to keep them going. It celebrates behaviour, never glucose numbers,
// and its reasons come from the sourced tips in coaching.ts.

export const AFTER_MEAL_WINDOW_MINUTES = 90;

export type HabitId = "after-meal-movement" | "active-days" | "strength" | "sleep";

export type HabitProgress = {
  id: HabitId;
  title: string;
  done: number;
  target: number;
  unit: string;
  achieved: boolean;
  whyItHelps: string;
  keepGoing: string;
  startHere: string;
  sourceLabel: string;
};

export type HabitReview = {
  habits: HabitProgress[];
  wins: HabitProgress[];
  focus?: HabitProgress;
  headline: string;
  message: string;
  safetyNote: string;
};

export const HABIT_SAFETY_NOTE =
  `These habits support your care plan; they do not replace your medicines or your care team's advice. ${EXERCISE_SAFETY_NOTE}`;

const UNRELIABLE = new Set(["suspect", "conflicting", "missing"]);

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

export function isAfterMealMovement(exercise: Pick<ExerciseEvent, "occurredAt">, meals: Pick<MealEvent, "occurredAt">[]): boolean {
  const at = Date.parse(exercise.occurredAt);
  return meals.some((meal) => {
    const mealAt = Date.parse(meal.occurredAt);
    return at >= mealAt && at - mealAt <= AFTER_MEAL_WINDOW_MINUTES * 60000;
  });
}

export function reviewGlucoseFriendlyHabits(
  events: HealthEvent[],
  checkIns: WellbeingCheckIn[],
  goals: WellnessGoals,
  weekly: WeeklyActivitySummary,
  now = new Date(),
  timeZone = "Pacific/Auckland"
): HabitReview {
  const windowEnd = now.getTime() + 5 * 60000;
  const windowStart = now.getTime() - 7 * 86400000;
  const inWindow = (iso: string) => {
    const at = Date.parse(iso);
    return Number.isFinite(at) && at >= windowStart && at <= windowEnd;
  };
  const meals = events.filter((event): event is MealEvent => event.type === "meal" && !UNRELIABLE.has(event.quality));
  const exercise = events.filter((event): event is ExerciseEvent => event.type === "exercise" && !UNRELIABLE.has(event.quality) && inWindow(event.occurredAt));

  const afterMealDays = new Set(exercise.filter((session) => isAfterMealMovement(session, meals)).map((session) => localDayKey(session.occurredAt, timeZone)));
  const restedNights = new Set(
    checkIns
      .filter((checkIn) => inWindow(checkIn.occurredAt) && checkIn.sleepHours !== undefined && checkIn.sleepHours >= 7 && checkIn.sleepHours <= 9)
      .map((checkIn) => localDayKey(checkIn.occurredAt, timeZone))
  );
  const sleepTracked = checkIns.some((checkIn) => inWindow(checkIn.occurredAt) && checkIn.sleepHours !== undefined);

  const habits: HabitProgress[] = [];
  const add = (habit: Omit<HabitProgress, "achieved">) => habits.push({ ...habit, achieved: habit.done >= habit.target });

  add({
    id: "after-meal-movement",
    title: "Moving after meals",
    done: afterMealDays.size,
    target: 5,
    unit: "days",
    whyItHelps: "A short walk or some movement after eating helps your body use the glucose from that meal.",
    keepGoing: `You moved after a meal on ${afterMealDays.size} ${plural(afterMealDays.size, "day", "days")} this week. That is one of the simplest habits for after-meal glucose, so keep it going.`,
    startHere: `After your next meal, try a 10-minute walk within ${AFTER_MEAL_WINDOW_MINUTES} minutes and log it here.`,
    sourceLabel: "NZSSD / ADA / Healthify"
  });
  add({
    id: "active-days",
    title: "Active on most days",
    done: weekly.activeDays,
    target: 5,
    unit: "days",
    whyItHelps: "Activity helps your body use glucose, and the effect fades after a day or two, so spreading it across the week matters more than intensity.",
    keepGoing: `You were active on ${weekly.activeDays} ${plural(weekly.activeDays, "day", "days")} this week. Keeping no more than two days between sessions keeps the benefit going.`,
    startHere: "Aim not to let more than two days pass without some activity. A short walk today counts.",
    sourceLabel: "Health NZ / NZSSD / ADA"
  });
  const strengthLeft = Math.max(0, goals.resistanceDaysPerWeek - weekly.resistanceDays);
  if (goals.resistanceDaysPerWeek > 0) {
    add({
      id: "strength",
      title: "Strength days",
      done: weekly.resistanceDays,
      target: goals.resistanceDaysPerWeek,
      unit: "days",
      whyItHelps: "Muscle-strengthening helps your body use glucose, and stronger muscles keep helping between sessions.",
      keepGoing: `${weekly.resistanceDays} strength ${plural(weekly.resistanceDays, "day", "days")} logged this week. Keep building on it.`,
      startHere: `Add ${strengthLeft} strength ${plural(strengthLeft, "day", "days")} this week: sit-to-stands, wall push-ups, or resistance bands all count.`,
      sourceLabel: "Health NZ / WHO"
    });
  }
  if (sleepTracked) {
    add({
      id: "sleep",
      title: "7 to 9 hours of sleep",
      done: restedNights.size,
      target: 5,
      unit: "nights",
      whyItHelps: "Short or broken sleep can raise glucose and appetite the next day.",
      keepGoing: `You logged 7 to 9 hours of sleep on ${restedNights.size} ${plural(restedNights.size, "night", "nights")} this week. Good sleep makes the next day's glucose easier to manage.`,
      startHere: "A regular wind-down time and a cool, dark room help protect 7 to 9 hours of sleep.",
      sourceLabel: "Health NZ"
    });
  }

  const ratio = (habit: HabitProgress) => habit.done / habit.target;
  const wins = habits.filter((habit) => habit.done > 0).sort((a, b) => ratio(b) - ratio(a));
  const focus = habits.filter((habit) => !habit.achieved).sort((a, b) => ratio(a) - ratio(b))[0];
  const achievedCount = habits.filter((habit) => habit.achieved).length;

  const headline = wins.length === 0
    ? "Small steps count"
    : achievedCount === habits.length
      ? "Every habit on track this week"
      : `${wins.length} glucose-friendly ${plural(wins.length, "habit", "habits")} going this week`;
  const message = wins.length === 0
    ? "Nothing logged toward these habits in the last 7 days yet. Pick one below and start today; every walk and every good night's sleep is worth recording."
    : wins[0].keepGoing;

  return { habits, wins, focus, headline, message, safetyNote: HABIT_SAFETY_NOTE };
}

export function describeActivityRecognition(activity: Pick<ExerciseEvent, "occurredAt">, events: HealthEvent[]): string | undefined {
  const meals = events.filter((event): event is MealEvent => event.type === "meal" && !UNRELIABLE.has(event.quality));
  return isAfterMealMovement(activity, meals)
    ? "Moving after a meal is one of the best habits for after-meal glucose. Well done, keep it going."
    : undefined;
}
