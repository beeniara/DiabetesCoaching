import * as SQLite from "expo-sqlite";
import { HealthEventSchema, parseStoredHealthEvents, type HealthEvent, type GlucoseEvent, type MedicationEvent } from "../../../packages/shared/src/health-events";
import { CareTargetsSchema, DEFAULT_CARE_TARGETS, type CareTargets } from "../../../packages/shared/src/clinical";
import { ShelfAnalysisSchema, type ShelfAnalysis } from "../../../packages/shared/src/shelf-analysis";
import { createDefaultUserProfile, markConsentAccepted, UserProfileSchema, type UserProfile } from "../../../packages/shared/src/profile";
import { MedicationPlanSchema, type MedicationPlan } from "../../../packages/shared/src/medication-plans";
import { WellbeingCheckInSchema, type WellbeingCheckIn } from "../../../packages/shared/src/wellbeing";
import { createDefaultWellnessGoals, WellnessGoalsSchema, type WellnessGoals } from "../../../packages/shared/src/coaching";

const DATABASE_VERSION = 4;

async function migrateLocalStore(db: SQLite.SQLiteDatabase) {
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const versionRow = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  let version = versionRow?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
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
      CREATE INDEX IF NOT EXISTS health_events_occurred_at_idx ON health_events(occurred_at DESC);
      CREATE TABLE IF NOT EXISTS user_profile (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT,
        timezone TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        consent_state TEXT NOT NULL,
        consented_at TEXT,
        updated_at TEXT NOT NULL
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
      CREATE INDEX IF NOT EXISTS shelf_messages_created_at_idx ON shelf_messages(created_at DESC);
      CREATE TABLE IF NOT EXISTS local_server_settings (
        id TEXT PRIMARY KEY NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        preferred_mode TEXT NOT NULL
      );
    `);
    version = 1;
  }

  if (version < 2) {
    const profileColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(user_profile)");
    if (!profileColumns.some((column) => column.name === "updated_at")) {
      await db.execAsync("ALTER TABLE user_profile ADD COLUMN updated_at TEXT;");
    }
    const migrationTime = new Date().toISOString();
    await db.runAsync(
      "UPDATE user_profile SET updated_at = COALESCE(updated_at, consented_at, ?) WHERE updated_at IS NULL",
      migrationTime
    );
    await db.runAsync("UPDATE user_profile SET consented_at = NULL WHERE consent_state <> 'accepted'");
    version = 2;
  }

  if (version < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS care_targets (
        id TEXT PRIMARY KEY NOT NULL,
        fasting_min_mmol_l REAL NOT NULL,
        fasting_max_mmol_l REAL NOT NULL,
        postprandial_max_mmol_l REAL NOT NULL,
        hba1c_max_mmol_mol REAL NOT NULL,
        clinician_reviewed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
    version = 3;
  }

  if (version < 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS wellbeing_checkins (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS wellbeing_checkins_occurred_at_idx ON wellbeing_checkins(occurred_at DESC);
      CREATE TABLE IF NOT EXISTS wellness_goals (
        id TEXT PRIMARY KEY NOT NULL,
        weekly_active_minutes INTEGER NOT NULL,
        resistance_days_per_week INTEGER NOT NULL,
        daily_check_in INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);
    version = 4;
  }

  if (version !== DATABASE_VERSION) throw new Error("The local database version is newer than this app supports.");
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION};`);
}

// The device database is the source of truth. Migrations are idempotent so
// existing installations retain local records across app upgrades.
export async function openLocalStore() {
  const db = await SQLite.openDatabaseAsync("diabetes-coaching.db");
  await migrateLocalStore(db);
  return db;
}

export type ShelfThreadStatus = "queued" | "analyzed" | "failed";

export type ShelfThreadRecord = {
  id: string;
  createdAt: string;
  localImageUri: string;
  caption?: string;
  status: ShelfThreadStatus;
  analysis?: ShelfAnalysis;
  analysisSource?: "mock" | "local-server";
  lastError?: string;
};

