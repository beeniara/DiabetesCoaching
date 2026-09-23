import { describe, expect, it } from "vitest";
import { createMockBleGattReading, createMockCloudSync, createMockIntegrationBatch } from "./mocks";
import { synchronizeHealthEvents } from "./synchronization";

describe("health event synchronization", () => {
  const now = new Date("2026-08-22T12:00:00+12:00");

  it("normalizes BLE, delayed cloud, meal, and IMU events in one batch", () => {
    const result = synchronizeHealthEvents([], createMockIntegrationBatch({ now }), now);
    expect(result.events).toHaveLength(4);
    expect(result.events.find((event) => event.source === "cloud-cgm")?.quality).toBe("delayed");
    expect(result.issues.map((issue) => issue.code)).toContain("lag-risk");
  });

  it("deduplicates a repeated BLE delivery", () => {
    const ble = createMockBleGattReading({ now }).event;
    const result = synchronizeHealthEvents([ble], [ble], now);
    expect(result.events).toHaveLength(1);
    expect(result.issues.map((issue) => issue.code)).toContain("duplicate");
  });

  it("retains delayed cloud data and flags out-of-order arrival", () => {
    const ble = createMockBleGattReading({ now }).event;
    const cloud = createMockCloudSync({ now, delayMinutes: 120 });
    const result = synchronizeHealthEvents([ble], cloud.events, now);
    expect(result.events).toHaveLength(2);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["delayed", "lag-risk", "out-of-order"]));
  });

  it("rejects malformed incoming events without discarding existing records", () => {
    const ble = createMockBleGattReading({ now }).event;
    const result = synchronizeHealthEvents([ble], [{ type: "glucose" }], now);
    expect(result.events).toEqual([ble]);
    expect(result.rejectedIncoming).toBe(1);
  });

  it("reports existing records that fail validation instead of dropping them silently", () => {
    const ble = createMockBleGattReading({ now }).event;
    const result = synchronizeHealthEvents([ble, { ...ble, id: "corrupt", valueMmolL: -1 } as typeof ble], [], now);
    expect(result.events).toEqual([ble]);
    const invalid = result.issues.find((issue) => issue.code === "invalid");
    expect(invalid?.message).toContain("1 existing record failed validation");
  });
});
