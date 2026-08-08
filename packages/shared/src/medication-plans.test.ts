import { describe, expect, it } from "vitest";
import { createMedicationPlan, describeMedicationPlanStatus, medicationPlanNeedsReschedule } from "./medication-plans";

describe("medication plans", () => {
  it("flags schedules that need sync when unscheduled or timezone shifted", () => {
    const plan = createMedicationPlan({
      id: "plan-1",
      userId: "user-1",
      medicationName: "Metformin",
      reminderHour: 8,
      reminderMinute: 30,
      timezone: "Pacific/Auckland"
    });

    expect(medicationPlanNeedsReschedule(plan, "Pacific/Auckland")).toBe(true);
    expect(describeMedicationPlanStatus(plan, "Pacific/Auckland")).toContain("not been scheduled");
    expect(medicationPlanNeedsReschedule({ ...plan, notificationId: "abc", scheduleStatus: "scheduled", updatedAt: new Date().toISOString() }, "Pacific/Auckland")).toBe(false);
    expect(medicationPlanNeedsReschedule({ ...plan, notificationId: "abc", scheduleStatus: "scheduled", updatedAt: new Date().toISOString() }, "Australia/Sydney")).toBe(true);
  });
});
