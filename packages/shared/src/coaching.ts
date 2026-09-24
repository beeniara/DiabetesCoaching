import { z } from "zod";
import { type ExerciseCategory, type ExerciseEvent, type HealthEvent } from "./health-events";

// Deterministic lifestyle coaching. Every rule here is general wellness
// guidance drawn from published diabetes self-care recommendations. Nothing in
// this module diagnoses, doses, or changes treatment, and every message must
// keep that boundary visible.

export const ACTIVITY_GUIDELINES = {
  weeklyModerateMinutes: 150,
  weeklyVigorousMinutes: 75,
  resistanceDaysPerWeek: 2,
  maxDaysBetweenActivity: 2,
  breakSittingEveryMinutes: 30,
  sleepHoursMin: 7,
  sleepHoursMax: 9
} as const;

export const GUIDELINE_SOURCES = [
  { label: "Health New Zealand — Physical activity for adults", url: "https://www.healthnz.govt.nz/health-topics/keeping-healthy/being-physically-active/physical-activity" },
  { label: "NZSSD Type 2 Diabetes Management Guidance — Physical activity", url: "https://t2dm.nzssd.org.nz/Section-89-Physical-activity" },
  { label: "NZSSD Type 2 Diabetes Management Guidance — Annual diabetes review", url: "https://t2dm.nzssd.org.nz/Section-115-Annual-diabetes-review" },
  { label: "Healthify NZ — Type 2 diabetes: food and exercise", url: "https://healthify.nz/health-a-z/d/diabetes-type-2-food-and-exercise" },
  { label: "Healthify NZ — Type 2 diabetes sick-day plan", url: "https://healthify.nz/health-a-z/d/diabetes-type-2-sick-day-plan" },
  { label: "Healthify NZ — Diabetes foot care", url: "https://healthify.nz/health-a-z/d/diabetes-foot-care" },
  { label: "Healthify NZ — Diabetes and alcohol", url: "https://healthify.nz/health-a-z/d/diabetes-and-alcohol" },
  { label: "Diabetes New Zealand — Diabetes check-ups", url: "https://www.diabetes.org.nz/diabetes-check-ups" },
  { label: "American Diabetes Association — Standards of Care in Diabetes 2026, Section 5", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12690188" },
  { label: "WHO Guidelines on Physical Activity and Sedentary Behaviour", url: "https://www.ncbi.nlm.nih.gov/books/NBK566046/" }
] as const;

export const WellnessGoalsSchema = z.object({
  weeklyActiveMinutes: z.number().int().min(10).max(2000),
  resistanceDaysPerWeek: z.number().int().min(0).max(7),
  dailyCheckIn: z.boolean(),
  updatedAt: z.string().datetime({ offset: true })
});
export type WellnessGoals = z.infer<typeof WellnessGoalsSchema>;

export function createDefaultWellnessGoals(now = new Date()): WellnessGoals {
  return {
    weeklyActiveMinutes: ACTIVITY_GUIDELINES.weeklyModerateMinutes,
    resistanceDaysPerWeek: ACTIVITY_GUIDELINES.resistanceDaysPerWeek,
    dailyCheckIn: true,
    updatedAt: now.toISOString()
  };
}

const RESISTANCE_KEYWORDS = ["strength", "weights", "resistance", "gym", "band", "squat", "push-up", "pushup", "lifting", "pilates"];
const FLEXIBILITY_KEYWORDS = ["yoga", "stretch", "tai chi", "balance"];

export function inferExerciseCategory(event: Pick<ExerciseEvent, "activity" | "category">): ExerciseCategory {
  if (event.category) return event.category;
  const name = event.activity.toLowerCase();
  if (RESISTANCE_KEYWORDS.some((keyword) => name.includes(keyword))) return "resistance";
  if (FLEXIBILITY_KEYWORDS.some((keyword) => name.includes(keyword))) return "flexibility";
  return "aerobic";
}

export function localDayKey(isoTimestamp: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoTimestamp));
  } catch {
    return isoTimestamp.slice(0, 10);
  }
}

