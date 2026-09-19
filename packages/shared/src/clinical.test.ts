import { describe, expect, it } from "vitest";
import { CareTargetsSchema, DEFAULT_CARE_TARGETS, describeGlucose } from "./clinical";

describe("care targets", () => {
  it("rejects a reversed fasting range", () => {
    expect(CareTargetsSchema.safeParse({
      ...DEFAULT_CARE_TARGETS,
      fastingMinMmolL: 9,
      fastingMaxMmolL: 6
    }).success).toBe(false);
  });

  it("keeps target output contextual and non-prescriptive", () => {
    const result = describeGlucose(12, "postprandial", DEFAULT_CARE_TARGETS);
    expect(result.inRange).toBe(false);
    expect(result.message).toContain("discuss patterns");
    expect(result.safetyNote).not.toMatch(/dose|units/i);
  });
});
