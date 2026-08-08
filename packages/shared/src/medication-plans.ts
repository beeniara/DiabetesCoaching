import { z } from "zod";

export const MedicationPlanScheduleStatusSchema = z.enum(["pending", "scheduled", "disabled", "stale", "failed"]);
export type MedicationPlanScheduleStatus = z.infer<typeof MedicationPlanScheduleStatusSchema>;

export const MedicationPlanSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  medicationName: z.string().min(1),
  reminderHour: z.number().int().min(0).max(23),
  reminderMinute: z.number().int().min(0).max(59),
  timezone: z.string().min(1),
  enabled: z.boolean(),
  notificationId: z.string().optional(),
  scheduleStatus: MedicationPlanScheduleStatusSchema,
  updatedAt: z.string().datetime({ offset: true }),
  lastScheduledAt: z.string().datetime({ offset: true }).optional()
});
export type MedicationPlan = z.infer<typeof MedicationPlanSchema>;

export function createMedicationPlan(input: {
  id: string;
  userId: string;
  medicationName: string;
  reminderHour: number;
  reminderMinute: number;
  timezone: string;
}): MedicationPlan {
  return {
    ...input,
    enabled: true,
    scheduleStatus: "pending",
    updatedAt: new Date().toISOString()
  };
}

export function medicationPlanNeedsReschedule(plan: MedicationPlan, deviceTimezone: string) {
  if (!plan.enabled) return false;
  if (!plan.notificationId) return true;
  if (plan.timezone !== deviceTimezone) return true;
  return plan.scheduleStatus !== "scheduled";
}

export function describeMedicationPlanStatus(plan: MedicationPlan, deviceTimezone: string) {
  if (!plan.enabled) return "Reminder disabled.";
  if (plan.timezone !== deviceTimezone) return "Timezone changed. Reminder should be rescheduled.";
  if (!plan.notificationId) return "Reminder has not been scheduled yet.";
  if (plan.scheduleStatus !== "scheduled") return "Reminder needs confirmation from the device scheduler.";
  return "Reminder is scheduled for the current device timezone.";
}
