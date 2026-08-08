import { describe, expect, it } from "vitest";
import { mockBleGlucoseMeasurement, mockCloudRateLimitResponse, mockDelayedCloudCgm, mockImuExercise, mockMealVision } from "./mocks";
import { parseHealthEvent } from "./health-events";

describe("integration mocks", () => {
  it("models BLE, delayed cloud, meal, and IMU events", () => {
    for (const event of [mockBleGlucoseMeasurement(), mockDelayedCloudCgm(), mockMealVision(), mockImuExercise()]) {
      expect(parseHealthEvent(event).event).toBeDefined();
    }
    expect(mockBleGlucoseMeasurement().notes).toContain("0x2A18");
    expect(parseHealthEvent(mockDelayedCloudCgm()).issues.map((issue) => issue.code)).toContain("delayed");
  });

  it("exposes retry behavior for a rate-limited cloud API", () => {
    expect(mockCloudRateLimitResponse().status).toBe(429);
    expect(mockCloudRateLimitResponse().retryAfterSeconds).toBeGreaterThan(0);
  });
});