export async function getOrCreateUserProfile(db: SQLite.SQLiteDatabase, timezone = "Pacific/Auckland"): Promise<UserProfile> {
  const rows = await db.getAllAsync<{
    id: string;
    display_name: string | null;
    timezone: string;
    consent_version: string;
    consent_state: "pending" | "accepted" | "revoked";
    consented_at: string | null;
    updated_at: string | null;
  }>("SELECT id, display_name, timezone, consent_version, consent_state, consented_at, updated_at FROM user_profile ORDER BY id LIMIT 1");

  if (rows.length > 0) {
    const row = rows[0];
    const parsed = UserProfileSchema.safeParse({
      id: row.id,
      displayName: row.display_name ?? undefined,
      timezone: row.timezone,
      consentVersion: row.consent_version,
      consentState: row.consent_state,
      consentedAt: row.consented_at ?? undefined,
      updatedAt: row.updated_at ?? new Date().toISOString()
    });
    if (parsed.success) return parsed.data;
    await db.runAsync("DELETE FROM user_profile WHERE id = ?", row.id);
  }

  const profile = createDefaultUserProfile(timezone);
  await saveUserProfile(db, profile);
  return profile;
}

export async function saveUserProfile(db: SQLite.SQLiteDatabase, profile: UserProfile) {
  const validatedProfile = UserProfileSchema.parse(profile);
  await db.runAsync(
    `INSERT OR REPLACE INTO user_profile (id, display_name, timezone, consent_version, consent_state, consented_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    validatedProfile.id,
    validatedProfile.displayName ?? null,
    validatedProfile.timezone,
    validatedProfile.consentVersion,
    validatedProfile.consentState,
    validatedProfile.consentedAt ?? null,
    validatedProfile.updatedAt
  );
}

export async function acceptConsent(db: SQLite.SQLiteDatabase, profile: UserProfile) {
  const accepted = markConsentAccepted(profile);
  await saveUserProfile(db, accepted);
  return accepted;
}

export async function saveHealthEvent(db: SQLite.SQLiteDatabase, event: HealthEvent) {
  const validatedEvent = HealthEventSchema.parse(event);
  return db.runAsync(
    `INSERT INTO health_events (id, user_id, event_type, occurred_at, received_at, timezone, source, confidence, quality, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    validatedEvent.id, validatedEvent.userId, validatedEvent.type, validatedEvent.occurredAt, validatedEvent.receivedAt, validatedEvent.timezone,
    validatedEvent.source, validatedEvent.confidence, validatedEvent.quality, JSON.stringify(validatedEvent)
  );
}

export async function replaceHealthEvents(db: SQLite.SQLiteDatabase, events: HealthEvent[]) {
  const validatedEvents = events.map((event) => HealthEventSchema.parse(event));
  await db.withTransactionAsync(async () => {
    for (const event of validatedEvents) {
      await db.runAsync(
        `INSERT INTO health_events (id, user_id, event_type, occurred_at, received_at, timezone, source, confidence, quality, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           event_type = excluded.event_type,
           occurred_at = excluded.occurred_at,
           received_at = excluded.received_at,
           timezone = excluded.timezone,
           source = excluded.source,
           confidence = excluded.confidence,
           quality = excluded.quality,
           payload_json = excluded.payload_json`,
        event.id,
        event.userId,
        event.type,
        event.occurredAt,
        event.receivedAt,
        event.timezone,
        event.source,
        event.confidence,
        event.quality,
        JSON.stringify(event)
      );
    }
  });
}

export async function listHealthEvents(db: SQLite.SQLiteDatabase, limit = 100): Promise<{ events: HealthEvent[]; unreadableCount: number }> {
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM health_events ORDER BY occurred_at DESC LIMIT ?", limit
  );
  return parseStoredHealthEvents(rows.map((row) => row.payload_json));
}

export async function addGlucoseEntry(db: SQLite.SQLiteDatabase, event: GlucoseEvent) {
  await saveHealthEvent(db, event);
}

export async function addMedicationEntry(db: SQLite.SQLiteDatabase, event: MedicationEvent) {
  await saveHealthEvent(db, event);
}

