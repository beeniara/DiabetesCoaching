import type { ExerciseEvent, GlucoseEvent, MealEvent } from "./health-events";

const now = new Date("2026-08-08T08:00:00+12:00");

export function mockBleGlucoseMeasurement(): GlucoseEvent {
  return {
    id: "mock-ble-0x2a18-1", userId: "demo-user", type: "glucose", source: "ble-bgm",
    occurredAt: now.toISOString(), receivedAt: now.toISOString(), timezone: "Pacific/Auckland",
    confidence: 0.98, quality: "valid", valueMmolL: 7.4, compartment: "capillary-blood",
    context: "random", notes: "Mock BLE Glucose Service 0x1808 / Measurement 0x2A18"
  };
}

export function mockDelayedCloudCgm(): GlucoseEvent {
  const occurredAt = new Date(now.getTime() - 90 * 60000);
  return {
    id: "mock-cloud-cgm-1", userId: "demo-user", type: "glucose", source: "cloud-cgm",
    occurredAt: occurredAt.toISOString(), receivedAt: now.toISOString(), timezone: "Pacific/Auckland",
    confidence: 0.9, quality: "delayed", valueMmolL: 9.1, compartment: "interstitial-fluid",
    trendMmolLPerMin: 0.13, sensorDelayMinutes: 90, context: "postprandial"
  };
}

export function mockMealVision(): MealEvent {
  return {
    id: "mock-meal-1", userId: "demo-user", type: "meal", source: "meal-vision",
    occurredAt: now.toISOString(), receivedAt: now.toISOString(), timezone: "Pacific/Auckland",
    confidence: 0.72, quality: "estimated", description: "Estimated rice bowl",
    carbohydrateRangeGrams: { min: 45, max: 70 }, proteinGrams: 28, fatGrams: 16,
    fiberGrams: 7, portionConfidence: 0.62, notes: "Portion estimate requires user confirmation."
  };
}

export function mockImuExercise(): ExerciseEvent {
  return {
    id: "mock-imu-1", userId: "demo-user", type: "exercise", source: "imu",
    occurredAt: new Date(now.getTime() - 45 * 60000).toISOString(), receivedAt: now.toISOString(),
    timezone: "Pacific/Auckland", confidence: 0.84, quality: "estimated", activity: "Cycling",
    durationMinutes: 35, intensity: "moderate", detectedFromImu: true
  };
}

export function mockCloudRateLimitResponse() {
  return { status: 429, retryAfterSeconds: 300, message: "Mock cloud API rate limit; retain last known data and retry later." };
}
