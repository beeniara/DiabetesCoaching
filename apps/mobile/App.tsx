import { useEffect, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DEFAULT_CARE_TARGETS } from "../../packages/shared/src/clinical";
import { createDefaultUserProfile, type UserProfile } from "../../packages/shared/src/profile";
import { addGlucoseEntry, addMedicationEntry, acceptConsent, getOrCreateUserProfile, listHealthEvents, openLocalStore, saveUserProfile } from "./src/storage";
import { getMedicationNotificationCapability, scheduleMedicationReminder } from "./src/reminders";
import { formatTimelineLabel, summarizeTimeline } from "../../packages/shared/src/timeline";
import { parseHealthEvent, safeGlucoseDisplay, type GlucoseCompartment, type HealthEvent, type MedicationEvent } from "../../packages/shared/src/health-events";
import { mockBleGlucoseMeasurement, mockImuExercise, mockMealVision } from "../../packages/shared/src/mocks";

type InputState = {
  glucoseValue: string;
  glucoseContext: "fasting" | "postprandial" | "exercise" | "random";
  glucoseCompartment: GlucoseCompartment;
  glucoseNote: string;
  medicationName: string;
  medicationStatus: MedicationEvent["status"];
  medicationDoseLabel: string;
  reminderHour: string;
  reminderMinute: string;
};

const initialInputs: InputState = {
  glucoseValue: "",
  glucoseContext: "random",
  glucoseCompartment: "capillary-blood",
  glucoseNote: "",
  medicationName: "",
  medicationStatus: "taken",
  medicationDoseLabel: "",
  reminderHour: "8",
  reminderMinute: "0"
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short"
  }).format(new Date(value));
}