export async function listMedicationPlans(db: SQLite.SQLiteDatabase): Promise<{ plans: MedicationPlan[]; unreadableCount: number }> {
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
  const plans = rows.flatMap((row) => {
    const parsed = MedicationPlanSchema.safeParse({
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
    });
    return parsed.success ? [parsed.data] : [];
  });
  return { plans, unreadableCount: rows.length - plans.length };
}

export async function getCareTargets(db: SQLite.SQLiteDatabase): Promise<CareTargets> {
  const row = await db.getFirstAsync<{
    fasting_min_mmol_l: number;
    fasting_max_mmol_l: number;
    postprandial_max_mmol_l: number;
    hba1c_max_mmol_mol: number;
    clinician_reviewed: number;
  }>(
    `SELECT fasting_min_mmol_l, fasting_max_mmol_l, postprandial_max_mmol_l, hba1c_max_mmol_mol, clinician_reviewed
     FROM care_targets WHERE id = 'default' LIMIT 1`
  );
  if (!row) return DEFAULT_CARE_TARGETS;
  const parsed = CareTargetsSchema.safeParse({
    fastingMinMmolL: row.fasting_min_mmol_l,
    fastingMaxMmolL: row.fasting_max_mmol_l,
    postprandialMaxMmolL: row.postprandial_max_mmol_l,
    hba1cMaxMmolMol: row.hba1c_max_mmol_mol,
    clinicianReviewed: row.clinician_reviewed === 1
  });
  return parsed.success ? parsed.data : DEFAULT_CARE_TARGETS;
}

export async function saveCareTargets(db: SQLite.SQLiteDatabase, targets: CareTargets) {
  const validatedTargets = CareTargetsSchema.parse(targets);
  await db.runAsync(
    `INSERT OR REPLACE INTO care_targets
     (id, fasting_min_mmol_l, fasting_max_mmol_l, postprandial_max_mmol_l, hba1c_max_mmol_mol, clinician_reviewed, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?)`,
    validatedTargets.fastingMinMmolL,
    validatedTargets.fastingMaxMmolL,
    validatedTargets.postprandialMaxMmolL,
    validatedTargets.hba1cMaxMmolMol,
    validatedTargets.clinicianReviewed ? 1 : 0,
    new Date().toISOString()
  );
}