// Steps back one calendar date, so 23- and 25-hour daylight-saving days are never skipped or repeated.
function previousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export type WeeklyActivitySummary = {
  windowStart: string;
  windowEnd: string;
  sessions: number;
  activeDays: number;
  totalMinutes: number;
  /** Moderate minutes plus vigorous minutes counted double, per guideline equivalence. */
  equivalentModerateMinutes: number;
  vigorousMinutes: number;
  lightMinutes: number;
  resistanceDays: number;
  flexibilityOrBalanceSessions: number;
  progressPercent: number;
  goalMet: boolean;
  resistanceGoalMet: boolean;
  currentStreakDays: number;
  daysSinceLastActivity?: number;
  excludedSuspectSessions: number;
};

export function summarizeWeeklyActivity(
  events: HealthEvent[],
  goals: WellnessGoals,
  now = new Date(),
  timeZone = "Pacific/Auckland"
): WeeklyActivitySummary {
  const windowEnd = now.getTime();
  const windowStart = windowEnd - 7 * 86400000;
  let excludedSuspectSessions = 0;
  const sessions = events.filter((event): event is ExerciseEvent => {
    if (event.type !== "exercise") return false;
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at) || at < windowStart || at > windowEnd + 5 * 60000) return false;
    if (event.quality === "suspect" || event.quality === "conflicting" || event.quality === "missing") {
      excludedSuspectSessions += 1;
      return false;
    }
    return true;
  });

  let totalMinutes = 0;
  let equivalentModerateMinutes = 0;
  let vigorousMinutes = 0;
  let lightMinutes = 0;
  let flexibilityOrBalanceSessions = 0;
  const activeDayKeys = new Set<string>();
  const resistanceDayKeys = new Set<string>();

  for (const session of sessions) {
    const dayKey = localDayKey(session.occurredAt, timeZone);
    activeDayKeys.add(dayKey);
    totalMinutes += session.durationMinutes;
    const category = inferExerciseCategory(session);
    if (category === "resistance") resistanceDayKeys.add(dayKey);
    if (category === "flexibility" || category === "balance") flexibilityOrBalanceSessions += 1;
    if (session.intensity === "vigorous") {
      vigorousMinutes += session.durationMinutes;
      equivalentModerateMinutes += session.durationMinutes * 2;
    } else if (session.intensity === "moderate") {
      equivalentModerateMinutes += session.durationMinutes;
    } else {
      lightMinutes += session.durationMinutes;
    }
  }

  // Streak counts consecutive local days ending today or yesterday with any
  // logged exercise, using the full event list rather than just this week.
  const allExerciseDays = new Set(
    events
      .filter((event): event is ExerciseEvent => event.type === "exercise" && Date.parse(event.occurredAt) <= windowEnd + 5 * 60000)
      .map((event) => localDayKey(event.occurredAt, timeZone))
  );
  let currentStreakDays = 0;
  let dayKey = localDayKey(new Date(windowEnd).toISOString(), timeZone);
  if (!allExerciseDays.has(dayKey)) dayKey = previousDayKey(dayKey);
  while (allExerciseDays.has(dayKey) && currentStreakDays < 365) {
    currentStreakDays += 1;
    dayKey = previousDayKey(dayKey);
  }

  const latestExercise = events
    .filter((event): event is ExerciseEvent => event.type === "exercise")
    .map((event) => Date.parse(event.occurredAt))
    .filter((at) => Number.isFinite(at) && at <= windowEnd + 5 * 60000)
    .sort((a, b) => b - a)[0];
  const daysSinceLastActivity = latestExercise === undefined ? undefined : Math.floor((windowEnd - latestExercise) / 86400000);

  const progressPercent = goals.weeklyActiveMinutes > 0
    ? Math.min(999, Math.round((equivalentModerateMinutes / goals.weeklyActiveMinutes) * 100))
    : 0;

  return {
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
    sessions: sessions.length,
    activeDays: activeDayKeys.size,
    totalMinutes: Math.round(totalMinutes),
    equivalentModerateMinutes: Math.round(equivalentModerateMinutes),
    vigorousMinutes: Math.round(vigorousMinutes),
    lightMinutes: Math.round(lightMinutes),
    resistanceDays: resistanceDayKeys.size,
    flexibilityOrBalanceSessions,
    progressPercent,
    goalMet: equivalentModerateMinutes >= goals.weeklyActiveMinutes,
    resistanceGoalMet: resistanceDayKeys.size >= goals.resistanceDaysPerWeek,
    currentStreakDays,
    daysSinceLastActivity,
    excludedSuspectSessions
  };
}

