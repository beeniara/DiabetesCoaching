import * as Notifications from "expo-notifications";

export async function scheduleMedicationReminder(name: string, hour: number, minute: number) {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission is required for medication reminders.");
  return Notifications.scheduleNotificationAsync({
    content: { title: "Medication reminder", body: `Time to follow your agreed plan for ${name}.`, data: { kind: "medication-reminder" } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute }
  });
}
