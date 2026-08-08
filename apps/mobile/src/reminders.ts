import * as Notifications from "expo-notifications";
import type { MedicationPlan } from "../../../packages/shared/src/medication-plans";

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
    granted: permission.granted,
    canSchedule: permission.granted,
    exactAlarmNote: "Android exact-alarm behavior requires the SCHEDULE_EXACT_ALARM permission and must be verified on a physical device."
  };
}

export async function scheduleMedicationReminder(name: string, hour: number, minute: number, promptForPermission = true) {
  const permission = promptForPermission ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission is required for medication reminders.");
  return Notifications.scheduleNotificationAsync({
    content: { title: "Medication reminder", body: `Time to follow your agreed plan for ${name}.`, data: { kind: "medication-reminder" } },
    // DATE scheduling lets the app reconcile the next occurrence after timezone,
    // permission, or plan changes. Native exactness is platform-dependent.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute }
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
  const notificationId = await scheduleMedicationReminder(plan.medicationName, plan.reminderHour, plan.reminderMinute, options.promptForPermission);
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
  for (const plan of plans) {
    try {
      reconciled.push(await syncMedicationReminderWithOptions(plan, deviceTimezone, { promptForPermission, permissionGranted }));
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
