import * as Notifications from "expo-notifications";

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

export async function scheduleMedicationReminder(name: string, hour: number, minute: number) {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission is required for medication reminders.");
  return Notifications.scheduleNotificationAsync({
    content: { title: "Medication reminder", body: `Time to follow your agreed plan for ${name}.`, data: { kind: "medication-reminder" } },
    // DATE scheduling lets the app reconcile the next occurrence after timezone,
    // permission, or plan changes. Native exactness is platform-dependent.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute }
  });
}