export type Encouragement = {
  headline: string;
  message: string;
  nextStep: string;
  safetyNote: string;
};

export const EXERCISE_SAFETY_NOTE =
  "Check with your diabetes care team before starting new or more intense activity, especially if you use insulin or a sulphonylurea, which can cause low glucose. Carry a source of sugar, wear supportive shoes, and stop and seek advice if you feel unwell.";

export function buildEncouragement(summary: WeeklyActivitySummary, goals: WellnessGoals): Encouragement {
  const remaining = Math.max(0, goals.weeklyActiveMinutes - summary.equivalentModerateMinutes);
  const resistanceRemaining = Math.max(0, goals.resistanceDaysPerWeek - summary.resistanceDays);
  const resistanceStep = resistanceRemaining > 0
    ? `Add ${resistanceRemaining} more muscle-strengthening ${resistanceRemaining === 1 ? "day" : "days"} this week: sit-to-stands, wall push-ups, or resistance bands all count.`
    : "Muscle-strengthening goal met for the week. Keep two or more days going.";

  if (summary.sessions === 0) {
    const lapsed = summary.daysSinceLastActivity !== undefined && summary.daysSinceLastActivity > ACTIVITY_GUIDELINES.maxDaysBetweenActivity;
    return {
      headline: lapsed ? "Ready when you are" : "Let's get moving",
      message: lapsed
        ? `It has been ${summary.daysSinceLastActivity} days since your last logged activity. Any movement counts, and a fresh start today is a win.`
        : "No activity logged in the last 7 days yet. Every 10-minute walk after a meal is progress worth recording.",
      nextStep: "Try a 10-minute walk after your next meal and log it here.",
      safetyNote: EXERCISE_SAFETY_NOTE
    };
  }

  if (summary.goalMet) {
    return {
      headline: summary.currentStreakDays >= 3 ? `${summary.currentStreakDays}-day streak. Brilliant.` : "Weekly goal reached",
      message: `You have logged ${summary.equivalentModerateMinutes} active minutes across ${summary.activeDays} ${summary.activeDays === 1 ? "day" : "days"} this week, meeting your ${goals.weeklyActiveMinutes}-minute goal.`,
      nextStep: resistanceStep,
      safetyNote: EXERCISE_SAFETY_NOTE
    };
  }

  if (summary.progressPercent >= 50) {
    return {
      headline: "More than halfway there",
      message: `${summary.equivalentModerateMinutes} of ${goals.weeklyActiveMinutes} active minutes logged. ${remaining} minutes to go, and you have ${summary.activeDays} active ${summary.activeDays === 1 ? "day" : "days"} already.`,
      nextStep: remaining <= 30
        ? `One ${remaining}-minute walk will get you there.`
        : `Spread the remaining ${remaining} minutes over the next few days: three ${Math.ceil(remaining / 3)}-minute walks would do it.`,
      safetyNote: EXERCISE_SAFETY_NOTE
    };
  }

  return {
    headline: "Good start",
    message: `${summary.equivalentModerateMinutes} active minutes logged so far this week. Building up gradually is exactly right.`,
    nextStep: summary.daysSinceLastActivity !== undefined && summary.daysSinceLastActivity >= ACTIVITY_GUIDELINES.maxDaysBetweenActivity
      ? "Aim not to let more than two days pass without some activity. A short walk today keeps the habit alive."
      : `Try adding 10 minutes to your next session, or one extra active day, to move toward ${goals.weeklyActiveMinutes} minutes.`,
    safetyNote: EXERCISE_SAFETY_NOTE
  };
}

export type TipCategory = "activity" | "nutrition" | "sleep" | "stress" | "footcare" | "checks" | "hydration" | "habits";

export type WellnessTip = {
  id: string;
  category: TipCategory;
  title: string;
  body: string;
  sourceLabel: string;
};

