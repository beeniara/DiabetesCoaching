import { z } from "zod";

// A wellbeing check-in captures the everyday context that shapes glucose and
// motivation: sleep, mood, stress, hydration, and self-care habits. It is a
// self-report, never a clinical measurement, and it must stay optional.

export const MoodLevelSchema = z.enum(["low", "flat", "okay", "good", "great"]);
export type MoodLevel = z.infer<typeof MoodLevelSchema>;

export const StressLevelSchema = z.enum(["low", "moderate", "high"]);
export type StressLevel = z.infer<typeof StressLevelSchema>;

export const WellbeingCheckInSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1),
  sleepHours: z.number().finite().min(0).max(24).optional(),
  mood: MoodLevelSchema.optional(),
  stress: StressLevelSchema.optional(),
  waterGlasses: z.number().int().min(0).max(40).optional(),
  footCheckDone: z.boolean().optional(),
  notes: z.string().max(1000).optional()
});
export type WellbeingCheckIn = z.infer<typeof WellbeingCheckInSchema>;

export function parseWellbeingCheckIn(input: unknown, now = new Date()): { checkIn?: WellbeingCheckIn; issue?: string } {
  const parsed = WellbeingCheckInSchema.safeParse(input);
  if (!parsed.success) return { issue: parsed.error.issues.map((issue) => issue.message).join("; ") };
  const checkIn = parsed.data;
  if (Date.parse(checkIn.occurredAt) > now.getTime() + 5 * 60000) {
    return { issue: "Check-in time is in the future; review the device clock and timezone." };
  }
  const hasContent = checkIn.sleepHours !== undefined
    || checkIn.mood !== undefined
    || checkIn.stress !== undefined
    || checkIn.waterGlasses !== undefined
    || checkIn.footCheckDone !== undefined
    || (checkIn.notes !== undefined && checkIn.notes.trim().length > 0);
  if (!hasContent) return { issue: "Record at least one detail before saving a check-in." };
  return { checkIn };
}

export function parseStoredWellbeingCheckIns(payloads: string[]): { checkIns: WellbeingCheckIn[]; unreadableCount: number } {
  const checkIns: WellbeingCheckIn[] = [];
  let unreadableCount = 0;
  for (const payload of payloads) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(payload);
    } catch {
      unreadableCount += 1;
      continue;
    }
    const parsed = WellbeingCheckInSchema.safeParse(candidate);
    if (parsed.success) checkIns.push(parsed.data);
    else unreadableCount += 1;
  }
  return { checkIns, unreadableCount };
}

export type WellbeingReview = {
  checkInsInWindow: number;
  unreadableCount: number;
  unreadableNotice?: string;
  averageSleepHours?: number;
  shortSleepNights: number;
  highStressDays: number;
  lowMoodDays: number;
  footChecksDone: number;
  messages: string[];
};

const MOOD_ORDER: Record<MoodLevel, number> = { low: 0, flat: 1, okay: 2, good: 3, great: 4 };

export function reviewWellbeing(checkIns: WellbeingCheckIn[], now = new Date(), windowDays = 7, unreadableCount = 0): WellbeingReview {
  const windowStart = now.getTime() - windowDays * 86400000;
  const recent = checkIns.filter((checkIn) => {
    const at = Date.parse(checkIn.occurredAt);
    return Number.isFinite(at) && at >= windowStart && at <= now.getTime() + 5 * 60000;
  });
  const sleepValues = recent.flatMap((checkIn) => (checkIn.sleepHours === undefined ? [] : [checkIn.sleepHours]));
  const averageSleepHours = sleepValues.length > 0
    ? Math.round((sleepValues.reduce((total, hours) => total + hours, 0) / sleepValues.length) * 10) / 10
    : undefined;
  const shortSleepNights = sleepValues.filter((hours) => hours < 7).length;
  const highStressDays = recent.filter((checkIn) => checkIn.stress === "high").length;
  const lowMoodDays = recent.filter((checkIn) => checkIn.mood !== undefined && MOOD_ORDER[checkIn.mood] <= MOOD_ORDER.flat).length;
  const footChecksDone = recent.filter((checkIn) => checkIn.footCheckDone === true).length;

  const messages: string[] = [];
  // Absence claims are unreliable when saved check-ins could not be read.
  const complete = unreadableCount === 0;
  if (recent.length === 0 && complete) {
    messages.push("No check-ins in the last week yet. A quick daily check-in helps you and your care team see patterns.");
  }
  if (averageSleepHours !== undefined && averageSleepHours < 7 && sleepValues.length >= 3) {
    messages.push("Your logged sleep has averaged under 7 hours. Short sleep can make glucose harder to manage; a regular wind-down time is a good place to start.");
  }
  if (highStressDays >= 3) {
    messages.push("Stress has been high on several days. Slow breathing, a short walk, or talking with someone you trust can help; mention ongoing stress at your next review.");
  }
  if (lowMoodDays >= 4) {
    messages.push("Mood has been low on most logged days. Living with diabetes can be tiring; your GP, diabetes nurse, or a helpline can support you, and it is okay to ask.");
  }
  if (recent.length > 0 && footChecksDone === 0 && complete) {
    messages.push("No foot checks recorded this week. A quick daily look for cuts, redness, or swelling is one of the simplest ways to prevent problems.");
  }
  const unreadableNotice = complete
    ? undefined
    : `${unreadableCount} saved ${unreadableCount === 1 ? "check-in could not be read and is" : "check-ins could not be read and are"} not shown, so this weekly review may be incomplete.`;
  return { checkInsInWindow: recent.length, unreadableCount, unreadableNotice, averageSleepHours, shortSleepNights, highStressDays, lowMoodDays, footChecksDone, messages };
}

export function formatCheckInLabel(checkIn: WellbeingCheckIn): string {
  const parts: string[] = [];
  if (checkIn.sleepHours !== undefined) parts.push(`sleep ${checkIn.sleepHours} h`);
  if (checkIn.mood) parts.push(`mood ${checkIn.mood}`);
  if (checkIn.stress) parts.push(`stress ${checkIn.stress}`);
  if (checkIn.waterGlasses !== undefined) parts.push(`water ${checkIn.waterGlasses}`);
  if (checkIn.footCheckDone) parts.push("feet checked");
  if (parts.length === 0 && checkIn.notes) return checkIn.notes.slice(0, 60);
  return parts.join(" · ") || "Check-in";
}
