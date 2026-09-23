import { describe, expect, it } from "vitest";
import {
  createMedicationPlan,
  describeMedicationPlanStatus,
  describeNotificationCapability,
  describeUnreadableMedicationPlans,
  medicationPlanNeedsReschedule,
  planMedicationReminderSync,
  selectRemindersForUnreadablePlans,
  type MedicationPlan
} from "./medication-plans";

const plan = createMedicationPlan({
  id: "plan-1",
  userId: "user-1",
  medicationName: "Metformin",
  reminderHour: 8,
  reminderMinute: 30,
  timezone: "Pacific/Auckland"
});
const scheduled: MedicationPlan = { ...plan, notificationId: "native-1", scheduleStatus: "scheduled" };

describe("medication plans", () => {
  it("flags schedules that need sync when unscheduled or timezone shifted", () => {
    expect(medicationPlanNeedsReschedule(plan, "Pacific/Auckland")).toBe(true);
    expect(describeMedicationPlanStatus(plan, "Pacific/Auckland")).toContain("not been scheduled");
    expect(medicationPlanNeedsReschedule(scheduled, "Pacific/Auckland")).toBe(false);
    expect(medicationPlanNeedsReschedule(scheduled, "Australia/Sydney")).toBe(true);
  });

  it("describes failed, stale, and permission-blocked reminders distinctly", () => {
    expect(describeMedicationPlanStatus({ ...scheduled, scheduleStatus: "failed" }, "Pacific/Auckland")).toContain("could not be scheduled");
    expect(describeMedicationPlanStatus({ ...scheduled, scheduleStatus: "stale" }, "Pacific/Auckland")).toContain("missing from the device scheduler");
    expect(describeMedicationPlanStatus(plan, "Pacific/Auckland", false)).toContain("notifications are not allowed");
    expect(describeMedicationPlanStatus(scheduled, "Pacific/Auckland", true)).toContain("is scheduled");
    expect(describeMedicationPlanStatus({ ...scheduled, enabled: false }, "Pacific/Auckland", false)).toBe("Reminder disabled.");
  });

  it("warns that the plan list is incomplete when saved plans cannot be read", () => {
    expect(describeUnreadableMedicationPlans(0)).toBeUndefined();
    expect(describeUnreadableMedicationPlans(1)).toContain("1 saved reminder plan could not be read");
    expect(describeUnreadableMedicationPlans(2)).toContain("may still appear");
  });
});

describe("reminder reconciliation decisions", () => {
  const granted = { promptForPermission: false, permissionGranted: true };

  it("cancels disabled plans regardless of permission", () => {
    expect(planMedicationReminderSync({ ...scheduled, enabled: false }, "Pacific/Auckland", granted)).toEqual({ kind: "disable" });
    expect(planMedicationReminderSync({ ...scheduled, enabled: false }, "Pacific/Auckland", { promptForPermission: false, permissionGranted: false })).toEqual({ kind: "disable" });
  });

  it("waits for permission instead of scheduling when notifications are denied and no prompt is allowed", () => {
    expect(planMedicationReminderSync(scheduled, "Pacific/Auckland", { promptForPermission: false, permissionGranted: false })).toEqual({ kind: "await-permission" });
  });

  it("schedules when the user explicitly asks, even if permission was previously denied", () => {
    expect(planMedicationReminderSync(plan, "Pacific/Auckland", { promptForPermission: true, permissionGranted: false })).toEqual({ kind: "schedule", reason: "unscheduled" });
  });

  it("keeps a confirmed schedule that the device scheduler still holds", () => {
    expect(planMedicationReminderSync(scheduled, "Pacific/Auckland", { ...granted, nativeScheduleIds: new Set(["native-1"]) })).toEqual({ kind: "keep" });
  });

  it("reschedules a reminder the device scheduler no longer holds", () => {
    expect(planMedicationReminderSync(scheduled, "Pacific/Auckland", { ...granted, nativeScheduleIds: new Set(["other"]) })).toEqual({ kind: "schedule", reason: "missing-from-device" });
  });

  it("reschedules after a timezone change or an unconfirmed schedule", () => {
    expect(planMedicationReminderSync(scheduled, "Australia/Sydney", granted)).toEqual({ kind: "schedule", reason: "timezone-changed" });
    expect(planMedicationReminderSync({ ...scheduled, scheduleStatus: "stale" }, "Pacific/Auckland", granted)).toEqual({ kind: "schedule", reason: "not-confirmed" });
    expect(planMedicationReminderSync({ ...scheduled, scheduleStatus: "failed" }, "Pacific/Auckland", granted)).toEqual({ kind: "schedule", reason: "not-confirmed" });
  });
});