export const WELLNESS_TIPS: readonly WellnessTip[] = [
  { id: "activity-150", category: "activity", title: "Aim for 2\u00bd hours a week", body: "Health NZ recommends at least 2\u00bd hours of moderate activity a week, spread across the week. Moderate means breathing harder but still able to hold a conversation. About 30 minutes on five days gets you there.", sourceLabel: "Health NZ / Healthify" },
  { id: "activity-sitting", category: "activity", title: "Break up sitting", body: "Try not to sit for longer than 30 minutes at a time. Standing up or taking a short walk every half hour helps glucose after meals.", sourceLabel: "NZSSD / ADA" },
  { id: "activity-strength", category: "activity", title: "Strength counts too", body: "Muscle-strengthening on at least two days a week helps your body use glucose. Sit-to-stands, stairs, resistance bands, or carrying groceries all count.", sourceLabel: "Health NZ / WHO" },
  { id: "activity-after-meals", category: "activity", title: "Start with 15 gentle minutes", body: "If you are starting out, 15 minutes of gentle activity a day is a good first step. A short walk after a meal is an easy place to begin.", sourceLabel: "Healthify" },
  { id: "activity-gap", category: "activity", title: "No more than two days off", body: "Spread activity over at least three days with no more than two days in a row without it. Consistency matters more than intensity.", sourceLabel: "NZSSD / ADA" },
  { id: "activity-balance", category: "activity", title: "Balance and flexibility as you get older", body: "From 65, adding two to three sessions of balance and flexibility activity a week, such as tai chi or gentle stretching, helps prevent falls.", sourceLabel: "Health NZ / ADA" },
  { id: "activity-feet", category: "activity", title: "Good footwear for activity", body: "Wear well-fitting supportive shoes when you are active, especially if you have reduced feeling in your feet, and check your feet afterwards.", sourceLabel: "NZSSD" },
  { id: "activity-carry-sugar", category: "activity", title: "If you use insulin or a sulphonylurea", body: "Activity can lower glucose for hours. If you use insulin or a sulphonylurea tablet, carry glucose or another form of sugar, and talk with your care team about activity days.", sourceLabel: "Diabetes NZ / Healthify" },
  { id: "nutrition-plate", category: "nutrition", title: "Try the plate model", body: "Fill half your plate with non-starchy colourful vegetables, a quarter with protein, and a quarter with wholegrain or starchy carbohydrate.", sourceLabel: "Healthy Food Guide NZ" },
  { id: "nutrition-drinks", category: "nutrition", title: "Swap sugary drinks", body: "Sugary drinks and fruit juice raise glucose quickly. Plain water is the best everyday choice.", sourceLabel: "Health NZ / ADA" },
  { id: "nutrition-fibre", category: "nutrition", title: "Choose higher-fibre carbohydrates", body: "Wholegrain bread, oats, brown rice, legumes, and vegetables digest more slowly and help steady glucose. Aim for at least five servings of vegetables and two of fruit a day.", sourceLabel: "Health NZ" },
  { id: "nutrition-regular", category: "nutrition", title: "Do not skip meals", body: "Regular meals with starchy foods in small amounts, and sugar, fat, and salt kept to a minimum, make glucose patterns easier to understand.", sourceLabel: "Healthify" },
  { id: "nutrition-alcohol", category: "nutrition", title: "Go easy on alcohol", body: "Alcohol can lower glucose for up to 24 hours. If you drink, keep within low-risk limits, have at least two alcohol-free days a week, never drink on an empty stomach, and check glucose before bed.", sourceLabel: "Healthify" },
  { id: "nutrition-dietitian", category: "nutrition", title: "Ask for a dietitian", body: "Eating well with diabetes follows the same healthy eating guidelines as for everyone. A dietitian can tailor them to your food, culture, and budget.", sourceLabel: "Diabetes NZ" },
  { id: "sleep-hours", category: "sleep", title: "Protect your sleep", body: "Most adults need about 7 to 9 hours. Short or broken sleep can raise glucose and appetite the next day.", sourceLabel: "Health NZ" },
  { id: "sleep-routine", category: "sleep", title: "Keep a wind-down routine", body: "Regular bed and wake times, less screen light before bed, and a cool dark room all support deeper sleep.", sourceLabel: "Health NZ / ADA" },
  { id: "stress-breathe", category: "stress", title: "Five to twenty minutes of calm", body: "Stress hormones can push glucose up. Slow breathing or progressive relaxation for 5 to 20 minutes a day, a walk, or a chat with someone you trust can help.", sourceLabel: "Diabetes NZ" },
  { id: "stress-support", category: "stress", title: "You do not have to do this alone", body: "Diabetes distress is common. Your GP, diabetes nurse, or the Diabetes NZ helpline 0800 342 238 can connect you with support and peer groups.", sourceLabel: "Diabetes NZ" },
  { id: "footcare-daily", category: "footcare", title: "Check your feet daily", body: "Look for cuts, blisters, redness, colour change, or swelling each day. See your doctor immediately for a cut, colour change, new swelling, or fever.", sourceLabel: "Healthify" },
  { id: "footcare-shoes", category: "footcare", title: "Always wear shoes", body: "Wear shoes even indoors, keep socks clean and dry, and have a professional foot check at least once a year.", sourceLabel: "Healthify" },
  { id: "checks-annual", category: "checks", title: "Keep up your annual review", body: "A yearly diabetes review covers HbA1c, blood pressure, cholesterol, kidney tests, eyes, feet, and how you are coping. Ask what is due next.", sourceLabel: "NZSSD" },
  { id: "checks-hba1c", category: "checks", title: "HbA1c every 3 to 6 months", body: "HbA1c shows your average glucose over about three months. It is usually checked every 3 months when above target and every 6 months when at target.", sourceLabel: "Healthify / NZSSD" },
  { id: "checks-eyes", category: "checks", title: "Retinal screening", body: "Have a retinal (eye) check at least every two years, or as often as the screening service advises. Regular screening catches changes before they affect sight.", sourceLabel: "Diabetes NZ" },
  { id: "checks-dental", category: "checks", title: "Look after your gums", body: "Brush twice a day, floss daily, and visit your dentist at least twice a year. Gum disease and diabetes affect each other.", sourceLabel: "Diabetes NZ" },
  { id: "checks-sick-day", category: "checks", title: "Have a sick-day plan", body: "When unwell, check glucose 3 to 4 times a day, keep drinking water, and contact your doctor, nurse, or Healthline if you are vomiting, glucose stays very high or low, or you feel drowsy or confused.", sourceLabel: "Healthify" },
  { id: "hydration-water", category: "hydration", title: "Water is best", body: "Aim for around eight cups of fluid a day with water as your main drink, more in hot weather or when active.", sourceLabel: "Health NZ" },
  { id: "habits-small", category: "habits", title: "Small SMART steps", body: "Pick one specific, measurable goal you feel at least 7 out of 10 confident about, such as a 15-minute walk after dinner on weekdays. One goal at a time sticks.", sourceLabel: "Healthify" },
  { id: "habits-log", category: "habits", title: "Logging builds insight", body: "Recording glucose, meals, activity, and how you feel helps you and your care team spot what works for you. Be kind to yourself if you slip up.", sourceLabel: "Healthify / ADA" },
  { id: "habits-smoking", category: "habits", title: "Stopping smoking helps most", body: "Cutting down is not the same as stopping. Quitline 0800 778 778 or text 4006 offers free support.", sourceLabel: "Healthify / Quitline" },
  { id: "habits-green-rx", category: "habits", title: "Ask about a Green Prescription", body: "In New Zealand adults can get a free Green Prescription for activity and nutrition support through their GP or nurse, or by calling 0800 ACTIVE (0800 22 84 83).", sourceLabel: "Healthify" },
  { id: "habits-group", category: "habits", title: "Join a self-management programme", body: "Group diabetes self-management programmes improve clinical, lifestyle, and wellbeing outcomes. Ask your practice what is available locally.", sourceLabel: "Healthify" }
];

