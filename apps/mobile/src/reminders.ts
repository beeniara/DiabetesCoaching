import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { MedicationPlan } from "../../../packages/shared/src/medication-plans";

export const MEDICATION_REMINDER_CATEGORY = "medication-reminder";
export const MEDICATION_ACTION_TAKEN = "medication-taken";
export const MEDICATION_ACTION_SNOOZE = "medication-snooze-10";
export const MEDICATION_ACTION_SKIPPED = "medication-skipped";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export async function getMedicationNotificationCapability() {
  const permission = await Notifications.getPermissionsAsync();
  return {
    status: permission.status,
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    canSchedule: permission.granted,
    exactAlarmStatus: Platform.OS === "android" ? "device-verification-required" as const : "not-applicable" as const,
    exactAlarmNote: Platform.OS === "android"
      ? "Android exact-alarm permission is declared, but exact delivery and idle behavior must be verified in device settings and on a physical device."
      : "The operating system may delay reminders. Delivery timing must be verified on a physical device."
  };
}

export async function configureMedicationNotifications() {
  await Notifications.setNotificationCategoryAsync(MEDICATION_REMINDER_CATEGORY, [
    { identifier: MEDICATION_ACTION_TAKEN, buttonTitle: "Record taken" },
    { identifier: MEDICATION_ACTION_SNOOZE, buttonTitle: "Snooze 10 min" },
    { identifier: MEDICATION_ACTION_SKIPPED, buttonTitle: "Record skipped", options: { isDestructive: true } }
  ]);
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("medication-reminders", {
      name: "Medication reminders",
      description: "Reminders for the medication plan entered in the app.",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250]
    });
  }
}

export async function scheduleMedicationReminder(name: string, hour: number, minute: number, promptForPermission = true, planId?: string) {
  const permission = promptForPermission ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission is required for medication reminders.");
  return Notifications.scheduleNotificationAsync({
    content: {
      title: "Medication reminder",
      body: `Time to follow your agreed plan for ${name}.`,
      data: { kind: "medication-reminder", medicationName: name, planId: planId ?? "" },
      categoryIdentifier: MEDICATION_REMINDER_CATEGORY
    },
    // DATE scheduling lets the app reconcile the next occurrence after timezone,
    // permission, or plan changes. Native exactness is platform-dependent.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: "medication-reminders" }
  });
}

export async function scheduleMedicationSnooze(name: string, planId?: string) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: "Medication reminder",
      body: `Reminder for your agreed plan for ${name}.`,
      data: { kind: "medication-reminder", medicationName: name, planId: planId ?? "" },
      categoryIdentifier: MEDICATION_REMINDER_CATEGORY
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 10 * 60,
      channelId: "medication-reminders"
    }
  });
}

export async function cancelMedicationReminder(notificationId?: string) {
  if (!notificationId) return;
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

export async function syncMedicationReminder(plan: MedicationPlan, deviceTimezone: string) {
  return syncMedicationReminderWithOptions(plan, deviceTimezone, { promptForPermission: false });
}

export async function syncMedicationReminderWithOptions(
  plan: MedicationPlan,
  deviceTimezone: string,
  options: { promptForPermission: boolean; permissionGranted?: boolean }
) {
  if (!plan.enabled) {
    await cancelMedicationReminder(plan.notificationId);
    return {
      ...plan,
      notificationId: undefined,
      scheduleStatus: "disabled" as const,
      updatedAt: new Date().toISOString()
    };
  }

  if (!options.promptForPermission && options.permissionGranted === false) {
    await cancelMedicationReminder(plan.notificationId);
    return {
      ...plan,
      notificationId: undefined,
      timezone: deviceTimezone,
      scheduleStatus: "pending" as const,
      updatedAt: new Date().toISOString()
    };
  }

  if (plan.notificationId && plan.timezone === deviceTimezone && plan.scheduleStatus === "scheduled") {
    return plan;
  }

  await cancelMedicationReminder(plan.notificationId);
  const notificationId = await scheduleMedicationReminder(plan.medicationName, plan.reminderHour, plan.reminderMinute, options.promptForPermission, plan.id);
  const now = new Date().toISOString();
  return {
    ...plan,
    timezone: deviceTimezone,
    notificationId,
    scheduleStatus: "scheduled" as const,
    updatedAt: now,
    lastScheduledAt: now
  };
}

export async function reconcileMedicationReminders(
  plans: MedicationPlan[],
  deviceTimezone: string,
  permissionGranted = false,
  promptForPermission = false
) {
  const reconciled: MedicationPlan[] = [];
  const issues: string[] = [];
  let effectivePermissionGranted = permissionGranted;
  if (promptForPermission && !effectivePermissionGranted && plans.some((plan) => plan.enabled)) {
    const permission = await Notifications.requestPermissionsAsync();
    effectivePermissionGranted = permission.granted;
    if (!permission.granted) issues.push("Notification permission was not granted. Enabled plans remain unscheduled.");
  }
  let nativeScheduleIds = new Set<string>();
  if (effectivePermissionGranted) {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      nativeScheduleIds = new Set(scheduled.map((request) => request.identifier));
    } catch {
      issues.push("The app could not verify reminders with the device scheduler.");
    }
  }
  for (const plan of plans) {
    try {
      const candidate = plan.notificationId && effectivePermissionGranted && !nativeScheduleIds.has(plan.notificationId)
        ? { ...plan, scheduleStatus: "stale" as const }
        : plan;
      reconciled.push(await syncMedicationReminderWithOptions(candidate, deviceTimezone, {
        promptForPermission: false,
        permissionGranted: effectivePermissionGranted
      }));
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Failed to sync a medication reminder.");
      reconciled.push({
        ...plan,
        scheduleStatus: "failed",
        updatedAt: new Date().toISOString()
      });
    }
  }
  return { plans: reconciled, issues };
}