export async function saveMedicationPlan(db: SQLite.SQLiteDatabase, plan: MedicationPlan) {
  const validatedPlan = MedicationPlanSchema.parse(plan);
  await db.runAsync(
    `INSERT OR REPLACE INTO medication_plans (id, user_id, medication_name, reminder_hour, reminder_minute, timezone, enabled, notification_id, schedule_status, updated_at, last_scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    validatedPlan.id,
    validatedPlan.userId,
    validatedPlan.medicationName,
    validatedPlan.reminderHour,
    validatedPlan.reminderMinute,
    validatedPlan.timezone,
    validatedPlan.enabled ? 1 : 0,
    validatedPlan.notificationId ?? null,
    validatedPlan.scheduleStatus,
    validatedPlan.updatedAt,
    validatedPlan.lastScheduledAt ?? null
  );
}

export async function deleteMedicationPlan(db: SQLite.SQLiteDatabase, id: string) {
  await db.runAsync("DELETE FROM medication_plans WHERE id = ?", id);
}

export async function saveShelfThread(db: SQLite.SQLiteDatabase, thread: ShelfThreadRecord) {
  const analysis = thread.analysis ? ShelfAnalysisSchema.parse(thread.analysis) : undefined;
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
      analysis: analysis ?? null,
      analysisSource: thread.analysisSource ?? null,
      lastError: thread.lastError ?? null
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
    let payload: { caption?: string | null; status?: ShelfThreadStatus; analysis?: unknown; analysisSource?: "mock" | "local-server" | null; lastError?: string | null } = {};
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) as typeof payload : {};
    } catch {
      payload = {};
    }
    const parsedAnalysis = payload.analysis ? ShelfAnalysisSchema.safeParse(payload.analysis) : undefined;
    const analysis = parsedAnalysis?.success ? parsedAnalysis.data : undefined;
    const status: ShelfThreadStatus = payload.status === "analyzed" && analysis
      ? "analyzed"
      : payload.status === "failed"
        ? "failed"
        : "queued";
    const analysisSource = payload.analysisSource === "mock" || payload.analysisSource === "local-server"
      ? payload.analysisSource
      : undefined;
    return {
      id: row.id,
      createdAt: row.created_at,
      localImageUri: row.local_image_uri ?? "",
      caption: payload.caption ?? undefined,
      status,
      analysis,
      analysisSource,
      lastError: typeof payload.lastError === "string" ? payload.lastError.slice(0, 240) : undefined
    };
  });
}

export async function deleteShelfThread(db: SQLite.SQLiteDatabase, id: string) {
  await db.runAsync("DELETE FROM shelf_messages WHERE id = ?", id);
}

export async function saveWellbeingCheckIn(db: SQLite.SQLiteDatabase, checkIn: WellbeingCheckIn) {
  const validated = WellbeingCheckInSchema.parse(checkIn);
  await db.runAsync(
    `INSERT OR REPLACE INTO wellbeing_checkins (id, user_id, occurred_at, timezone, payload_json) VALUES (?, ?, ?, ?, ?)`,
    validated.id,
    validated.userId,
    validated.occurredAt,
    validated.timezone,
    JSON.stringify(validated)
  );
}

export async function listWellbeingCheckIns(db: SQLite.SQLiteDatabase, limit = 60): Promise<WellbeingCheckIn[]> {
  const rows = await db.getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM wellbeing_checkins ORDER BY occurred_at DESC LIMIT ?", limit
  );
  return rows.flatMap((row) => {
    try {
      const parsed = WellbeingCheckInSchema.safeParse(JSON.parse(row.payload_json));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export async function deleteWellbeingCheckIn(db: SQLite.SQLiteDatabase, id: string) {
  await db.runAsync("DELETE FROM wellbeing_checkins WHERE id = ?", id);
}

export async function getWellnessGoals(db: SQLite.SQLiteDatabase): Promise<WellnessGoals> {
  const row = await db.getFirstAsync<{
    weekly_active_minutes: number;
    resistance_days_per_week: number;
    daily_check_in: number;
    updated_at: string;
  }>("SELECT weekly_active_minutes, resistance_days_per_week, daily_check_in, updated_at FROM wellness_goals WHERE id = 'default' LIMIT 1");
  if (!row) return createDefaultWellnessGoals();
  const parsed = WellnessGoalsSchema.safeParse({
    weeklyActiveMinutes: row.weekly_active_minutes,
    resistanceDaysPerWeek: row.resistance_days_per_week,
    dailyCheckIn: row.daily_check_in === 1,
    updatedAt: row.updated_at
  });
  return parsed.success ? parsed.data : createDefaultWellnessGoals();
}

export async function saveWellnessGoals(db: SQLite.SQLiteDatabase, goals: WellnessGoals) {
  const validated = WellnessGoalsSchema.parse(goals);
  await db.runAsync(
    `INSERT OR REPLACE INTO wellness_goals (id, weekly_active_minutes, resistance_days_per_week, daily_check_in, updated_at)
     VALUES ('default', ?, ?, ?, ?)`,
    validated.weeklyActiveMinutes,
    validated.resistanceDaysPerWeek,
    validated.dailyCheckIn ? 1 : 0,
    validated.updatedAt
  );
}

export async function deleteAllLocalRecords(db: SQLite.SQLiteDatabase) {
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM health_events");
    await db.runAsync("DELETE FROM wellbeing_checkins");
    await db.runAsync("DELETE FROM wellness_goals");
    await db.runAsync("DELETE FROM medication_plans");
    await db.runAsync("DELETE FROM shelf_messages");
    await db.runAsync("DELETE FROM care_targets");
    await db.runAsync("DELETE FROM user_profile");
    await db.runAsync("DELETE FROM local_server_settings");
  });
}
