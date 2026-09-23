import { describe, expect, it } from "vitest";
import { classifyEventQuality, mergeHealthEvents, normalizeHealthEvent, parseHealthEvent, parseStoredHealthEvents, safeGlucoseDisplay, type GlucoseEvent } from "./health-events";

const base = {
  id: "g-1", userId: "u-1", type: "glucose" as const, source: "cloud-cgm" as const,
  occurredAt: "2026-08-08T08:00:00+12:00", receivedAt: "2026-08-08T10:30:00+12:00",
  timezone: "Pacific/Auckland", confidence: 0.9, quality: "valid" as const,
  valueMmolL: 8.2, compartment: "interstitial-fluid" as const, trendMmolLPerMin: 0.12,
  sensorDelayMinutes: 150, context: "postprandial" as const
};

describe("health events", () => {
  it("accepts glucose compartment and marks delayed/lag-risk data", () => {
    const result = parseHealthEvent(base);
    expect(result.event?.type).toBe("glucose");
    if (!result.event || result.event.type !== "glucose") throw new Error("Expected a glucose event.");
    expect(result.event.compartment).toBe("interstitial-fluid");
    expect(result.issues.map((issue) => issue.code)).toEqual(["delayed", "lag-risk"]);
    expect(classifyEventQuality(result.event!, result.issues)).toBe("delayed");
    expect(safeGlucoseDisplay(result.event as GlucoseEvent).warning).toContain("lag");
  });

  it("deduplicates by event id and detects conflicting nearby readings", () => {
    const second = { ...base, id: "g-2", occurredAt: "2026-08-08T08:01:00+12:00", receivedAt: "2026-08-08T08:02:00+12:00", valueMmolL: 14.1 };
    const result = mergeHealthEvents([base, base, second]);
    expect(result.events).toHaveLength(2);
    expect(result.issues.map((issue) => issue.code)).toEqual(["duplicate", "conflict"]);
    expect(result.events.every((event) => event.quality === "conflicting")).toBe(true);
  });

  it("marks contradictory or future timestamps as suspect", () => {
    const result = normalizeHealthEvent(
      { ...base, occurredAt: "2026-08-08T11:00:00+12:00", receivedAt: "2026-08-08T10:00:00+12:00" },
      new Date("2026-08-08T10:00:00+12:00")
    );
    expect(result.issues.map((issue) => issue.code)).toEqual(["invalid", "invalid", "lag-risk"]);
    expect(result.event?.quality).toBe("suspect");
  });

  it("rejects reversed meal estimate ranges", () => {
    const result = parseHealthEvent({
      ...base,
      id: "meal-1",
      type: "meal",
      source: "manual",
      description: "Lunch",
      carbohydrateRangeGrams: { min: 70, max: 40 }
    });
    expect(result.event).toBeUndefined();
    expect(result.issues[0].code).toBe("invalid");
  });

  it("flags contradictory payloads that reuse one event id", () => {
    const result = mergeHealthEvents([base, { ...base, valueMmolL: 12.4 }]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].quality).toBe("conflicting");
    expect(result.issues.map((issue) => issue.code)).toEqual(["duplicate", "conflict"]);
  });

  it("keeps a stored conflicting reading labeled conflicting after it is reloaded and renormalized", () => {
    const second = { ...base, id: "g-2", occurredAt: "2026-08-08T08:01:00+12:00", receivedAt: "2026-08-08T08:02:00+12:00", valueMmolL: 14.1 };
    const merged = mergeHealthEvents([base, second]);
    expect(merged.events.every((event) => event.quality === "conflicting")).toBe(true);

    // Simulate a reload from storage: each stored event is parsed and normalized on its own,
    // with no access to the sibling reading that originally produced the conflict.
    const reloaded = merged.events.map((event) => normalizeHealthEvent(event).event);
    expect(reloaded.every((event) => event?.quality === "conflicting")).toBe(true);
  });

  it("detects a conflict between glucose readings separated by another event type", () => {
    const meal = {
      id: "meal-between", userId: "u-1", type: "meal" as const, source: "manual" as const,
      occurredAt: "2026-08-08T08:00:30+12:00", receivedAt: "2026-08-08T08:00:30+12:00",
      timezone: "Pacific/Auckland", confidence: 1, quality: "valid" as const, description: "Lunch"
    };
    const second = { ...base, id: "g-2", occurredAt: "2026-08-08T08:01:00+12:00", receivedAt: "2026-08-08T08:02:00+12:00", valueMmolL: 14.1 };
    const result = mergeHealthEvents([base, meal, second]);
    expect(result.issues.map((issue) => issue.code)).toContain("conflict");
    const glucoseEvents = result.events.filter((event) => event.type === "glucose");
    expect(glucoseEvents.every((event) => event.quality === "conflicting")).toBe(true);
  });

  it("does not conflict glucose readings from different compartments even when close together", () => {
    const capillary = { ...base, id: "g-cap", compartment: "capillary-blood" as const, occurredAt: "2026-08-08T08:00:30+12:00", receivedAt: "2026-08-08T08:00:30+12:00", valueMmolL: 14.1 };
    const result = mergeHealthEvents([base, capillary]);
    expect(result.issues.map((issue) => issue.code)).not.toContain("conflict");
    expect(result.events.every((event) => event.quality !== "conflicting")).toBe(true);
  });

  it("counts stored rows that are corrupt or no longer match the schema instead of dropping them silently", () => {
    const stored = [
      JSON.stringify({ ...base, quality: "conflicting" }),
      "{not json",
      JSON.stringify({ ...base, id: "g-bad", valueMmolL: -4 })
    ];
    const result = parseStoredHealthEvents(stored, new Date("2026-08-08T12:00:00+12:00"));
    expect(result.events.map((event) => event.id)).toEqual(["g-1"]);
    expect(result.events[0].quality).toBe("conflicting");
    expect(result.unreadableCount).toBe(2);
  });
});
