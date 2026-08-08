import * as SQLite from "expo-sqlite";
import type { HealthEvent, GlucoseEvent, MedicationEvent } from "../../../packages/shared/src/health-events";
import { createDefaultUserProfile, markConsentAccepted, type UserProfile } from "../../../packages/shared/src/profile";
import { summarizeTimeline } from "../../../packages/shared/src/timeline";

// The device database is the source of truth for the first release.
export async function openLocalStore() {
  const db = await SQLite.openDatabaseAsync("diabetes-coaching.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS glucose_readings (
      id TEXT PRIMARY KEY NOT NULL,
      measured_at TEXT NOT NULL,
      value_mmol_l REAL NOT NULL,
      context TEXT NOT NULL,
      compartment TEXT NOT NULL DEFAULT 'capillary-blood',
      source TEXT NOT NULL DEFAULT 'manual',
      received_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      quality TEXT NOT NULL DEFAULT 'valid',
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS health_events (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      quality TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT,
      timezone TEXT NOT NULL,
      consent_version TEXT NOT NULL,
      consent_state TEXT NOT NULL,
      consented_at TEXT
    );
    CREATE TABLE IF NOT EXISTS medication_reminders (
      id TEXT PRIMARY KEY NOT NULL,
      medicine_name TEXT NOT NULL,
      hour INTEGER NOT NULL,
      minute INTEGER NOT NULL,
      notification_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS shelf_messages (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      role TEXT NOT NULL,
      local_image_uri TEXT,
      payload_json TEXT
    );
  `);
  return db;
}

export async function getOrCreateUserProfile(db: SQLite.SQLiteDatabase, timezone = "Pacific/Auckland"): Promise<UserProfile> {
  const rows = await db.getAllAsync<{
    id: string;
    display_name: string | null;
    timezone: string;
    consent_version: string;
    consent_state: "pending" | "accepted" | "revoked";
    consented_at: string | null;
  }>("SELECT id, display_name, timezone, consent_version, consent_state, consented_at FROM user_profile ORDER BY id LIMIT 1");

  if (rows.length > 0) {
    const row = rows[0];
    const updatedAt = row.consented_at ?? new Date().toISOString();
    return {
      id: row.id,
      displayName: row.display_name ?? undefined,
      timezone: row.timezone,
      consentVersion: row.consent_version,
      consentState: row.consent_state,
      consentedAt: row.consented_at ?? undefined,
      updatedAt
    };
  }

  const profile = createDefaultUserProfile(timezone);
  await saveUserProfile(db, profile);
  return profile;
}

export async function saveUserProfile(db: SQLite.SQLiteDatabase, profile: UserProfile) {
  await db.runAsync(
    `INSERT OR REPLACE INTO user_profile (id, display_name, timezone, consent_version, consent_state, consented_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    profile.id,
    profile.displayName ?? null,
    profile.timezone,
    profile.consentVersion,
    profile.consentState,
    profile.consentedAt ?? profile.updatedAt
  );
}

export async function acceptConsent(db: SQLite.SQLiteDatabase, profile: UserProfile) {
  const accepted = markConsentAccepted(profile);
  await saveUserProfile(db, accepted);
  return accepted;
}

export async function saveHealthEvent(db: SQLite.SQLiteDatabase, event: HealthEvent) {
  await db.runAsync(
    `INSERT OR REPLACE INTO health_events (id, user_id, event_type, occurred_at, received_at, timezone, source, confidence, quality, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event.id, event.userId, event.type, event.occurredAt, event.receivedAt, event.timezone,
    event.source, event.confidence, event.quality, JSON.stringify(event)
  );
}

export async function listHealthEvents(db: SQLite.SQLiteDatabase, limit = 100): Promise<HealthEvent[]> {
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM health_events ORDER BY occurred_at DESC LIMIT ?", limit
  );
  return rows.map((row) => JSON.parse(row.payload_json) as HealthEvent);
}

export async function addGlucoseEntry(db: SQLite.SQLiteDatabase, event: GlucoseEvent) {
  await saveHealthEvent(db, event);
}

export async function addMedicationEntry(db: SQLite.SQLiteDatabase, event: MedicationEvent) {
  await saveHealthEvent(db, event);
}

export async function getTimelineSummary(db: SQLite.SQLiteDatabase) {
  const events = await listHealthEvents(db, 100);
  return summarizeTimeline(events);
}
