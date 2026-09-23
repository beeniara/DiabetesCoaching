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

export function describeMedicationPlanStatus(plan: MedicationPlan, deviceTimezone: string, permissionGranted?: boolean) {
  if (!plan.enabled) return "Reminder disabled.";
  if (plan.scheduleStatus === "failed") {
    return "Reminder could not be scheduled on this device. Use \"Check permission and resync\" to retry, and do not rely on it until it shows as scheduled.";
  }
  if (permissionGranted === false) return "Reminder is not scheduled because notifications are not allowed for this app.";
  if (plan.timezone !== deviceTimezone) return "Timezone changed. Reminder should be rescheduled.";
  if (!plan.notificationId) return "Reminder has not been scheduled yet.";
  if (plan.scheduleStatus === "stale") return "Reminder was missing from the device scheduler and needs to be resynced.";
  if (plan.scheduleStatus !== "scheduled") return "Reminder needs confirmation from the device scheduler.";
  return "Reminder is scheduled for the current device timezone.";
}

export type ReminderSyncAction =
  | { kind: "keep" }
  | { kind: "disable" }
  | { kind: "await-permission" }
  | { kind: "schedule"; reason: "unscheduled" | "timezone-changed" | "missing-from-device" | "not-confirmed" };

export function planMedicationReminderSync(
  plan: MedicationPlan,
  deviceTimezone: string,
  options: { promptForPermission: boolean; permissionGranted?: boolean; nativeScheduleIds?: ReadonlySet<string> }
): ReminderSyncAction {
  if (!plan.enabled) return { kind: "disable" };
  if (!options.promptForPermission && options.permissionGranted === false) return { kind: "await-permission" };
  if (!plan.notificationId) return { kind: "schedule", reason: "unscheduled" };
  if (options.nativeScheduleIds && !options.nativeScheduleIds.has(plan.notificationId)) return { kind: "schedule", reason: "missing-from-device" };
  if (plan.timezone !== deviceTimezone) return { kind: "schedule", reason: "timezone-changed" };
  if (plan.scheduleStatus !== "scheduled") return { kind: "schedule", reason: "not-confirmed" };
  return { kind: "keep" };
}

export type NotificationPlatform = "android" | "ios" | "other";

export type NotificationCapability = {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  canSchedule: boolean;
  exactAlarmStatus: "device-verification-required" | "not-applicable";
  exactAlarmNote: string;
  permissionMessage: string;
};

export function describeNotificationCapability(
  permission: { status: string; granted: boolean; canAskAgain: boolean },
  platform: NotificationPlatform
): NotificationCapability {
  const permissionMessage = permission.granted
    ? "Notifications are allowed. The operating system can still delay or suppress reminders."
    : permission.canAskAgain
      ? "Notifications are not allowed yet. Use \"Check permission and resync\" to ask again."
      : "Notifications are blocked for this app. Turn them on in the device settings to receive medication reminders.";
  return {
    status: permission.status,
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    canSchedule: permission.granted,
    exactAlarmStatus: platform === "android" ? "device-verification-required" : "not-applicable",
    exactAlarmNote: platform === "android"
      ? "Android exact-alarm permission is declared, but exact delivery and idle behavior must be verified in device settings and on a physical device."
      : "The operating system may delay reminders. Delivery timing must be verified on a physical device.",
    permissionMessage
  };
}
