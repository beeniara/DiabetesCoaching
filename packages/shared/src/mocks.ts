import type { ExerciseEvent, GlucoseEvent, MealEvent } from "./health-events";

export const BLE_GLUCOSE_SERVICE_UUID = "0x1808" as const;
export const BLE_GLUCOSE_MEASUREMENT_CHARACTERISTIC_UUID = "0x2A18" as const;

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
  return { status: 429 as const, retryAfterSeconds: 300, retainedExistingData: true, message: "Mock cloud API rate limit; retain last known data and retry later." };
}

export type MockIntegrationOptions = {
  now?: Date;
  userId?: string;
  timezone?: string;
};

function mockEventId(prefix: string, now: Date) {
  return `${prefix}-${now.getTime()}`;
}

export function createMockBleGattReading(options: MockIntegrationOptions = {}) {
  const current = options.now ?? new Date();
  const occurredAt = new Date(current.getTime() - 5 * 60000);
  const event: GlucoseEvent = {
    id: mockEventId("mock-ble", current),
    userId: options.userId ?? "demo-user",
    type: "glucose",
    source: "ble-bgm",
    occurredAt: occurredAt.toISOString(),
    receivedAt: current.toISOString(),
    timezone: options.timezone ?? "Pacific/Auckland",
    confidence: 0.98,
    quality: "valid",
    valueMmolL: 7.4,
    compartment: "capillary-blood",
    context: "random",
    notes: `Mock BLE Glucose Service ${BLE_GLUCOSE_SERVICE_UUID} / Measurement ${BLE_GLUCOSE_MEASUREMENT_CHARACTERISTIC_UUID}`
  };
  return {
    serviceUuid: BLE_GLUCOSE_SERVICE_UUID,
    characteristicUuid: BLE_GLUCOSE_MEASUREMENT_CHARACTERISTIC_UUID,
    sequenceNumber: Math.floor(current.getTime() / 1000) % 65536,
    event
  };
}

export function createMockCloudSync(options: MockIntegrationOptions & { delayMinutes?: number; rateLimited?: boolean } = {}) {
  if (options.rateLimited) return { ...mockCloudRateLimitResponse(), events: [] as GlucoseEvent[] };
  const current = options.now ?? new Date();
  const delayMinutes = Math.min(180, Math.max(60, options.delayMinutes ?? 90));
  const occurredAt = new Date(current.getTime() - delayMinutes * 60000);
  const event: GlucoseEvent = {
    id: mockEventId("mock-cloud-cgm", current),
    userId: options.userId ?? "demo-user",
    type: "glucose",
    source: "cloud-cgm",
    occurredAt: occurredAt.toISOString(),
    receivedAt: current.toISOString(),
    timezone: options.timezone ?? "Pacific/Auckland",
    confidence: 0.9,
    quality: "delayed",
    valueMmolL: 9.1,
    compartment: "interstitial-fluid",
    trendMmolLPerMin: 0.13,
    sensorDelayMinutes: delayMinutes,
    context: "postprandial"
  };
  return { status: 200 as const, delayMinutes, events: [event] };
}

export function createMockMealRecognition(options: MockIntegrationOptions = {}): MealEvent {
  const current = options.now ?? new Date();
  return {
    id: mockEventId("mock-meal", current),
    userId: options.userId ?? "demo-user",
    type: "meal",
    source: "meal-vision",
    occurredAt: new Date(current.getTime() - 35 * 60000).toISOString(),
    receivedAt: current.toISOString(),
    timezone: options.timezone ?? "Pacific/Auckland",
    confidence: 0.72,
    quality: "estimated",
    description: "Estimated rice bowl",
    carbohydrateRangeGrams: { min: 45, max: 70 },
    proteinGrams: 28,
    fatGrams: 16,
    fiberGrams: 7,
    portionConfidence: 0.62,
    notes: "Mock volumetric portion estimate; user confirmation is required."
  };
}

export function createMockImuExercise(options: MockIntegrationOptions = {}): ExerciseEvent {
  const current = options.now ?? new Date();
  return {
    id: mockEventId("mock-imu", current),
    userId: options.userId ?? "demo-user",
    type: "exercise",
    source: "imu",
    occurredAt: new Date(current.getTime() - 45 * 60000).toISOString(),
    receivedAt: current.toISOString(),
    timezone: options.timezone ?? "Pacific/Auckland",
    confidence: 0.84,
    quality: "estimated",
    activity: "Cycling",
    durationMinutes: 35,
    intensity: "moderate",
    detectedFromImu: true,
    notes: "Mock IMU-derived activity estimate."
  };
}

export function createMockIntegrationBatch(options: MockIntegrationOptions = {}) {
  const current = options.now ?? new Date();
  const shared = { ...options, now: current };
  return [
    createMockBleGattReading(shared).event,
    ...createMockCloudSync(shared).events,
    createMockMealRecognition(shared),
    createMockImuExercise(shared)
  ];
}