export function pickDailyTip(date = new Date(), category?: TipCategory): WellnessTip {
  const pool = category ? WELLNESS_TIPS.filter((tip) => tip.category === category) : WELLNESS_TIPS;
  const source = pool.length > 0 ? pool : WELLNESS_TIPS;
  const dayNumber = Math.floor(date.getTime() / 86400000);
  return source[((dayNumber % source.length) + source.length) % source.length];
}

export function suggestTipsForWeek(summary: WeeklyActivitySummary, options: { averageSleepHours?: number; highStressDays?: number; footChecksDone?: number; hasCheckIns?: boolean }): WellnessTip[] {
  const wanted: string[] = [];
  if (summary.sessions === 0) wanted.push("activity-after-meals");
  else if (!summary.goalMet) wanted.push("activity-150");
  if (!summary.resistanceGoalMet) wanted.push("activity-strength");
  if (summary.daysSinceLastActivity !== undefined && summary.daysSinceLastActivity >= ACTIVITY_GUIDELINES.maxDaysBetweenActivity) wanted.push("activity-gap");
  if (options.averageSleepHours !== undefined && options.averageSleepHours < ACTIVITY_GUIDELINES.sleepHoursMin) wanted.push("sleep-hours");
  if ((options.highStressDays ?? 0) >= 2) wanted.push("stress-breathe");
  if (options.hasCheckIns && (options.footChecksDone ?? 0) === 0) wanted.push("footcare-daily");
  if (wanted.length === 0) wanted.push("habits-small", "nutrition-plate");
  const byId = new Map(WELLNESS_TIPS.map((tip) => [tip.id, tip]));
  return wanted.flatMap((id) => {
    const tip = byId.get(id);
    return tip ? [tip] : [];
  }).slice(0, 4);
}