describe("notification capability reporting", () => {
  it("reports granted permission without claiming punctual delivery", () => {
    const capability = describeNotificationCapability({ status: "granted", granted: true, canAskAgain: true }, "ios");
    expect(capability.canSchedule).toBe(true);
    expect(capability.exactAlarmStatus).toBe("not-applicable");
    expect(capability.permissionMessage).toContain("can still delay");
    expect(capability.exactAlarmNote).toContain("physical device");
  });

  it("requires device verification of exact alarms on Android", () => {
    const capability = describeNotificationCapability({ status: "granted", granted: true, canAskAgain: true }, "android");
    expect(capability.exactAlarmStatus).toBe("device-verification-required");
    expect(capability.exactAlarmNote).toContain("exact-alarm");
  });

  it("tells the person how to recover when permission is undetermined or permanently denied", () => {
    const askable = describeNotificationCapability({ status: "undetermined", granted: false, canAskAgain: true }, "android");
    expect(askable.canSchedule).toBe(false);
    expect(askable.permissionMessage).toContain("ask again");

    const blocked = describeNotificationCapability({ status: "denied", granted: false, canAskAgain: false }, "android");
    expect(blocked.canSchedule).toBe(false);
    expect(blocked.permissionMessage).toContain("device settings");
  });
});

describe("cleanup of reminders left by unreadable plans", () => {
  const reminder = (identifier: string, planId?: string) => ({ identifier, data: { kind: "medication-reminder", medicationName: "x", planId: planId ?? "" } });

  it("cancels the daily reminder and snoozes of an unreadable plan", () => {
    const selected = selectRemindersForUnreadablePlans(
      [reminder("ghost-daily", "ghost"), reminder("ghost-snooze", "ghost")],
      [scheduled],
      [{ id: "ghost", notificationId: "ghost-daily" }]
    );
    expect(selected.sort()).toEqual(["ghost-daily", "ghost-snooze"]);
  });

  it("cancels an unreadable plan's stored notification even when the scheduler list is unavailable", () => {
    expect(selectRemindersForUnreadablePlans([], [scheduled], [{ id: "ghost", notificationId: "ghost-daily" }])).toEqual(["ghost-daily"]);
  });

  it("cancels reminders whose plan no longer exists at all", () => {
    expect(selectRemindersForUnreadablePlans([reminder("left-over", "deleted-plan")], [scheduled], [])).toEqual(["left-over"]);
  });

  it("never cancels a readable plan's reminders or snoozes", () => {
    const selected = selectRemindersForUnreadablePlans(
      [reminder("native-1", "plan-1"), reminder("plan-1-snooze", "plan-1"), reminder("ghost-daily", "ghost")],
      [scheduled],
      [{ id: "ghost", notificationId: "native-1" }]
    );
    expect(selected).toEqual(["ghost-daily"]);
  });

  it("leaves reminders it cannot attribute to a plan, and ignores other notification kinds", () => {
    const selected = selectRemindersForUnreadablePlans(
      [reminder("unattributed-snooze"), { identifier: "other", data: { kind: "something-else", planId: "ghost" } }],
      [scheduled],
      [{ id: "ghost" }]
    );
    expect(selected).toEqual([]);
  });
});
