import { useEffect, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { DEFAULT_CARE_TARGETS, type GlucoseContext } from "../../packages/shared/src/clinical";
import { buildClinicianReviewSummary, formatClinicianReviewSummary } from "../../packages/shared/src/glucose-review";
import { createMedicationPlan, describeMedicationPlanStatus, medicationPlanNeedsReschedule, type MedicationPlan } from "../../packages/shared/src/medication-plans";
import { createDefaultUserProfile, type UserProfile } from "../../packages/shared/src/profile";
import { createMockShelfAnalysis, formatShelfAnalysisSummary } from "../../packages/shared/src/shelf-analysis";
import { addGlucoseEntry, addMedicationEntry, acceptConsent, deleteShelfThread, getOrCreateUserProfile, listHealthEvents, listMedicationPlans, listShelfThreads, openLocalStore, saveMedicationPlan, saveShelfThread, saveUserProfile, type ShelfThreadRecord } from "./src/storage";
import { getMedicationNotificationCapability, reconcileMedicationReminders, syncMedicationReminderWithOptions } from "./src/reminders";
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
  const [plans, setPlans] = useState<MedicationPlan[]>([]);
  const [shelfThreads, setShelfThreads] = useState<ShelfThreadRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState("Loading local data...");
  const [capability, setCapability] = useState<{ granted: boolean; canSchedule: boolean; exactAlarmNote: string } | null>(null);
  const [reviewContext, setReviewContext] = useState<GlucoseContext>("postprandial");
  const [reviewExport, setReviewExport] = useState("");
  const [shelfCaption, setShelfCaption] = useState("");
  const [inputs, setInputs] = useState<InputState>(initialInputs);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openLocalStore();
        const loadedProfile = await getOrCreateUserProfile(db, "Pacific/Auckland");
        const loadedEvents = await listHealthEvents(db, 200);
        const loadedPlans = await listMedicationPlans(db);
        const loadedShelfThreads = await listShelfThreads(db, 50);
        const notificationCapability = await getMedicationNotificationCapability();
        const reconciledPlans = await reconcileMedicationReminders(loadedPlans, loadedProfile.timezone, notificationCapability.granted, false);

        for (const plan of reconciledPlans.plans) {
          await saveMedicationPlan(db, plan);
        }

        if (cancelled) return;
        setProfile(loadedProfile);
        setEvents(loadedEvents);
        setPlans(reconciledPlans.plans);
        setShelfThreads(loadedShelfThreads);
        setCapability(notificationCapability);
        setStatusMessage(reconciledPlans.issues.length > 0 ? reconciledPlans.issues[0] : "Local profile, timeline, and reminder plans loaded.");
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

  async function refreshMedicationPlans() {
    if (!profile) return;
    const db = await openLocalStore();
    const loadedPlans = await listMedicationPlans(db);
    const reconciledPlans = await reconcileMedicationReminders(loadedPlans, profile.timezone, capability?.granted ?? false, false);
    for (const plan of reconciledPlans.plans) {
      await saveMedicationPlan(db, plan);
    }
    setPlans(reconciledPlans.plans);
    if (reconciledPlans.issues.length > 0) {
      setStatusMessage(reconciledPlans.issues[0]);
    }
  }

  async function refreshShelfThreads() {
    const db = await openLocalStore();
    setShelfThreads(await listShelfThreads(db, 50));
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

  async function handleSaveReminderPlan() {
    const hour = Number.parseInt(inputs.reminderHour, 10);
    const minute = Number.parseInt(inputs.reminderMinute, 10);
    if (!inputs.medicationName.trim()) {
      setStatusMessage("Enter the medication name before saving a reminder plan.");
      return;
    }
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      setStatusMessage("Enter a valid reminder time.");
      return;
    }
    if (!profile) return;
    try {
      const plan = createMedicationPlan({
        id: createHealthEventId("plan"),
        userId: profile.id,
        medicationName: inputs.medicationName.trim(),
        reminderHour: hour,
        reminderMinute: minute,
        timezone: profile.timezone
      });
      const syncedPlan = await syncMedicationReminderWithOptions(plan, profile.timezone, { promptForPermission: true });
      const db = await openLocalStore();
      await saveMedicationPlan(db, syncedPlan);
      setPlans((current) => [syncedPlan, ...current.filter((item) => item.id !== syncedPlan.id)]);
      setStatusMessage("Medication reminder plan saved and synced.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save reminder plan.");
    }
  }

  function handleGenerateReviewExport() {
    const exportText = formatClinicianReviewSummary(clinicianReview);
    setReviewExport(exportText);
    setStatusMessage("Clinician review summary generated locally.");
  }

  async function handleCaptureShelfPhoto() {
    if (!profile || profile.consentState !== "accepted") {
      setStatusMessage("Accept consent before capturing shelf photos.");
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setStatusMessage("Camera permission is required for shelf photo capture.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.75,
      allowsEditing: false
    });

    if (result.canceled || result.assets.length === 0) {
      setStatusMessage("Shelf photo capture canceled.");
      return;
    }

    const asset = result.assets[0];
    const db = await openLocalStore();
    const thread: ShelfThreadRecord = {
      id: createHealthEventId("shelf"),
      createdAt: new Date().toISOString(),
      localImageUri: asset.uri,
      caption: shelfCaption.trim() || undefined,
      status: "queued"
    };
    await saveShelfThread(db, thread);
    await refreshShelfThreads();
    setShelfCaption("");
    setStatusMessage("Shelf photo queued locally.");
  }

  async function handleAnalyzeShelfThread(thread: ShelfThreadRecord) {
    const analysis = createMockShelfAnalysis({ caption: thread.caption, photoUri: thread.localImageUri });
    const updatedThread: ShelfThreadRecord = { ...thread, status: "analyzed", analysis };
    const db = await openLocalStore();
    await saveShelfThread(db, updatedThread);
    await refreshShelfThreads();
    setStatusMessage("Mock shelf analysis saved locally.");
  }

  async function handleDeleteShelfThread(threadId: string) {
    const db = await openLocalStore();
    await deleteShelfThread(db, threadId);
    await refreshShelfThreads();
    setStatusMessage("Shelf thread deleted locally.");
  }

  const timeline = events.length > 0 ? dbState : summarizeTimeline(fallbackEvents);
  const latestGlucoseCard = timeline.latestGlucose ? safeGlucoseDisplay(timeline.latestGlucose) : glucoseDisplay;
  const clinicianReview = useMemo(() => buildClinicianReviewSummary(timeline.events, reviewContext, DEFAULT_CARE_TARGETS), [reviewContext, timeline.events]);
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
          <Text style={styles.cardTitle}>Glucose trend and targets</Text>
          <View style={styles.rowWrap}>
            {(["fasting", "postprandial"] as const).map((context) => (
              <Pressable key={context} accessibilityRole="button" style={reviewContext === context ? styles.pillActive : styles.pill} onPress={() => setReviewContext(context)}>
                <Text style={reviewContext === context ? styles.pillActiveText : styles.pillText}>{context}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.bodyText}>{clinicianReview.glucoseTrend.message}</Text>
          <Text style={styles.muted}>{clinicianReview.glucoseTrend.safetyNote}</Text>
          <Text style={styles.muted}>{clinicianReview.targetReview.message}</Text>
          <Text style={styles.muted}>Target context is clinician-reviewable and should stay configurable.</Text>
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
            <View style={styles.flexOne}>
              <Text style={styles.label}>Reminder hour</Text>
              <TextInput value={inputs.reminderHour} onChangeText={(value) => setInputs((current) => ({ ...current, reminderHour: value }))} keyboardType="number-pad" style={styles.input} placeholder="8" placeholderTextColor="#80918A" />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Reminder minute</Text>
              <TextInput value={inputs.reminderMinute} onChangeText={(value) => setInputs((current) => ({ ...current, reminderMinute: value }))} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor="#80918A" />
            </View>
          </View>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveMedication}>
              <Text style={styles.primaryButtonText}>Save medication</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleSaveReminderPlan}>
              <Text style={styles.secondaryButtonText}>Save reminder plan</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={refreshMedicationPlans}>
              <Text style={styles.secondaryButtonText}>Resync reminders</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>{capability ? capability.exactAlarmNote : "Notification capability is being checked."}</Text>
          <Text style={styles.muted}>Permission: {capability?.granted ? "granted" : "not granted yet"}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Reminder plans</Text>
          {plans.length > 0 ? plans.map((plan) => (
            <View key={plan.id} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{plan.medicationName} at {plan.reminderHour.toString().padStart(2, "0")}:{plan.reminderMinute.toString().padStart(2, "0")}</Text>
              <Text style={styles.muted}>{describeMedicationPlanStatus(plan, profile?.timezone ?? plan.timezone)}</Text>
              <Text style={styles.muted}>Needs sync: {medicationPlanNeedsReschedule(plan, profile?.timezone ?? plan.timezone) ? "yes" : "no"} | status: {plan.scheduleStatus}</Text>
            </View>
          )) : <Text style={styles.muted}>No reminder plans saved yet.</Text>}
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
          <Text style={styles.cardTitle}>Clinician review export</Text>
          <Text style={styles.bodyText}>Generate a plain-text snapshot for pattern review. It stays local unless you copy or share it yourself.</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleGenerateReviewExport}>
              <Text style={styles.primaryButtonText}>Generate export</Text>
            </Pressable>
          </View>
          <TextInput
            value={reviewExport || formatClinicianReviewSummary(clinicianReview)}
            editable={false}
            multiline
            style={styles.exportBox}
            placeholderTextColor="#80918A"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Shelf photo queue</Text>
          <Text style={styles.bodyText}>Capture a shelf photo, keep it local, and attach a validated mock analysis only when you choose.</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Caption</Text>
            <TextInput
              value={shelfCaption}
              onChangeText={setShelfCaption}
              style={styles.input}
              placeholder="Optional shelf note"
              placeholderTextColor="#80918A"
            />
          </View>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleCaptureShelfPhoto}>
              <Text style={styles.primaryButtonText}>Capture shelf photo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={refreshShelfThreads}>
              <Text style={styles.secondaryButtonText}>Refresh queue</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>Photos stay local unless you choose to move them elsewhere. The mock analysis is validated before display.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Shelf history</Text>
          {shelfThreads.length > 0 ? shelfThreads.map((thread) => (
            <View key={thread.id} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{thread.caption || "Queued shelf photo"}</Text>
              <Text style={styles.muted}>{thread.status} | {formatDateTime(thread.createdAt)}</Text>
              <Text style={styles.muted}>Local image: {thread.localImageUri}</Text>
              {thread.analysis ? <Text style={styles.muted}>{formatShelfAnalysisSummary(thread.analysis)}</Text> : <Text style={styles.muted}>No analysis yet. The photo remains in the local queue.</Text>}
              <View style={styles.row}>
                {thread.status !== "analyzed" ? (
                  <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleAnalyzeShelfThread(thread)}>
                    <Text style={styles.secondaryButtonText}>Generate mock analysis</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleDeleteShelfThread(thread.id)}>
                  <Text style={styles.secondaryButtonText}>Delete thread</Text>
                </Pressable>
              </View>
            </View>
          )) : <Text style={styles.muted}>No shelf photos queued yet.</Text>}
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
  exportBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, backgroundColor: "#FBFCFB", minHeight: 180, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  rowWrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  flexOne: { flex: 1, minWidth: 120 },
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
