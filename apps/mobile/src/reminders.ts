import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { describeNotificationCapability, planMedicationReminderSync, selectRemindersForUnreadablePlans, type MedicationPlan, type UnreadablePlanRef } from "../../../packages/shared/src/medication-plans";

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
  const platform = Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "other";
  return describeNotificationCapability(permission, platform);
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

// The app schedules nothing but medication reminders, so this also clears snoozes and
// reminders left by plans that can no longer be read.
export async function cancelAllMedicationReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function syncMedicationReminder(plan: MedicationPlan, deviceTimezone: string) {
  return syncMedicationReminderWithOptions(plan, deviceTimezone, { promptForPermission: false });
}

export async function syncMedicationReminderWithOptions(
  plan: MedicationPlan,
  deviceTimezone: string,
  options: { promptForPermission: boolean; permissionGranted?: boolean; nativeScheduleIds?: ReadonlySet<string> }
): Promise<MedicationPlan> {
  const action = planMedicationReminderSync(plan, deviceTimezone, options);
  if (action.kind === "keep") return plan;

  if (action.kind === "disable") {
    await cancelMedicationReminder(plan.notificationId);
    return { ...plan, notificationId: undefined, scheduleStatus: "disabled", updatedAt: new Date().toISOString() };
  }

  if (action.kind === "await-permission") {
    await cancelMedicationReminder(plan.notificationId);
    return { ...plan, notificationId: undefined, timezone: deviceTimezone, scheduleStatus: "pending", updatedAt: new Date().toISOString() };
  }

  await cancelMedicationReminder(plan.notificationId);
  const notificationId = await scheduleMedicationReminder(plan.medicationName, plan.reminderHour, plan.reminderMinute, options.promptForPermission, plan.id);
  const now = new Date().toISOString();
  return {
    ...plan,
    timezone: deviceTimezone,
    notificationId,
    scheduleStatus: "scheduled",
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
  let nativeScheduleIds: Set<string> | undefined;
  if (effectivePermissionGranted) {
    nativeScheduleIds = new Set<string>();
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      nativeScheduleIds = new Set(scheduled.map((request) => request.identifier));
    } catch {
      issues.push("The app could not verify reminders with the device scheduler.");
    }
  }
  for (const plan of plans) {
    try {
      reconciled.push(await syncMedicationReminderWithOptions(plan, deviceTimezone, {
        promptForPermission: false,
        permissionGranted: effectivePermissionGranted,
        nativeScheduleIds
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

export async function cancelRemindersForUnreadablePlans(readablePlans: MedicationPlan[], unreadablePlans: UnreadablePlanRef[]) {
  let scheduled: Notifications.NotificationRequest[] = [];
  let verified = true;
  try {
    scheduled = await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    verified = false;
  }
  const identifiers = selectRemindersForUnreadablePlans(
    scheduled.map((request) => ({ identifier: request.identifier, data: request.content.data })),
    readablePlans,
    unreadablePlans
  );
  let failed = 0;
  for (const identifier of identifiers) {
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {
      failed += 1;
    }
  }
  return { cancelled: identifiers.length - failed, failed, verified };
}