export type SeekHelpSign = { sign: string; action: string };

// Contact prompts only. These never describe treatment; they route the person
// to their care team, Healthline, or 111.
export const SEEK_HELP_SIGNS: readonly SeekHelpSign[] = [
  { sign: "Glucose below 4 mmol/L and extremely drowsy, disorientated, unconscious, or having a fit", action: "Call 111 and ask for an ambulance." },
  { sign: "High glucose with nausea or vomiting, stomach pain, rapid deep breathing, fever for more than 24 hours, signs of dehydration, or difficulty staying awake", action: "Seek urgent medical advice now: call 111 if significantly unwell, otherwise your GP or Healthline 0800 611 116." },
  { sign: "Glucose staying above 17 mmol/L and not settling", action: "Contact your GP, diabetes nurse, or Healthline 0800 611 116 today." },
  { sign: "Unwell with vomiting or diarrhoea for more than 2 hours, or feeling dizzy, drowsy, or confused", action: "Follow your sick-day plan and contact your doctor, nurse, clinic, or an emergency department." },
  { sign: "A low glucose that needed someone else's help, or lows happening often", action: "Follow the hypo plan your care team gave you, then contact them to review it." },
  { sign: "A foot cut, colour change, new swelling, or a wound that is not improving", action: "See your doctor, nurse, or podiatrist immediately. Do not wait for it to heal on its own." },
  { sign: "Sudden change in vision, chest pain, or weakness or numbness on one side", action: "Call 111 immediately." },
  { sign: "Feeling persistently low, hopeless, or overwhelmed by diabetes", action: "Talk with your GP, or call or text 1737 to speak with a trained counsellor, any time." }
];

export const REGULAR_CHECKS: readonly { check: string; typicalFrequency: string }[] = [
  { check: "HbA1c blood test", typicalFrequency: "Every 3 months if above target, every 6 months if at target (NZSSD)" },
  { check: "Blood pressure", typicalFrequency: "At each diabetes visit" },
  { check: "Cholesterol and kidney (urine and blood) tests", typicalFrequency: "At least once a year as part of the annual review" },
  { check: "Foot check by a health professional", typicalFrequency: "At least once a year; every visit if you are at higher foot risk" },
  { check: "Retinal eye screening", typicalFrequency: "At least every 2 years, or as the screening service advises" },
  { check: "Dental check-up", typicalFrequency: "At least twice a year" },
  { check: "Mood and diabetes-distress check", typicalFrequency: "At least once a year as part of the annual review" },
  { check: "Flu vaccination", typicalFrequency: "Yearly; ask your practice about eligibility" }
];