function createHealthEventId(prefix: string) {
  return `${prefix}-${Date.now()}`;
}

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [statusMessage, setStatusMessage] = useState("Loading local data...");
  const [capability, setCapability] = useState<{ granted: boolean; canSchedule: boolean; exactAlarmNote: string } | null>(null);
  const [inputs, setInputs] = useState<InputState>(initialInputs);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openLocalStore();
        const loadedProfile = await getOrCreateUserProfile(db, "Pacific/Auckland");
        const loadedEvents = await listHealthEvents(db, 200);
        const notificationCapability = await getMedicationNotificationCapability();

        if (cancelled) return;
        setProfile(loadedProfile);
        setEvents(loadedEvents);
        setCapability(notificationCapability);
        setStatusMessage("Local profile and timeline loaded.");
      } catch (error) {
        if (!cancelled) setStatusMessage(error instanceof Error ? error.message : "Failed to load local data.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dbState = useMemo(() => summarizeTimeline(events), [events]);
  const latestGlucose = dbState.latestGlucose ?? mockBleGlucoseMeasurement();
  const glucoseDisplay = safeGlucoseDisplay(latestGlucose);
  const fallbackEvents = useMemo(() => [mockBleGlucoseMeasurement(), mockMealVision(), mockImuExercise()], []);

  async function refreshTimeline() {
    const db = await openLocalStore();
    setEvents(await listHealthEvents(db, 200));
  }

  async function handleAcceptConsent() {
    if (!profile) return;
    const db = await openLocalStore();
    const accepted = await acceptConsent(db, profile);
    setProfile(accepted);
    setStatusMessage("Consent recorded locally.");
  }

  async function handleResetProfile() {
    const timezone = profile?.timezone ?? "Pacific/Auckland";
    const nextProfile = createDefaultUserProfile(timezone);
    const db = await openLocalStore();
    await saveUserProfile(db, nextProfile);
    setProfile(nextProfile);
    setStatusMessage("Local profile reset.");
  }

  async function handleSaveGlucose() {
    if (!profile) return;
    const value = Number.parseFloat(inputs.glucoseValue);
    if (!Number.isFinite(value) || value <= 0) {
      setStatusMessage("Enter a valid glucose value in mmol/L.");
      return;
    }
    const now = new Date().toISOString();
    const candidate = {
      id: createHealthEventId("glucose"),
      userId: profile.id,
      type: "glucose" as const,
      source: "manual" as const,
      occurredAt: now,
      receivedAt: now,
      timezone: profile.timezone,
      confidence: 1,
      quality: "valid" as const,
      valueMmolL: value,
      compartment: inputs.glucoseCompartment,
      context: inputs.glucoseContext,
      notes: inputs.glucoseNote.trim() || undefined
    };
    const parsed = parseHealthEvent(candidate);
    if (!parsed.event || parsed.event.type !== "glucose") {
      setStatusMessage(parsed.issues[0]?.message ?? "Unable to save glucose reading.");
      return;
    }
    const db = await openLocalStore();
    await addGlucoseEntry(db, parsed.event);
    setInputs((current) => ({ ...current, glucoseValue: "", glucoseNote: "" }));
    await refreshTimeline();
    setStatusMessage("Glucose reading saved locally.");
  }

  async function handleSaveMedication() {
    if (!profile) return;
    if (!inputs.medicationName.trim()) {
      setStatusMessage("Enter a medication name.");
      return;
    }
    const now = new Date().toISOString();
    const candidate = {
      id: createHealthEventId("medication"),
      userId: profile.id,
      type: "medication" as const,
      source: "manual" as const,
      occurredAt: now,
      receivedAt: now,
      timezone: profile.timezone,
      confidence: 1,
      quality: "valid" as const,
      medicationName: inputs.medicationName.trim(),
      status: inputs.medicationStatus,
      prescribedDoseLabel: inputs.medicationDoseLabel.trim() || undefined
    };
    const parsed = parseHealthEvent(candidate);
    if (!parsed.event || parsed.event.type !== "medication") {
      setStatusMessage(parsed.issues[0]?.message ?? "Unable to save medication event.");
      return;
    }
    const db = await openLocalStore();
    await addMedicationEntry(db, parsed.event);
    setInputs((current) => ({ ...current, medicationName: "", medicationDoseLabel: "" }));
    await refreshTimeline();
    setStatusMessage("Medication event saved locally.");
  }

  async function handleScheduleReminder() {
    const hour = Number.parseInt(inputs.reminderHour, 10);
    const minute = Number.parseInt(inputs.reminderMinute, 10);
    if (!inputs.medicationName.trim()) {
      setStatusMessage("Enter the medication name before scheduling a reminder.");
      return;
    }
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      setStatusMessage("Enter a valid reminder time.");
      return;
    }
    try {
      await scheduleMedicationReminder(inputs.medicationName.trim(), hour, minute);
      setStatusMessage("Medication reminder scheduled on the device.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to schedule reminder.");
    }
  }

  const timeline = events.length > 0 ? dbState : summarizeTimeline(fallbackEvents);
  const latestGlucoseCard = timeline.latestGlucose ? safeGlucoseDisplay(timeline.latestGlucose) : glucoseDisplay;
  const consentBanner = profile?.consentState === "accepted"
    ? "Consent is active for local tracking."
    : profile?.consentState === "revoked"
      ? "Consent is revoked. Logging should stop until the user re-accepts."
      : "Consent has not been accepted yet. Core tracking should stay limited until the user agrees.";

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>Diabetes coaching companion</Text>
        <Text style={styles.title}>Local-first foundation</Text>
        <Text style={styles.subtitle}>Unified timeline, manual logging, consent, and reminder readiness.</Text>

        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>Safety boundary</Text>
          <Text style={styles.bannerText}>
            This app supports wellness and decision support. It does not diagnose, calculate doses, change medication, or handle emergencies.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Profile and consent</Text>
          <Text style={styles.bodyText}>{consentBanner}</Text>
          <Text style={styles.muted}>Timezone: {profile?.timezone ?? "Pacific/Auckland"}</Text>
          <Text style={styles.muted}>Consent version: {profile?.consentVersion ?? "2026-08-08"}</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleAcceptConsent}>
              <Text style={styles.primaryButtonText}>Accept consent</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleResetProfile}>
              <Text style={styles.secondaryButtonText}>Reset local profile</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Glucose freshness</Text>
          <Text style={styles.metric}>{latestGlucoseCard.label}</Text>
          <Text style={styles.bodyText}>{timeline.warning}</Text>
          <Text style={styles.muted}>Timeline freshness: {timeline.freshness}</Text>
          <Text style={styles.muted}>Capillary reading: {timeline.latestGlucose?.compartment === "capillary-blood" ? "yes" : "no"}</Text>
          <Text style={styles.muted}>Cloud and physiological delay are labeled separately.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Manual glucose log</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Glucose value mmol/L</Text>
            <TextInput value={inputs.glucoseValue} onChangeText={(value) => setInputs((current) => ({ ...current, glucoseValue: value }))} keyboardType="decimal-pad" style={styles.input} placeholder="7.2" placeholderTextColor="#80918A" />
          </View>
          <View style={styles.rowWrap}>
            {(["capillary-blood", "interstitial-fluid"] as const).map((compartment) => (
              <Pressable key={compartment} accessibilityRole="button" style={inputs.glucoseCompartment === compartment ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, glucoseCompartment: compartment }))}>
                <Text style={inputs.glucoseCompartment === compartment ? styles.pillActiveText : styles.pillText}>{compartment}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowWrap}>
            {(["fasting", "postprandial", "exercise", "random"] as const).map((context) => (
              <Pressable key={context} accessibilityRole="button" style={inputs.glucoseContext === context ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, glucoseContext: context }))}>
                <Text style={inputs.glucoseContext === context ? styles.pillActiveText : styles.pillText}>{context}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Note</Text>
            <TextInput value={inputs.glucoseNote} onChangeText={(value) => setInputs((current) => ({ ...current, glucoseNote: value }))} style={styles.input} placeholder="Optional note" placeholderTextColor="#80918A" />
          </View>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveGlucose}>
            <Text style={styles.primaryButtonText}>Save glucose</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Manual medication log</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Medication name</Text>
            <TextInput value={inputs.medicationName} onChangeText={(value) => setInputs((current) => ({ ...current, medicationName: value }))} style={styles.input} placeholder="Metformin" placeholderTextColor="#80918A" />
          </View>
          <View style={styles.rowWrap}>
            {(["taken", "scheduled", "skipped", "snoozed", "unknown"] as const).map((status) => (
              <Pressable key={status} accessibilityRole="button" style={inputs.medicationStatus === status ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, medicationStatus: status }))}>
                <Text style={inputs.medicationStatus === status ? styles.pillActiveText : styles.pillText}>{status}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Prescribed dose label</Text>
            <TextInput value={inputs.medicationDoseLabel} onChangeText={(value) => setInputs((current) => ({ ...current, medicationDoseLabel: value }))} style={styles.input} placeholder="As prescribed" placeholderTextColor="#80918A" />
          </View>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveMedication}>
              <Text style={styles.primaryButtonText}>Save medication</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleScheduleReminder}>
              <Text style={styles.secondaryButtonText}>Schedule reminder</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>{capability ? capability.exactAlarmNote : "Notification capability is being checked."}</Text>
          <Text style={styles.muted}>Permission: {capability?.granted ? "granted" : "not granted yet"}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Unified timeline</Text>
          {timeline.events.map((event) => (
            <View key={event.id} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{formatTimelineLabel(event)}</Text>
              <Text style={styles.muted}>{event.type} | {event.quality} | {formatDateTime(event.occurredAt)}</Text>
            </View>
          ))}
          {timeline.events.length === 0 ? <Text style={styles.muted}>No local events yet. The screen is using safe mock context until you log data.</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Context snapshot</Text>
          <Text style={styles.bodyText}>Meals: {timeline.counts.meal}, activity: {timeline.counts.exercise}, medication: {timeline.counts.medication}, glucose: {timeline.counts.glucose}</Text>
          <Text style={styles.bodyText}>Current target context: fasting {DEFAULT_CARE_TARGETS.fastingMinMmolL}-{DEFAULT_CARE_TARGETS.fastingMaxMmolL} mmol/L, post-meal under {DEFAULT_CARE_TARGETS.postprandialMaxMmolL} mmol/L.</Text>
          <Text style={styles.muted}>These targets are defaults only and must be clinician reviewed.</Text>
          <Text style={styles.muted}>Last status: {statusMessage}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Demo context</Text>
          <Text style={styles.bodyText}>Mock meal estimate: {mockMealVision().carbohydrateRangeGrams?.min}-{mockMealVision().carbohydrateRangeGrams?.max} g carbohydrate.</Text>
          <Text style={styles.bodyText}>Mock exercise: {mockImuExercise().activity}, {mockImuExercise().durationMinutes} min, {mockImuExercise().intensity}.</Text>
          <Text style={styles.muted}>These examples are local-only placeholders for Phase 1 testing.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Safety reminder</Text>
          <Text style={styles.bodyText}>If readings or symptoms are worrying, use your agreed care plan and local urgent care pathways rather than relying on this app alone.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const colors = {
  page: "#F4F7F3",
  card: "#FFFFFF",
  text: "#12372A",
  muted: "#5D6F69",
  accent: "#1F6B4D",
  accentSoft: "#DCEEE4",
  border: "#D7E1DB",
  warning: "#8A4B08"
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { padding: 20, gap: 14 },
  kicker: { color: colors.accent, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 32, lineHeight: 36, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  banner: { backgroundColor: colors.accent, borderRadius: 18, padding: 16, gap: 6 },
  bannerTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  bannerText: { color: "#E9F5EE", lineHeight: 20 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 18 },
  bodyText: { color: colors.text, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  metric: { color: colors.text, fontSize: 24, fontWeight: "800" },
  label: { color: colors.text, fontWeight: "700" },
  fieldGroup: { gap: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: "#FBFCFB" },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  rowWrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  primaryButton: { backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, minHeight: 44, justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "800" },
  secondaryButton: { backgroundColor: colors.accentSoft, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, minHeight: 44, justifyContent: "center" },
  secondaryButtonText: { color: colors.accent, fontWeight: "800" },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#FBFCFB" },
  pillActive: { borderWidth: 1, borderColor: colors.accent, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.accentSoft },
  pillText: { color: colors.muted, fontWeight: "700" },
  pillActiveText: { color: colors.accent, fontWeight: "800" },
  timelineRow: { gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  timelineLabel: { color: colors.text, fontWeight: "700" }
});
