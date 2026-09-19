import { describe, expect, it } from "vitest";
import { BLE_GLUCOSE_MEASUREMENT_CHARACTERISTIC_UUID, BLE_GLUCOSE_SERVICE_UUID, createMockBleGattReading, createMockCloudSync, mockBleGlucoseMeasurement, mockCloudRateLimitResponse, mockDelayedCloudCgm, mockImuExercise, mockMealVision } from "./mocks";
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

  it("identifies the standard BLE glucose GATT endpoints", () => {
    const reading = createMockBleGattReading({ now: new Date("2026-08-22T12:00:00+12:00") });
    expect(reading.serviceUuid).toBe(BLE_GLUCOSE_SERVICE_UUID);
    expect(reading.characteristicUuid).toBe(BLE_GLUCOSE_MEASUREMENT_CHARACTERISTIC_UUID);
  });

  it("constrains delayed cloud sync mocks to one through three hours", () => {
    const shortDelay = createMockCloudSync({ delayMinutes: 5 });
    const longDelay = createMockCloudSync({ delayMinutes: 400 });
    expect(shortDelay.status).toBe(200);
    expect(longDelay.status).toBe(200);
    if (shortDelay.status !== 200 || longDelay.status !== 200) throw new Error("Expected successful mock cloud syncs.");
    expect(shortDelay.delayMinutes).toBe(60);
    expect(longDelay.delayMinutes).toBe(180);
  });
});
