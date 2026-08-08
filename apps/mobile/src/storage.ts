import * as SQLite from "expo-sqlite";
import type { HealthEvent, GlucoseEvent, MedicationEvent } from "../../../packages/shared/src/health-events";
import type { ShelfAnalysis } from "../../../packages/shared/src/shelf-analysis";
import { createDefaultUserProfile, markConsentAccepted, type UserProfile } from "../../../packages/shared/src/profile";
import { type MedicationPlan } from "../../../packages/shared/src/medication-plans";
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
    CREATE TABLE IF NOT EXISTS medication_plans (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      medication_name TEXT NOT NULL,
      reminder_hour INTEGER NOT NULL,
      reminder_minute INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      notification_id TEXT,
      schedule_status TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT NOT NULL,
      last_scheduled_at TEXT
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

export type ShelfThreadStatus = "queued" | "analyzed";

export type ShelfThreadRecord = {
  id: string;
  createdAt: string;
  localImageUri: string;
  caption?: string;
  status: ShelfThreadStatus;
  analysis?: ShelfAnalysis;
  analysisSource?: "mock" | "local-server";
};

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

export async function listMedicationPlans(db: SQLite.SQLiteDatabase): Promise<MedicationPlan[]> {
  const rows = await db.getAllAsync<{
    id: string;
    user_id: string;
    medication_name: string;
    reminder_hour: number;
    reminder_minute: number;
    timezone: string;
    enabled: number;
    notification_id: string | null;
    schedule_status: MedicationPlan["scheduleStatus"];
    updated_at: string;
    last_scheduled_at: string | null;
  }>(
    `SELECT id, user_id, medication_name, reminder_hour, reminder_minute, timezone, enabled, notification_id, schedule_status, updated_at, last_scheduled_at
     FROM medication_plans
     ORDER BY reminder_hour ASC, reminder_minute ASC, medication_name ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    medicationName: row.medication_name,
    reminderHour: row.reminder_hour,
    reminderMinute: row.reminder_minute,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    notificationId: row.notification_id ?? undefined,
    scheduleStatus: row.schedule_status,
    updatedAt: row.updated_at,
    lastScheduledAt: row.last_scheduled_at ?? undefined
  }));
}

export async function saveMedicationPlan(db: SQLite.SQLiteDatabase, plan: MedicationPlan) {
  await db.runAsync(
    `INSERT OR REPLACE INTO medication_plans (id, user_id, medication_name, reminder_hour, reminder_minute, timezone, enabled, notification_id, schedule_status, updated_at, last_scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    plan.id,
    plan.userId,
    plan.medicationName,
    plan.reminderHour,
    plan.reminderMinute,
    plan.timezone,
    plan.enabled ? 1 : 0,
    plan.notificationId ?? null,
    plan.scheduleStatus,
    plan.updatedAt,
    plan.lastScheduledAt ?? null
  );
}

export async function saveShelfThread(db: SQLite.SQLiteDatabase, thread: ShelfThreadRecord) {
  await db.runAsync(
    `INSERT OR REPLACE INTO shelf_messages (id, created_at, role, local_image_uri, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    thread.id,
    thread.createdAt,
    "thread",
    thread.localImageUri,
    JSON.stringify({
      caption: thread.caption ?? null,
      status: thread.status,
      analysis: thread.analysis ?? null,
      analysisSource: thread.analysisSource ?? null
    })
  );
}

export async function listShelfThreads(db: SQLite.SQLiteDatabase, limit = 50): Promise<ShelfThreadRecord[]> {
  const rows = await db.getAllAsync<{
    id: string;
    created_at: string;
    local_image_uri: string | null;
    payload_json: string | null;
  }>("SELECT id, created_at, local_image_uri, payload_json FROM shelf_messages ORDER BY created_at DESC LIMIT ?", limit);

  return rows.map((row) => {
    const payload = row.payload_json ? JSON.parse(row.payload_json) as { caption?: string | null; status?: ShelfThreadStatus; analysis?: ShelfAnalysis | null; analysisSource?: "mock" | "local-server" | null } : {};
    return {
      id: row.id,
      createdAt: row.created_at,
      localImageUri: row.local_image_uri ?? "",
      caption: payload.caption ?? undefined,
      status: payload.status ?? "queued",
      analysis: payload.analysis ?? undefined,
      analysisSource: payload.analysisSource ?? undefined
    };
  });
}

export async function deleteShelfThread(db: SQLite.SQLiteDatabase, id: string) {
  await db.runAsync("DELETE FROM shelf_messages WHERE id = ?", id);
}
