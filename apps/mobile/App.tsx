import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Linking, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { CareTargetsSchema, DEFAULT_CARE_TARGETS, type CareTargets, type GlucoseContext } from "../../packages/shared/src/clinical";
import { buildClinicianReviewSummary, formatClinicianReviewSummary } from "../../packages/shared/src/glucose-review";
import { createMedicationPlan, describeMedicationPlanStatus, describeUnreadableMedicationPlans, medicationPlanNeedsReschedule, type MedicationPlan, type UnreadablePlanRef } from "../../packages/shared/src/medication-plans";
import { markConsentRevoked, type UserProfile } from "../../packages/shared/src/profile";
import { createMockShelfAnalysis, formatShelfAnalysisSummary } from "../../packages/shared/src/shelf-analysis";
import { addGlucoseEntry, addMedicationEntry, acceptConsent, deleteAllLocalRecords, deleteMedicationPlan, deleteShelfThread, deleteWellbeingCheckIn, getCareTargets, getOrCreateUserProfile, getWellnessGoals, listHealthEvents, listMedicationPlans, listShelfThreads, listWellbeingCheckIns, openLocalStore, replaceHealthEvents, saveCareTargets, saveHealthEvent, saveMedicationPlan, saveShelfThread, saveUserProfile, saveWellbeingCheckIn, saveWellnessGoals, type ShelfThreadRecord } from "./src/storage";
import { clearLocalServerSettings, getLocalServerSettings, saveLocalServerSettings, type LocalServerSettingsRecord } from "./src/local-server-storage";
import { normalizeLocalServerBaseUrl, sendShelfAnalysisToLocalServer, testLocalServerConnection } from "./src/local-server";
import { cancelAllMedicationReminders, cancelMedicationReminder, cancelRemindersForUnreadablePlans, configureMedicationNotifications, getMedicationNotificationCapability, MEDICATION_ACTION_SKIPPED, MEDICATION_ACTION_SNOOZE, MEDICATION_ACTION_TAKEN, reconcileMedicationReminders, scheduleMedicationSnooze, syncMedicationReminderWithOptions } from "./src/reminders";
import { formatTimelineLabel, summarizeTimeline } from "../../packages/shared/src/timeline";
import { normalizeHealthEvent, safeGlucoseDisplay, type ExerciseCategory, type ExerciseEvent, type GlucoseCompartment, type HealthEvent, type MedicationEvent } from "../../packages/shared/src/health-events";
import { buildEncouragement, createDefaultWellnessGoals, GUIDELINE_SOURCES, pickDailyTip, REGULAR_CHECKS, SEEK_HELP_SIGNS, suggestTipsForWeek, summarizeWeeklyActivity, WellnessGoalsSchema, type WellnessGoals } from "../../packages/shared/src/coaching";
import { formatCheckInLabel, parseWellbeingCheckIn, reviewWellbeing, type MoodLevel, type StressLevel, type WellbeingCheckIn } from "../../packages/shared/src/wellbeing";
import { BLE_GLUCOSE_MEASUREMENT_CHARACTERISTIC_UUID, BLE_GLUCOSE_SERVICE_UUID, createMockBleGattReading, createMockCloudSync, createMockImuExercise, createMockIntegrationBatch, createMockMealRecognition } from "../../packages/shared/src/mocks";
import { synchronizeHealthEvents } from "../../packages/shared/src/synchronization";
import { deleteOwnedShelfPhoto, persistShelfPhoto, readShelfPhotoDataUrl } from "./src/shelf-files";

type AppTab = "home" | "log" | "coach" | "timeline" | "reminders" | "devices" | "shelf" | "settings";

type InputState = {
  glucoseValue: string;
  glucoseContext: "fasting" | "postprandial" | "exercise" | "random";
  glucoseCompartment: GlucoseCompartment;
  glucoseNote: string;
  medicationName: string;
  medicationStatus: MedicationEvent["status"];
  medicationDoseLabel: string;
  reminderMedicationName: string;
  reminderHour: string;
  reminderMinute: string;
  mealDescription: string;
  mealCarbMin: string;
  mealCarbMax: string;
  mealConfidencePercent: string;
  exerciseActivity: string;
  exerciseDuration: string;
  exerciseIntensity: ExerciseEvent["intensity"];
  exerciseCategory: ExerciseCategory | "";
  checkInSleep: string;
  checkInMood: MoodLevel | "";
  checkInStress: StressLevel | "";
  checkInWater: string;
  checkInFootCheck: boolean;
  checkInNotes: string;
};

type GoalInputs = { weeklyActiveMinutes: string; resistanceDaysPerWeek: string };

const QUICK_ACTIVITIES: readonly { label: string; category: ExerciseCategory }[] = [
  { label: "Walking", category: "aerobic" },
  { label: "Cycling", category: "aerobic" },
  { label: "Swimming", category: "aerobic" },
  { label: "Strength", category: "resistance" },
  { label: "Gardening", category: "everyday" },
  { label: "Housework", category: "everyday" },
  { label: "Yoga or stretching", category: "flexibility" },
  { label: "Tai chi or balance", category: "balance" }
];

const initialInputs: InputState = {
  glucoseValue: "",
  glucoseContext: "random",
  glucoseCompartment: "capillary-blood",
  glucoseNote: "",
  medicationName: "",
  medicationStatus: "taken",
  medicationDoseLabel: "",
  reminderMedicationName: "",
  reminderHour: "8",
  reminderMinute: "0",
  mealDescription: "",
  mealCarbMin: "",
  mealCarbMax: "",
  mealConfidencePercent: "70",
  exerciseActivity: "",
  exerciseDuration: "",
  exerciseIntensity: "moderate",
  exerciseCategory: "",
  checkInSleep: "",
  checkInMood: "",
  checkInStress: "",
  checkInWater: "",
  checkInFootCheck: false,
  checkInNotes: ""
};

type TargetInputs = {
  fastingMin: string;
  fastingMax: string;
  postprandialMax: string;
  hba1cMax: string;
};

function toTargetInputs(targets: CareTargets): TargetInputs {
  return {
    fastingMin: targets.fastingMinMmolL.toString(),
    fastingMax: targets.fastingMaxMmolL.toString(),
    postprandialMax: targets.postprandialMaxMmolL.toString(),
    hba1cMax: targets.hba1cMaxMmolMol.toString()
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short"
  }).format(new Date(value));
}

function createHealthEventId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [careTargets, setCareTargets] = useState<CareTargets>(DEFAULT_CARE_TARGETS);
  const [targetInputs, setTargetInputs] = useState<TargetInputs>(() => toTargetInputs(DEFAULT_CARE_TARGETS));
  const [displayName, setDisplayName] = useState("");
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [plans, setPlans] = useState<MedicationPlan[]>([]);
  const [unreadableEventCount, setUnreadableEventCount] = useState(0);
  const [unreadablePlans, setUnreadablePlans] = useState<UnreadablePlanRef[]>([]);
  const unreadablePlanCount = unreadablePlans.length;
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [shelfThreads, setShelfThreads] = useState<ShelfThreadRecord[]>([]);
  const [syncIssues, setSyncIssues] = useState<string[]>([]);
  const [lastMockBatch, setLastMockBatch] = useState<HealthEvent[]>([]);
  const [statusMessage, setStatusMessage] = useState("Loading local data...");
  const [capability, setCapability] = useState<Awaited<ReturnType<typeof getMedicationNotificationCapability>> | null>(null);
  const [reviewContext, setReviewContext] = useState<GlucoseContext>("postprandial");
  const [reviewExport, setReviewExport] = useState("");
  const [shelfCaption, setShelfCaption] = useState("");
  const [serverSettings, setServerSettings] = useState<LocalServerSettingsRecord>({
    baseUrl: "",
    apiKey: "",
    preferredMode: "mock"
  });
  const [inputs, setInputs] = useState<InputState>(initialInputs);
  const [checkIns, setCheckIns] = useState<WellbeingCheckIn[]>([]);
  const [unreadableCheckInCount, setUnreadableCheckInCount] = useState(0);
  const [goals, setGoals] = useState<WellnessGoals>(() => WellnessGoalsSchema.parse({ weeklyActiveMinutes: 150, resistanceDaysPerWeek: 2, dailyCheckIn: true, updatedAt: new Date().toISOString() }));
  const [goalInputs, setGoalInputs] = useState<GoalInputs>({ weeklyActiveMinutes: "150", resistanceDaysPerWeek: "2" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openLocalStore();
        const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Pacific/Auckland";
        const storedProfile = await getOrCreateUserProfile(db, deviceTimezone);
        const loadedProfile = storedProfile.timezone === deviceTimezone
          ? storedProfile
          : { ...storedProfile, timezone: deviceTimezone, updatedAt: new Date().toISOString() };
        if (loadedProfile !== storedProfile) await saveUserProfile(db, loadedProfile);
        const loadedCareTargets = await getCareTargets(db);
        const loadedEvents = await listHealthEvents(db, 200);
        const { plans: loadedPlans, unreadablePlans: loadedUnreadablePlans } = await listMedicationPlans(db);
        const loadedShelfThreads = await listShelfThreads(db, 50);
        const loadedServerSettings = await getLocalServerSettings(db);
        const loadedCheckIns = await listWellbeingCheckIns(db, 60);
        const loadedGoals = await getWellnessGoals(db);
        try {
          await configureMedicationNotifications();
        } catch {
          // Core logging remains available when notification categories are unavailable.
        }
        const notificationCapability = await getMedicationNotificationCapability();
        const reconciledPlans = await reconcileMedicationReminders(loadedPlans, loadedProfile.timezone, notificationCapability.granted, false);

        for (const plan of reconciledPlans.plans) {
          await saveMedicationPlan(db, plan);
        }

        if (cancelled) return;
        setProfile(loadedProfile);
        setDisplayName(loadedProfile.displayName ?? "");
        setCareTargets(loadedCareTargets);
        setTargetInputs(toTargetInputs(loadedCareTargets));
        setEvents(loadedEvents.events);
        setUnreadableEventCount(loadedEvents.unreadableCount);
        setPlans(reconciledPlans.plans);
        setUnreadablePlans(loadedUnreadablePlans);
        setShelfThreads(loadedShelfThreads);
        setCheckIns(loadedCheckIns.checkIns);
        setUnreadableCheckInCount(loadedCheckIns.unreadableCount);
        setGoals(loadedGoals);
        setGoalInputs({ weeklyActiveMinutes: String(loadedGoals.weeklyActiveMinutes), resistanceDaysPerWeek: String(loadedGoals.resistanceDaysPerWeek) });
        if (loadedServerSettings) setServerSettings(loadedServerSettings);
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

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const processResponse = (response: Notifications.NotificationResponse) => {
      void handleMedicationNotificationResponse(response, profile);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(processResponse);
    try {
      const lastResponse = Notifications.getLastNotificationResponse();
      if (lastResponse) {
        processResponse(lastResponse);
        Notifications.clearLastNotificationResponse();
      }
    } catch {
      // Some development environments do not expose a native response cache.
    }
    return () => subscription.remove();
  }, [profile?.consentState, profile?.id, profile?.timezone]);

  const dbState = useMemo(() => summarizeTimeline(events, new Date(clock), unreadableEventCount), [clock, events, unreadableEventCount]);
  const consentAccepted = profile?.consentState === "accepted";

  function requireConsent() {
    if (consentAccepted) return true;
    setStatusMessage("Accept consent before saving health or photo data.");
    setActiveTab("settings");
    return false;
  }

  async function handleMedicationNotificationResponse(response: Notifications.NotificationResponse, currentProfile: UserProfile) {
    const data = response.notification.request.content.data ?? {};
    if (data.kind !== "medication-reminder") return;
    setActiveTab("reminders");
    const action = response.actionIdentifier;
    if (![MEDICATION_ACTION_TAKEN, MEDICATION_ACTION_SNOOZE, MEDICATION_ACTION_SKIPPED].includes(action)) {
      setStatusMessage("Medication reminder opened. Choose an acknowledgement only if it reflects what happened.");
      return;
    }
    if (currentProfile.consentState !== "accepted") {
      setStatusMessage("Consent is not active, so the reminder response was not saved.");
      return;
    }
    const medicationName = typeof data.medicationName === "string" && data.medicationName.trim()
      ? data.medicationName.trim()
      : "Medication plan";
    const planId = typeof data.planId === "string" ? data.planId : undefined;
    const status: MedicationEvent["status"] = action === MEDICATION_ACTION_TAKEN
      ? "taken"
      : action === MEDICATION_ACTION_SKIPPED
        ? "skipped"
        : "snoozed";
    const now = new Date().toISOString();
    const candidate = normalizeHealthEvent({
      id: `reminder-response-${response.notification.request.identifier}-${action}-${response.notification.date}`,
      userId: currentProfile.id,
      type: "medication",
      source: "medication-plan",
      occurredAt: now,
      receivedAt: now,
      timezone: currentProfile.timezone,
      confidence: 1,
      quality: "valid",
      medicationName,
      status,
      notes: "Acknowledged from a local medication reminder."
    });
    if (!candidate.event || candidate.event.type !== "medication") {
      setStatusMessage("The reminder response could not be validated and was not saved.");
      return;
    }
    const db = await openLocalStore();
    await addMedicationEntry(db, candidate.event);
    let snoozeScheduled = true;
    if (action === MEDICATION_ACTION_SNOOZE) {
      try {
        await scheduleMedicationSnooze(medicationName, planId);
      } catch {
        snoozeScheduled = false;
      }
    }
    await refreshTimeline();
    setStatusMessage(action === MEDICATION_ACTION_SNOOZE
      ? snoozeScheduled
        ? "Snooze recorded and a best-effort reminder scheduled for 10 minutes."
        : "Snooze recorded, but the follow-up reminder could not be scheduled."
      : `Medication response recorded as ${status}.`);
  }

  async function refreshTimeline() {
    const db = await openLocalStore();
    const loaded = await listHealthEvents(db, 200);
    setEvents(loaded.events);
    setUnreadableEventCount(loaded.unreadableCount);
  }

  async function refreshMedicationPlans(promptForPermission = false) {
    if (!profile) return;
    const db = await openLocalStore();
    const { plans: loadedPlans, unreadablePlans: loadedUnreadablePlans } = await listMedicationPlans(db);
    setUnreadablePlans(loadedUnreadablePlans);
    const currentCapability = await getMedicationNotificationCapability();
    const reconciledPlans = await reconcileMedicationReminders(loadedPlans, profile.timezone, currentCapability.granted, promptForPermission);
    for (const plan of reconciledPlans.plans) {
      await saveMedicationPlan(db, plan);
    }
    setCapability(await getMedicationNotificationCapability());
    setPlans(reconciledPlans.plans);
    if (reconciledPlans.issues.length > 0) {
      setStatusMessage(reconciledPlans.issues[0]);
    }
  }

  async function refreshShelfThreads() {
    const db = await openLocalStore();
    setShelfThreads(await listShelfThreads(db, 50));
  }

  async function handleSaveServerSettings() {
    if (!serverSettings.baseUrl.trim()) {
      setStatusMessage("Enter a local server URL before saving settings.");
      return;
    }
    if (!serverSettings.apiKey.trim()) {
      setStatusMessage("Enter the local server token before saving settings.");
      return;
    }
    try {
      const normalizedBaseUrl = normalizeLocalServerBaseUrl(serverSettings.baseUrl);
      const db = await openLocalStore();
      const nextSettings: LocalServerSettingsRecord = {
        baseUrl: normalizedBaseUrl,
        apiKey: serverSettings.apiKey.trim(),
        preferredMode: serverSettings.preferredMode
      };
      await saveLocalServerSettings(db, nextSettings);
      setServerSettings(nextSettings);
      setStatusMessage("Local server settings saved. The token is stored in the device secure store.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Local server settings could not be saved.");
    }
  }

  async function handleTestServerConnection() {
    try {
      const baseUrl = normalizeLocalServerBaseUrl(serverSettings.baseUrl);
      if (!serverSettings.apiKey.trim()) throw new Error("Enter the local server token before testing.");
      await testLocalServerConnection({ baseUrl, apiKey: serverSettings.apiKey.trim() });
      setStatusMessage("Local server connection and token verified with a schema-valid mock response.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Local server connection test failed.");
    }
  }

  async function handleClearServerSettings() {
    const db = await openLocalStore();
    await clearLocalServerSettings(db);
    setServerSettings({ baseUrl: "", apiKey: "", preferredMode: "mock" });
    setStatusMessage("Local server URL and secure token were cleared from this device.");
  }

  function handleConfirmDeleteAllData() {
    Alert.alert(
      "Delete all local app data?",
      "This permanently removes the profile, consent record, health timeline, target context, reminder plans, shelf photos, analysis history, and local-server settings from this device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete all data", style: "destructive", onPress: () => void handleDeleteAllData() }
      ]
    );
  }

  async function handleDeleteAllData() {
    try {
      await cancelAllMedicationReminders();
      for (const thread of shelfThreads) deleteOwnedShelfPhoto(thread.localImageUri);
      const db = await openLocalStore();
      await deleteAllLocalRecords(db);
      await clearLocalServerSettings(db);
      const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Pacific/Auckland";
      const freshProfile = await getOrCreateUserProfile(db, deviceTimezone);
      setProfile(freshProfile);
      setDisplayName("");
      setEvents([]);
      setUnreadableEventCount(0);
      setPlans([]);
      setUnreadablePlans([]);
      setShelfThreads([]);
      setCheckIns([]);
      setUnreadableCheckInCount(0);
      const defaultGoals = createDefaultWellnessGoals();
      setGoals(defaultGoals);
      setGoalInputs({ weeklyActiveMinutes: String(defaultGoals.weeklyActiveMinutes), resistanceDaysPerWeek: String(defaultGoals.resistanceDaysPerWeek) });
      setCareTargets(DEFAULT_CARE_TARGETS);
      setTargetInputs(toTargetInputs(DEFAULT_CARE_TARGETS));
      setServerSettings({ baseUrl: "", apiKey: "", preferredMode: "mock" });
      setInputs(initialInputs);
      setEditingPlanId(null);
      setReviewExport("");
      setSyncIssues([]);
      setLastMockBatch([]);
      setStatusMessage("All app-owned local records, schedules, photos, and secure server settings were deleted.");
    } catch {
      setStatusMessage("Deletion could not be completed. Database records were kept, though some schedules or photos may already have been removed. Check device storage and notification settings, then retry.");
    }
  }

  function confirmRemoveUnreadablePlans() {
    Alert.alert(
      "Remove unreadable reminder plans?",
      `This cancels device reminders that belong to the ${unreadablePlanCount} reminder ${unreadablePlanCount === 1 ? "plan" : "plans"} the app can no longer read, then removes ${unreadablePlanCount === 1 ? "it" : "them"} from this device. Reminders you can see in the list are not changed.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove unreadable plans", style: "destructive", onPress: () => void handleRemoveUnreadablePlans() }
      ]
    );
  }

  async function handleRemoveUnreadablePlans() {
    const result = await cancelRemindersForUnreadablePlans(plans, unreadablePlans);
    if (result.failed > 0) {
      setStatusMessage(`${result.failed} device ${result.failed === 1 ? "reminder" : "reminders"} could not be cancelled. The unreadable plans were kept so you can retry, or turn off notifications for this app in device settings.`);
      return;
    }
    try {
      const db = await openLocalStore();
      for (const plan of unreadablePlans) await deleteMedicationPlan(db, plan.id);
      await refreshMedicationPlans();
    } catch {
      setStatusMessage("Their device reminders were cancelled, but the unreadable plans could not be removed from local storage. Retry, or use full local deletion.");
      return;
    }
    setStatusMessage(result.verified
      ? `Removed ${unreadablePlanCount} unreadable reminder ${unreadablePlanCount === 1 ? "plan" : "plans"} and cancelled ${result.cancelled} device ${result.cancelled === 1 ? "reminder" : "reminders"}.`
      : `Removed ${unreadablePlanCount} unreadable reminder ${unreadablePlanCount === 1 ? "plan" : "plans"}, but the device scheduler could not be checked for snoozed reminders. If an unexpected reminder still appears, turn off notifications for this app in device settings.`);
  }

  async function handleAcceptConsent() {
    if (!profile) return;
    const db = await openLocalStore();
    const accepted = await acceptConsent(db, profile);
    setProfile(accepted);
    setStatusMessage("Consent recorded locally.");
  }

  async function handleRevokeConsent() {
    if (!profile) return;
    const nextProfile = markConsentRevoked(profile);
    const db = await openLocalStore();
    const disabledPlans: MedicationPlan[] = [];
    let cancellationFailed = false;
    for (const plan of plans) {
      let disabled: MedicationPlan;
      try {
        disabled = await syncMedicationReminderWithOptions(
          { ...plan, enabled: false, scheduleStatus: "disabled", updatedAt: new Date().toISOString() },
          profile.timezone,
          { promptForPermission: false, permissionGranted: capability?.granted }
        );
      } catch {
        cancellationFailed = true;
        disabled = { ...plan, enabled: false, scheduleStatus: "failed", updatedAt: new Date().toISOString() };
      }
      await saveMedicationPlan(db, disabled);
      disabledPlans.push(disabled);
    }
    await saveUserProfile(db, nextProfile);
    setProfile(nextProfile);
    setPlans(disabledPlans);
    setStatusMessage(cancellationFailed
      ? "Consent revoked and new logging disabled. At least one native reminder could not be confirmed canceled; check device notification settings."
      : "Consent revoked. New health and photo logging is disabled and reminder schedules were canceled.");
  }

  async function handleSaveProfile() {
    if (!profile) return;
    const nextProfile = {
      ...profile,
      displayName: displayName.trim() || undefined,
      updatedAt: new Date().toISOString()
    };
    const db = await openLocalStore();
    await saveUserProfile(db, nextProfile);
    setProfile(nextProfile);
    setStatusMessage("Profile saved locally.");
  }

  async function handleSaveTargets() {
    const parsed = CareTargetsSchema.safeParse({
      fastingMinMmolL: Number.parseFloat(targetInputs.fastingMin),
      fastingMaxMmolL: Number.parseFloat(targetInputs.fastingMax),
      postprandialMaxMmolL: Number.parseFloat(targetInputs.postprandialMax),
      hba1cMaxMmolMol: Number.parseFloat(targetInputs.hba1cMax),
      clinicianReviewed: careTargets.clinicianReviewed
    });
    if (!parsed.success) {
      setStatusMessage(parsed.error.issues[0]?.message ?? "Enter valid care-target values.");
      return;
    }
    const db = await openLocalStore();
    await saveCareTargets(db, parsed.data);
    setCareTargets(parsed.data);
    setStatusMessage("Target context saved locally. It remains coaching context, not a treatment plan.");
  }

  async function handleSaveGlucose() {
    if (!profile || !requireConsent()) return;
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
    const parsed = normalizeHealthEvent(candidate);
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
    if (!profile || !requireConsent()) return;
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
    const parsed = normalizeHealthEvent(candidate);
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

  async function handleSaveMeal() {
    if (!profile || !requireConsent()) return;
    if (!inputs.mealDescription.trim()) {
      setStatusMessage("Enter a meal description.");
      return;
    }
    const carbMin = inputs.mealCarbMin.trim() ? Number.parseFloat(inputs.mealCarbMin) : undefined;
    const carbMax = inputs.mealCarbMax.trim() ? Number.parseFloat(inputs.mealCarbMax) : undefined;
    if ((carbMin === undefined) !== (carbMax === undefined)) {
      setStatusMessage("Enter both ends of the carbohydrate estimate, or leave both blank.");
      return;
    }
    const confidencePercent = Number.parseFloat(inputs.mealConfidencePercent);
    const now = new Date().toISOString();
    const parsed = normalizeHealthEvent({
      id: createHealthEventId("meal"),
      userId: profile.id,
      type: "meal",
      source: "manual",
      occurredAt: now,
      receivedAt: now,
      timezone: profile.timezone,
      confidence: Number.isFinite(confidencePercent) ? Math.min(100, Math.max(0, confidencePercent)) / 100 : 1,
      quality: carbMin === undefined ? "valid" : "estimated",
      description: inputs.mealDescription.trim(),
      carbohydrateRangeGrams: carbMin !== undefined && carbMax !== undefined ? { min: carbMin, max: carbMax } : undefined,
      portionConfidence: carbMin === undefined ? undefined : Number.isFinite(confidencePercent) ? Math.min(100, Math.max(0, confidencePercent)) / 100 : undefined
    });
    if (!parsed.event || parsed.event.type !== "meal") {
      setStatusMessage(parsed.issues[0]?.message ?? "Unable to save the meal.");
      return;
    }
    const db = await openLocalStore();
    await saveHealthEvent(db, parsed.event);
    setInputs((current) => ({ ...current, mealDescription: "", mealCarbMin: "", mealCarbMax: "" }));
    await refreshTimeline();
    setStatusMessage("Meal saved locally. Any carbohydrate values remain labelled as estimates.");
  }

  async function handleSaveExercise() {
    if (!profile || !requireConsent()) return;
    const durationMinutes = Number.parseFloat(inputs.exerciseDuration);
    if (!inputs.exerciseActivity.trim() || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setStatusMessage("Enter an activity and a valid duration in minutes.");
      return;
    }
    const now = new Date().toISOString();
    const parsed = normalizeHealthEvent({
      id: createHealthEventId("exercise"),
      userId: profile.id,
      type: "exercise",
      source: "manual",
      occurredAt: now,
      receivedAt: now,
      timezone: profile.timezone,
      confidence: 1,
      quality: "valid",
      activity: inputs.exerciseActivity.trim(),
      durationMinutes,
      intensity: inputs.exerciseIntensity,
      category: inputs.exerciseCategory || undefined,
      detectedFromImu: false
    });
    if (!parsed.event || parsed.event.type !== "exercise") {
      setStatusMessage(parsed.issues[0]?.message ?? "Unable to save the activity.");
      return;
    }
    const db = await openLocalStore();
    await saveHealthEvent(db, parsed.event);
    setInputs((current) => ({ ...current, exerciseActivity: "", exerciseDuration: "", exerciseCategory: "" }));
    await refreshTimeline();
    setStatusMessage("Activity saved locally. Check the Coach tab to see your week.");
  }

  async function refreshCheckIns() {
    const db = await openLocalStore();
    const loaded = await listWellbeingCheckIns(db, 60);
    setCheckIns(loaded.checkIns);
    setUnreadableCheckInCount(loaded.unreadableCount);
  }

  async function handleSaveCheckIn() {
    if (!profile || !requireConsent()) return;
    const sleepHours = inputs.checkInSleep.trim() === "" ? undefined : Number.parseFloat(inputs.checkInSleep);
    const waterGlasses = inputs.checkInWater.trim() === "" ? undefined : Number.parseInt(inputs.checkInWater, 10);
    if ((sleepHours !== undefined && !Number.isFinite(sleepHours)) || (waterGlasses !== undefined && !Number.isFinite(waterGlasses))) {
      setStatusMessage("Enter sleep hours and water glasses as numbers, or leave them blank.");
      return;
    }
    const now = new Date().toISOString();
    const parsed = parseWellbeingCheckIn({
      id: createHealthEventId("checkin"),
      userId: profile.id,
      occurredAt: now,
      timezone: profile.timezone,
      sleepHours,
      mood: inputs.checkInMood || undefined,
      stress: inputs.checkInStress || undefined,
      waterGlasses,
      footCheckDone: inputs.checkInFootCheck ? true : undefined,
      notes: inputs.checkInNotes.trim() || undefined
    });
    if (!parsed.checkIn) {
      setStatusMessage(parsed.issue ?? "Unable to save the check-in.");
      return;
    }
    const db = await openLocalStore();
    await saveWellbeingCheckIn(db, parsed.checkIn);
    setInputs((current) => ({ ...current, checkInSleep: "", checkInMood: "", checkInStress: "", checkInWater: "", checkInFootCheck: false, checkInNotes: "" }));
    await refreshCheckIns();
    setStatusMessage("Check-in saved locally. Thanks for keeping track.");
  }

  async function handleDeleteCheckIn(checkIn: WellbeingCheckIn) {
    const db = await openLocalStore();
    await deleteWellbeingCheckIn(db, checkIn.id);
    await refreshCheckIns();
    setStatusMessage("Check-in deleted.");
  }

  async function handleSaveGoals() {
    if (!requireConsent()) return;
    const parsed = WellnessGoalsSchema.safeParse({
      weeklyActiveMinutes: Number.parseInt(goalInputs.weeklyActiveMinutes, 10),
      resistanceDaysPerWeek: Number.parseInt(goalInputs.resistanceDaysPerWeek, 10),
      dailyCheckIn: goals.dailyCheckIn,
      updatedAt: new Date().toISOString()
    });
    if (!parsed.success) {
      setStatusMessage("Weekly minutes must be between 10 and 2000 and strength days between 0 and 7.");
      return;
    }
    const db = await openLocalStore();
    await saveWellnessGoals(db, parsed.data);
    setGoals(parsed.data);
    setStatusMessage("Weekly goals saved. Agree any big changes with your care team.");
  }

  async function handleSaveReminderPlan() {
    if (!requireConsent()) return;
    const hour = Number.parseInt(inputs.reminderHour, 10);
    const minute = Number.parseInt(inputs.reminderMinute, 10);
    if (!inputs.reminderMedicationName.trim()) {
      setStatusMessage("Enter the medication name before saving a reminder plan.");
      return;
    }
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      setStatusMessage("Enter a valid reminder time.");
      return;
    }
    if (!profile) return;
    const existingPlan = editingPlanId ? plans.find((plan) => plan.id === editingPlanId) : undefined;
    const plan = existingPlan
      ? {
          ...existingPlan,
          medicationName: inputs.reminderMedicationName.trim(),
          reminderHour: hour,
          reminderMinute: minute,
          timezone: profile.timezone,
          enabled: true,
          scheduleStatus: "stale" as const,
          updatedAt: new Date().toISOString()
        }
      : createMedicationPlan({
          id: createHealthEventId("plan"),
          userId: profile.id,
          medicationName: inputs.reminderMedicationName.trim(),
          reminderHour: hour,
          reminderMinute: minute,
          timezone: profile.timezone
        });
    let savedPlan: MedicationPlan;
    let message = "Medication reminder plan saved and synced.";
    try {
      savedPlan = await syncMedicationReminderWithOptions(plan, profile.timezone, { promptForPermission: true });
    } catch (error) {
      savedPlan = { ...plan, scheduleStatus: "failed", updatedAt: new Date().toISOString() };
      message = error instanceof Error ? `Plan saved, but scheduling failed: ${error.message}` : "Plan saved, but scheduling failed.";
    }
    const db = await openLocalStore();
    await saveMedicationPlan(db, savedPlan);
    setPlans((current) => [savedPlan, ...current.filter((item) => item.id !== savedPlan.id)]);
    setCapability(await getMedicationNotificationCapability());
    setEditingPlanId(null);
    setInputs((current) => ({ ...current, reminderMedicationName: "", reminderHour: "8", reminderMinute: "0" }));
    setStatusMessage(message);
  }

  function handleEditReminderPlan(plan: MedicationPlan) {
    setEditingPlanId(plan.id);
    setInputs((current) => ({
      ...current,
      reminderMedicationName: plan.medicationName,
      reminderHour: plan.reminderHour.toString(),
      reminderMinute: plan.reminderMinute.toString()
    }));
    setActiveTab("reminders");
    setStatusMessage("Editing reminder plan. Saving will replace its native schedule.");
  }

  async function handleToggleReminderPlan(plan: MedicationPlan) {
    if (!profile || (plan.enabled === false && !requireConsent())) return;
    let nextPlan: MedicationPlan = {
      ...plan,
      enabled: !plan.enabled,
      scheduleStatus: plan.enabled ? "disabled" : "stale",
      updatedAt: new Date().toISOString()
    };
    try {
      nextPlan = await syncMedicationReminderWithOptions(nextPlan, profile.timezone, {
        promptForPermission: !plan.enabled,
        permissionGranted: capability?.granted
      });
    } catch (error) {
      nextPlan = { ...nextPlan, scheduleStatus: "failed", updatedAt: new Date().toISOString() };
      setStatusMessage(error instanceof Error ? error.message : "Reminder schedule could not be updated.");
    }
    const db = await openLocalStore();
    await saveMedicationPlan(db, nextPlan);
    setPlans((current) => current.map((item) => item.id === nextPlan.id ? nextPlan : item));
    setCapability(await getMedicationNotificationCapability());
    if (nextPlan.scheduleStatus !== "failed") setStatusMessage(nextPlan.enabled ? "Reminder enabled and reconciled." : "Reminder disabled and canceled on this device.");
  }

  async function handleDeleteReminderPlan(plan: MedicationPlan) {
    try {
      await cancelMedicationReminder(plan.notificationId);
    } catch {
      setStatusMessage("The device could not confirm cancellation, so the plan was kept. Check notification settings and retry.");
      return;
    }
    const db = await openLocalStore();
    await deleteMedicationPlan(db, plan.id);
    setPlans((current) => current.filter((item) => item.id !== plan.id));
    if (editingPlanId === plan.id) setEditingPlanId(null);
    setStatusMessage("Reminder plan and its native schedule were deleted.");
  }

  function handleGenerateReviewExport() {
    const exportText = formatClinicianReviewSummary(clinicianReview);
    setReviewExport(exportText);
    setStatusMessage("Clinician review summary generated locally.");
  }

  async function handleShareReviewExport() {
    const exportText = reviewExport || formatClinicianReviewSummary(clinicianReview);
    await Share.share({ title: "Diabetes coaching clinician review", message: exportText });
  }

  async function handleCall(number: "111" | "0800611116") {
    try {
      await Linking.openURL(`tel:${number}`);
    } catch {
      setStatusMessage(`Unable to open the phone app. Dial ${number === "111" ? "111" : "0800 611 116"} manually.`);
    }
  }

  async function handleMockSync(kind: "ble" | "cloud" | "meal" | "imu" | "batch" | "replay" | "conflict") {
    if (!profile || !requireConsent()) return;
    const now = new Date();
    const options = { now, userId: profile.id, timezone: profile.timezone };
    let incoming: HealthEvent[];
    if (kind === "replay") {
      if (lastMockBatch.length === 0) {
        setStatusMessage("Run a mock import before replaying it.");
        return;
      }
      incoming = lastMockBatch;
    } else if (kind === "ble") {
      incoming = [createMockBleGattReading(options).event];
    } else if (kind === "cloud") {
      incoming = createMockCloudSync({ ...options, delayMinutes: 90 }).events;
    } else if (kind === "meal") {
      incoming = [createMockMealRecognition(options)];
    } else if (kind === "imu") {
      incoming = [createMockImuExercise(options)];
    } else if (kind === "conflict") {
      const first = createMockBleGattReading(options).event;
      incoming = [
        { ...first, id: `${first.id}-a`, valueMmolL: 6.8 },
        { ...first, id: `${first.id}-b`, occurredAt: new Date(Date.parse(first.occurredAt) + 60000).toISOString(), valueMmolL: 12.5 }
      ];
    } else {
      incoming = createMockIntegrationBatch(options);
    }
    const synchronized = synchronizeHealthEvents(events, incoming, now);
    const db = await openLocalStore();
    await replaceHealthEvents(db, synchronized.events);
    if (kind !== "replay") setLastMockBatch(incoming);
    const issueMessages = [...new Set(synchronized.issues.map((issue) => issue.message))];
    setSyncIssues(issueMessages);
    await refreshTimeline();
    setStatusMessage(`Mock sync accepted ${synchronized.acceptedIncoming} event(s), inserted ${synchronized.insertedIncoming}, and rejected ${synchronized.rejectedIncoming}.`);
  }

  function handleMockRateLimit() {
    if (!requireConsent()) return;
    const response = createMockCloudSync({ rateLimited: true });
    if (response.status !== 429) return;
    setSyncIssues([response.message]);
    setStatusMessage(`Mock cloud sync paused by rate limit. Existing data was retained; retry after ${response.retryAfterSeconds} seconds.`);
  }

  async function queueShelfPhoto(uri: string) {
    if (!profile || !requireConsent()) return;
    const id = createHealthEventId("shelf");
    let localImageUri = "";
    try {
      localImageUri = await persistShelfPhoto(uri, id);
      const thread: ShelfThreadRecord = {
        id,
        createdAt: new Date().toISOString(),
        localImageUri,
        caption: shelfCaption.trim() || undefined,
        status: "queued"
      };
      const db = await openLocalStore();
      await saveShelfThread(db, thread);
      await refreshShelfThreads();
      setShelfCaption("");
      setStatusMessage("Shelf photo copied into app storage and queued locally. No server request was made.");
    } catch (error) {
      if (localImageUri) {
        try {
          deleteOwnedShelfPhoto(localImageUri);
        } catch {
          // The orphan is retained rather than risking deletion outside app-owned storage.
        }
      }
      setStatusMessage(error instanceof Error ? error.message : "The shelf photo could not be queued.");
    }
  }

  async function handleCaptureShelfPhoto() {
    if (!profile || !requireConsent()) return;

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setStatusMessage("Camera permission is required for shelf photo capture.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: false,
      base64: false,
      mediaTypes: ["images"]
    });

    if (result.canceled || result.assets.length === 0) {
      setStatusMessage("Shelf photo capture canceled.");
      return;
    }

    await queueShelfPhoto(result.assets[0].uri);
  }

  async function handleChooseShelfPhoto() {
    if (!profile || !requireConsent()) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatusMessage("Photo-library permission is required to choose a shelf photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      allowsEditing: false,
      base64: false,
      mediaTypes: ["images"]
    });
    if (result.canceled || result.assets.length === 0) {
      setStatusMessage("Shelf photo selection canceled.");
      return;
    }
    await queueShelfPhoto(result.assets[0].uri);
  }

  async function handleAnalyzeShelfThread(thread: ShelfThreadRecord) {
    if (!requireConsent()) return;
    const db = await openLocalStore();
    try {
      let analysis;
      let analysisSource: ShelfThreadRecord["analysisSource"];
      if (serverSettings.preferredMode === "mock") {
        analysis = createMockShelfAnalysis({ caption: thread.caption, photoUri: thread.localImageUri });
        analysisSource = "mock";
      } else {
        if (!serverSettings.baseUrl.trim() || !serverSettings.apiKey.trim()) {
          throw new Error("Configure a local server URL and token in Settings before using server analysis.");
        }
        const payload = serverSettings.preferredMode === "gpt"
          ? { caption: thread.caption, photoDataUrl: await readShelfPhotoDataUrl(thread.localImageUri) }
          : { caption: thread.caption, candidate: createMockShelfAnalysis({ caption: thread.caption, photoUri: thread.localImageUri }) };
        const result = await sendShelfAnalysisToLocalServer(
          { baseUrl: serverSettings.baseUrl, apiKey: serverSettings.apiKey },
          payload,
          serverSettings.preferredMode
        );
        analysis = result.analysis;
        analysisSource = "local-server";
      }
      await saveShelfThread(db, { ...thread, status: "analyzed", analysis, analysisSource, lastError: undefined });
      await refreshShelfThreads();
      setStatusMessage(analysisSource === "mock" ? "Validated mock analysis saved locally." : "Validated local-server analysis saved.");
    } catch (error) {
      const lastError = error instanceof Error ? error.message.slice(0, 240) : "Shelf analysis failed.";
      await saveShelfThread(db, {
        ...thread,
        status: thread.analysis ? "analyzed" : "failed",
        lastError
      });
      await refreshShelfThreads();
      setStatusMessage(`${lastError} The photo remains local and can be retried.`);
    }
  }

  async function handleDeleteShelfThread(thread: ShelfThreadRecord) {
    let deletedOwnedPhoto = false;
    try {
      deletedOwnedPhoto = deleteOwnedShelfPhoto(thread.localImageUri);
    } catch {
      setStatusMessage("The local photo could not be deleted, so its shelf record was kept for retry.");
      return;
    }
    const db = await openLocalStore();
    await deleteShelfThread(db, thread.id);
    await refreshShelfThreads();
    setStatusMessage(deletedOwnedPhoto
      ? "Shelf record and its app-owned photo were deleted locally."
      : "Shelf record was deleted. Its legacy picker file was not app-owned and remains managed by the operating system.");
  }

  const timeline = dbState;
  const weeklyActivity = useMemo(
    () => summarizeWeeklyActivity(events, goals, new Date(clock), profile?.timezone ?? "Pacific/Auckland"),
    [clock, events, goals, profile?.timezone]
  );
  const encouragement = useMemo(() => buildEncouragement(weeklyActivity, goals), [goals, weeklyActivity]);
  const wellbeingReview = useMemo(() => reviewWellbeing(checkIns, new Date(clock), 7, unreadableCheckInCount), [checkIns, clock, unreadableCheckInCount]);
  const dailyTip = useMemo(() => pickDailyTip(new Date(clock)), [clock]);
  const suggestedTips = useMemo(
    () => suggestTipsForWeek(weeklyActivity, {
      averageSleepHours: wellbeingReview.averageSleepHours,
      highStressDays: wellbeingReview.highStressDays,
      footChecksDone: wellbeingReview.footChecksDone,
      hasCheckIns: wellbeingReview.checkInsInWindow > 0
    }).filter((tip) => tip.id !== dailyTip.id),
    [dailyTip.id, weeklyActivity, wellbeingReview]
  );
  const latestGlucoseCard = timeline.latestGlucose ? safeGlucoseDisplay(timeline.latestGlucose) : undefined;
  const clinicianReview = useMemo(
    () => buildClinicianReviewSummary(timeline.events, reviewContext, careTargets, timeline.unreadableCount),
    [careTargets, reviewContext, timeline.events, timeline.unreadableCount]
  );
  const consentBanner = profile?.consentState === "accepted"
    ? "Consent is active for local tracking."
    : profile?.consentState === "revoked"
      ? "Consent is revoked. Logging should stop until the user re-accepts."
      : "Consent has not been accepted yet. Core tracking should stay limited until the user agrees.";

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.appHeader}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Diabetes coaching</Text>
          <Text style={styles.appTitle}>Koru Companion</Text>
        </View>
        <View style={[styles.freshnessDot, timeline.freshness === "current" ? styles.dotCurrent : styles.dotLimited]} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
        {([
          ["home", "Today"],
          ["log", "Log"],
          ["coach", "Coach"],
          ["timeline", "Timeline"],
          ["reminders", "Reminders"],
          ["devices", "Devices"],
          ["shelf", "Shelf"],
          ["settings", "Settings"]
        ] as const).map(([tab, label]) => (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            style={activeTab === tab ? styles.tabActive : styles.tab}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={activeTab === tab ? styles.tabActiveText : styles.tabText}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.content}>
        <View accessibilityLiveRegion="polite" style={styles.statusStrip}>
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>

        <View style={[styles.banner, activeTab !== "home" && styles.hidden]}>
          <Text style={styles.bannerTitle}>Safety boundary</Text>
          <Text style={styles.bannerText}>
            This app supports wellness and decision support. It does not diagnose, calculate doses, change medication, or handle emergencies.
          </Text>
        </View>

        <View style={[styles.card, activeTab !== "devices" && styles.hidden]}>
          <Text style={styles.cardTitle}>Integration simulator</Text>
          <Text style={styles.bodyText}>Exercise the same normalization and synchronization path intended for device adapters. All values below are clearly marked mocks.</Text>
          <Text style={styles.muted}>BLE GATT service {BLE_GLUCOSE_SERVICE_UUID}, measurement characteristic {BLE_GLUCOSE_MEASUREMENT_CHARACTERISTIC_UUID}.</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleMockSync("ble")}>
              <Text style={styles.secondaryButtonText}>Import BLE mock</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleMockSync("cloud")}>
              <Text style={styles.secondaryButtonText}>Sync delayed cloud</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleMockSync("meal")}>
              <Text style={styles.secondaryButtonText}>Recognize meal mock</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleMockSync("imu")}>
              <Text style={styles.secondaryButtonText}>Detect IMU mock</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => handleMockSync("batch")}>
              <Text style={styles.primaryButtonText}>Run combined sync</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleMockSync("replay")}>
              <Text style={styles.secondaryButtonText}>Replay duplicate batch</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleMockSync("conflict")}>
              <Text style={styles.secondaryButtonText}>Simulate conflict</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleMockRateLimit}>
              <Text style={styles.secondaryButtonText}>Simulate rate limit</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>Delayed cloud delivery is simulated between 1 and 3 hours. Rate limits retain the last known data and do not fabricate a fresh reading.</Text>
          {syncIssues.length > 0 ? (
            <View style={styles.issueBox}>
              {syncIssues.map((issue) => <Text key={issue} style={styles.issueText}>• {issue}</Text>)}
            </View>
          ) : <Text style={styles.muted}>No synchronization issues from the latest simulator run.</Text>}
        </View>

        <View style={[styles.card, activeTab !== "settings" && styles.hidden]}>
          <Text style={styles.cardTitle}>Profile and consent</Text>
          <Text style={styles.bodyText}>{consentBanner}</Text>
          <Text style={styles.muted}>By accepting, you allow this app to store your profile, health logs, reminders, and shelf-photo history on this device. Photos leave the device only when you explicitly use a configured local server. You can revoke consent at any time; existing records remain until you delete them.</Text>
          <Text style={styles.muted}>This companion does not replace your GP, diabetes nurse, pharmacist, Healthline, or emergency services.</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Display name (optional)</Text>
            <TextInput value={displayName} onChangeText={setDisplayName} style={styles.input} placeholder="Your name" placeholderTextColor="#80918A" />
          </View>
          <Text style={styles.muted}>Timezone: {profile?.timezone ?? "Pacific/Auckland"}</Text>
          <Text style={styles.muted}>Consent version: {profile?.consentVersion ?? "2026-08-08"}</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveProfile}>
              <Text style={styles.primaryButtonText}>Save profile</Text>
            </Pressable>
            {profile?.consentState !== "accepted" ? (
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleAcceptConsent}>
                <Text style={styles.secondaryButtonText}>Review and accept consent</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={handleRevokeConsent}>
                <Text style={styles.dangerButtonText}>Revoke consent</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={handleConfirmDeleteAllData}>
              <Text style={styles.dangerButtonText}>Delete all local data</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, activeTab !== "settings" && styles.hidden]}>
          <Text style={styles.cardTitle}>Clinician-reviewable target context</Text>
          <Text style={styles.bodyText}>These values only provide display context. They do not change care or medication.</Text>
          <View style={styles.row}>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Fasting minimum</Text>
              <TextInput value={targetInputs.fastingMin} onChangeText={(value) => setTargetInputs((current) => ({ ...current, fastingMin: value }))} keyboardType="decimal-pad" style={styles.input} />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Fasting maximum</Text>
              <TextInput value={targetInputs.fastingMax} onChangeText={(value) => setTargetInputs((current) => ({ ...current, fastingMax: value }))} keyboardType="decimal-pad" style={styles.input} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Post-meal maximum</Text>
              <TextInput value={targetInputs.postprandialMax} onChangeText={(value) => setTargetInputs((current) => ({ ...current, postprandialMax: value }))} keyboardType="decimal-pad" style={styles.input} />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.label}>HbA1c maximum mmol/mol</Text>
              <TextInput value={targetInputs.hba1cMax} onChangeText={(value) => setTargetInputs((current) => ({ ...current, hba1cMax: value }))} keyboardType="number-pad" style={styles.input} />
            </View>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: careTargets.clinicianReviewed }}
            style={careTargets.clinicianReviewed ? styles.pillActive : styles.pill}
            onPress={() => setCareTargets((current) => ({ ...current, clinicianReviewed: !current.clinicianReviewed }))}
          >
            <Text style={careTargets.clinicianReviewed ? styles.pillActiveText : styles.pillText}>
              {careTargets.clinicianReviewed ? "Marked clinician-reviewed" : "Not yet clinician-reviewed"}
            </Text>
          </Pressable>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveTargets}>
              <Text style={styles.primaryButtonText}>Save target context</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, activeTab !== "home" && styles.hidden]}>
          <Text style={styles.cardTitle}>Glucose freshness</Text>
          <Text style={styles.metric}>{latestGlucoseCard?.label ?? "No glucose recorded"}</Text>
          <Text style={styles.bodyText}>{timeline.warning}</Text>
          {timeline.unreadableNotice ? <Text style={styles.warningText}>{timeline.unreadableNotice}</Text> : null}
          <Text style={styles.muted}>Timeline freshness: {timeline.freshness}</Text>
          <Text style={styles.muted}>Capillary reading: {timeline.latestGlucose?.compartment === "capillary-blood" ? "yes" : "no"}</Text>
          <Text style={styles.muted}>Cloud and physiological delay are labeled separately.</Text>
        </View>

        <View style={[styles.card, activeTab !== "home" && styles.hidden]}>
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
          <Text style={styles.muted}>{clinicianReview.targetReview?.message ?? "Log a glucose reading to see target context."}</Text>
          <Text style={styles.muted}>Target context: {careTargets.clinicianReviewed ? "marked clinician-reviewed" : "not yet clinician-reviewed"}.</Text>
        </View>

        <View style={[styles.card, activeTab !== "log" && styles.hidden]}>
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

        <View style={[styles.card, activeTab !== "log" && styles.hidden]}>
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
          </View>
        </View>

        <View style={[styles.card, activeTab !== "log" && styles.hidden]}>
          <Text style={styles.cardTitle}>Meal log</Text>
          <Text style={styles.bodyText}>Record what you know. Macronutrients are optional estimates and stay visibly labelled.</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Meal description</Text>
            <TextInput value={inputs.mealDescription} onChangeText={(value) => setInputs((current) => ({ ...current, mealDescription: value }))} style={styles.input} placeholder="Lunch" placeholderTextColor="#80918A" />
          </View>
          <View style={styles.row}>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Carbohydrate estimate min g</Text>
              <TextInput value={inputs.mealCarbMin} onChangeText={(value) => setInputs((current) => ({ ...current, mealCarbMin: value }))} keyboardType="decimal-pad" style={styles.input} placeholder="Optional" placeholderTextColor="#80918A" />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Carbohydrate estimate max g</Text>
              <TextInput value={inputs.mealCarbMax} onChangeText={(value) => setInputs((current) => ({ ...current, mealCarbMax: value }))} keyboardType="decimal-pad" style={styles.input} placeholder="Optional" placeholderTextColor="#80918A" />
            </View>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Estimate confidence %</Text>
            <TextInput value={inputs.mealConfidencePercent} onChangeText={(value) => setInputs((current) => ({ ...current, mealConfidencePercent: value }))} keyboardType="number-pad" style={styles.input} placeholder="70" placeholderTextColor="#80918A" />
          </View>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveMeal}>
            <Text style={styles.primaryButtonText}>Save meal</Text>
          </Pressable>
        </View>

        <View style={[styles.card, activeTab !== "log" && styles.hidden]}>
          <Text style={styles.cardTitle}>Activity log</Text>
          <Text style={styles.bodyText}>Any movement counts: walks, gardening, housework, strength work, or stretching.</Text>
          <View style={styles.rowWrap}>
            {QUICK_ACTIVITIES.map((quick) => (
              <Pressable key={quick.label} accessibilityRole="button" style={inputs.exerciseActivity === quick.label ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, exerciseActivity: quick.label, exerciseCategory: quick.category }))}>
                <Text style={inputs.exerciseActivity === quick.label ? styles.pillActiveText : styles.pillText}>{quick.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Activity</Text>
            <TextInput value={inputs.exerciseActivity} onChangeText={(value) => setInputs((current) => ({ ...current, exerciseActivity: value }))} style={styles.input} placeholder="Walking" placeholderTextColor="#80918A" />
          </View>
          <Text style={styles.label}>Type (optional)</Text>
          <View style={styles.rowWrap}>
            {(["aerobic", "resistance", "flexibility", "balance", "everyday"] as const).map((category) => (
              <Pressable key={category} accessibilityRole="radio" accessibilityState={{ checked: inputs.exerciseCategory === category }} style={inputs.exerciseCategory === category ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, exerciseCategory: current.exerciseCategory === category ? "" : category }))}>
                <Text style={inputs.exerciseCategory === category ? styles.pillActiveText : styles.pillText}>{category}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Duration minutes</Text>
            <TextInput value={inputs.exerciseDuration} onChangeText={(value) => setInputs((current) => ({ ...current, exerciseDuration: value }))} keyboardType="decimal-pad" style={styles.input} placeholder="30" placeholderTextColor="#80918A" />
          </View>
          <View style={styles.rowWrap}>
            {(["light", "moderate", "vigorous"] as const).map((intensity) => (
              <Pressable key={intensity} accessibilityRole="radio" accessibilityState={{ checked: inputs.exerciseIntensity === intensity }} style={inputs.exerciseIntensity === intensity ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, exerciseIntensity: intensity }))}>
                <Text style={inputs.exerciseIntensity === intensity ? styles.pillActiveText : styles.pillText}>{intensity}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveExercise}>
            <Text style={styles.primaryButtonText}>Save activity</Text>
          </Pressable>
        </View>

        <View style={[styles.card, activeTab !== "reminders" && styles.hidden]}>
          <Text style={styles.cardTitle}>{editingPlanId ? "Edit reminder plan" : "New reminder plan"}</Text>
          <Text style={styles.bodyText}>Use the medication label and time from your agreed plan. The app does not advise doses or what to do after a missed dose.</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Medication name</Text>
            <TextInput value={inputs.reminderMedicationName} onChangeText={(value) => setInputs((current) => ({ ...current, reminderMedicationName: value }))} style={styles.input} placeholder="Medication label" placeholderTextColor="#80918A" />
          </View>
          <View style={styles.row}>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Hour (0–23)</Text>
              <TextInput value={inputs.reminderHour} onChangeText={(value) => setInputs((current) => ({ ...current, reminderHour: value }))} keyboardType="number-pad" style={styles.input} placeholder="8" placeholderTextColor="#80918A" />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Minute</Text>
              <TextInput value={inputs.reminderMinute} onChangeText={(value) => setInputs((current) => ({ ...current, reminderMinute: value }))} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor="#80918A" />
            </View>
          </View>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveReminderPlan}>
              <Text style={styles.primaryButtonText}>{editingPlanId ? "Update and reschedule" : "Save and schedule"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => refreshMedicationPlans(true)}>
              <Text style={styles.secondaryButtonText}>Check permission and resync</Text>
            </Pressable>
            {editingPlanId ? (
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => {
                setEditingPlanId(null);
                setInputs((current) => ({ ...current, reminderMedicationName: "", reminderHour: "8", reminderMinute: "0" }));
              }}>
                <Text style={styles.secondaryButtonText}>Cancel edit</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.muted}>Notification permission: {capability?.status ?? "checking"}. Can ask again: {capability?.canAskAgain ? "yes" : "no"}.</Text>
          {capability ? <Text style={capability.granted ? styles.muted : styles.warningText}>{capability.permissionMessage}</Text> : null}
          <Text style={styles.muted}>{capability ? capability.exactAlarmNote : "Notification capability is being checked."}</Text>
        </View>

        <View style={[styles.card, activeTab !== "reminders" && styles.hidden]}>
          <Text style={styles.cardTitle}>Reminder plans</Text>
          {unreadablePlanCount > 0 ? (
            <>
              <Text style={styles.warningText}>{describeUnreadableMedicationPlans(unreadablePlanCount)}</Text>
              <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={confirmRemoveUnreadablePlans}>
                <Text style={styles.dangerButtonText}>Remove unreadable plans</Text>
              </Pressable>
            </>
          ) : null}
          {plans.length > 0 ? plans.map((plan) => (
            <View key={plan.id} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{plan.medicationName} at {plan.reminderHour.toString().padStart(2, "0")}:{plan.reminderMinute.toString().padStart(2, "0")}</Text>
              <Text style={styles.muted}>{describeMedicationPlanStatus(plan, profile?.timezone ?? plan.timezone, capability?.granted)}</Text>
              <Text style={styles.muted}>Needs sync: {medicationPlanNeedsReschedule(plan, profile?.timezone ?? plan.timezone) ? "yes" : "no"} | status: {plan.scheduleStatus}</Text>
              <View style={styles.row}>
                <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleEditReminderPlan(plan)}>
                  <Text style={styles.secondaryButtonText}>Edit</Text>
                </Pressable>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: plan.enabled }} style={styles.secondaryButton} onPress={() => handleToggleReminderPlan(plan)}>
                  <Text style={styles.secondaryButtonText}>{plan.enabled ? "Disable" : "Enable"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={() => handleDeleteReminderPlan(plan)}>
                  <Text style={styles.dangerButtonText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          )) : unreadablePlanCount === 0 ? <Text style={styles.muted}>No reminder plans saved yet.</Text> : null}
        </View>

        <View style={[styles.card, activeTab !== "timeline" && styles.hidden]}>
          <Text style={styles.cardTitle}>Unified timeline</Text>
          {timeline.events.map((event) => (
            <View key={event.id} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{formatTimelineLabel(event)}</Text>
              <Text style={styles.muted}>{event.type} | source: {event.source} | quality: {event.quality} | {formatDateTime(event.occurredAt)}</Text>
              {event.type === "glucose" && event.compartment === "interstitial-fluid" ? <Text style={styles.issueText}>Interstitial-fluid reading: it may lag behind capillary blood glucose during rapid change.</Text> : null}
            </View>
          ))}
          {timeline.events.length === 0 ? <Text style={styles.muted}>No local events yet. Accept consent and use Log to add the first record.</Text> : null}
        </View>

        <View style={[styles.card, activeTab !== "home" && styles.hidden]}>
          <Text style={styles.cardTitle}>Context snapshot</Text>
          <Text style={styles.bodyText}>Meals: {timeline.counts.meal}, activity: {timeline.counts.exercise}, medication: {timeline.counts.medication}, glucose: {timeline.counts.glucose}</Text>
          <Text style={styles.bodyText}>Current target context: fasting {careTargets.fastingMinMmolL}-{careTargets.fastingMaxMmolL} mmol/L, post-meal under {careTargets.postprandialMaxMmolL} mmol/L.</Text>
          <Text style={styles.muted}>{careTargets.clinicianReviewed ? "These targets are marked clinician-reviewed." : "These targets have not yet been marked clinician-reviewed."}</Text>
          <Text style={styles.muted}>Last status: {statusMessage}</Text>
        </View>

        <View style={[styles.card, activeTab !== "timeline" && styles.hidden]}>
          <Text style={styles.cardTitle}>Clinician review export</Text>
          <Text style={styles.bodyText}>Generate a plain-text snapshot for pattern review. It stays local unless you copy or share it yourself.</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleGenerateReviewExport}>
              <Text style={styles.primaryButtonText}>Generate export</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleShareReviewExport}>
              <Text style={styles.secondaryButtonText}>Share explicitly</Text>
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

        <View style={[styles.card, activeTab !== "settings" && styles.hidden]}>
          <Text style={styles.cardTitle}>Local server sync</Text>
          <Text style={styles.bodyText}>Optional. Keep this local to your own server. Protected routes require a token, and GPT analysis stays off unless you enable it.</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              value={serverSettings.baseUrl}
              onChangeText={(value) => setServerSettings((current) => ({ ...current, baseUrl: value }))}
              style={styles.input}
              placeholder="http://192.168.1.20:8787"
              placeholderTextColor="#80918A"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Local server API key</Text>
            <TextInput
              value={serverSettings.apiKey}
              onChangeText={(value) => setServerSettings((current) => ({ ...current, apiKey: value }))}
              style={styles.input}
              placeholder="Bearer token"
              placeholderTextColor="#80918A"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </View>
          <View style={styles.rowWrap}>
            {(["mock", "validate", "gpt"] as const).map((mode) => (
              <Pressable key={mode} accessibilityRole="button" style={serverSettings.preferredMode === mode ? styles.pillActive : styles.pill} onPress={() => setServerSettings((current) => ({ ...current, preferredMode: mode }))}>
                <Text style={serverSettings.preferredMode === mode ? styles.pillActiveText : styles.pillText}>{mode}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveServerSettings}>
              <Text style={styles.primaryButtonText}>Save server settings</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={refreshShelfThreads}>
              <Text style={styles.secondaryButtonText}>Reload queue</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleTestServerConnection}>
              <Text style={styles.secondaryButtonText}>Test connection</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={handleClearServerSettings}>
              <Text style={styles.dangerButtonText}>Clear settings</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>Server failures leave the photo queued for retry. They are never silently replaced with a mock result.</Text>
        </View>

        <View style={[styles.card, activeTab !== "shelf" && styles.hidden]}>
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
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={handleChooseShelfPhoto}>
              <Text style={styles.secondaryButtonText}>Choose photo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={refreshShelfThreads}>
              <Text style={styles.secondaryButtonText}>Refresh queue</Text>
            </Pressable>
          </View>
          <Text style={styles.muted}>Photos are copied into app-owned storage and stay local until you explicitly press Analyze. Current analysis mode: {serverSettings.preferredMode}.</Text>
        </View>

        <View style={[styles.card, activeTab !== "shelf" && styles.hidden]}>
          <Text style={styles.cardTitle}>Shelf history</Text>
          {shelfThreads.length > 0 ? shelfThreads.map((thread) => (
            <View key={thread.id} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{thread.caption || "Queued shelf photo"}</Text>
              <Text style={styles.muted}>{thread.status} | {formatDateTime(thread.createdAt)}</Text>
              <Text style={styles.muted}>Analysis source: {thread.analysisSource ?? "none"}</Text>
              <Image source={{ uri: thread.localImageUri }} style={styles.shelfImage} accessibilityLabel={thread.caption || "Local shelf photo"} />
              {thread.analysis ? <Text style={styles.muted}>{formatShelfAnalysisSummary(thread.analysis)}</Text> : <Text style={styles.muted}>No analysis yet. The photo remains in the local queue.</Text>}
              {thread.lastError ? <Text style={styles.issueText}>Last attempt: {thread.lastError}</Text> : null}
              <View style={styles.row}>
                <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleAnalyzeShelfThread(thread)}>
                  <Text style={styles.secondaryButtonText}>{thread.status === "analyzed" ? "Analyze again" : `Analyze (${serverSettings.preferredMode})`}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={() => handleDeleteShelfThread(thread)}>
                  <Text style={styles.dangerButtonText}>Delete photo and record</Text>
                </Pressable>
              </View>
            </View>
          )) : <Text style={styles.muted}>No shelf photos queued yet.</Text>}
        </View>

        <View style={[styles.card, activeTab !== "home" && styles.hidden]}>
          <Text style={styles.cardTitle}>Your week in motion</Text>
          <Text style={styles.metric}>{encouragement.headline}</Text>
          <Text style={styles.bodyText}>{encouragement.message}</Text>
          <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setActiveTab("coach")}>
            <Text style={styles.secondaryButtonText}>Open Coach</Text>
          </Pressable>
        </View>

        <View style={[styles.card, activeTab !== "coach" && styles.hidden]}>
          <Text style={styles.cardTitle}>This week's activity</Text>
          <Text style={styles.metric}>{weeklyActivity.equivalentModerateMinutes} / {goals.weeklyActiveMinutes} active minutes</Text>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.min(100, weeklyActivity.progressPercent) }} style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, weeklyActivity.progressPercent)}%` }]} />
          </View>
          <Text style={styles.muted}>Vigorous minutes count double toward the goal, following Health NZ and WHO guidance. Light activity is recorded but does not count toward the target.</Text>
          <View style={styles.rowWrap}>
            <Text style={styles.pillText}>Sessions {weeklyActivity.sessions}</Text>
            <Text style={styles.pillText}>Active days {weeklyActivity.activeDays}</Text>
            <Text style={styles.pillText}>Strength days {weeklyActivity.resistanceDays} / {goals.resistanceDaysPerWeek}</Text>
            <Text style={styles.pillText}>Streak {weeklyActivity.currentStreakDays} {weeklyActivity.currentStreakDays === 1 ? "day" : "days"}</Text>
            {weeklyActivity.lightMinutes > 0 ? <Text style={styles.pillText}>Light {weeklyActivity.lightMinutes} min</Text> : null}
          </View>
          {weeklyActivity.excludedSuspectSessions > 0 ? (
            <Text style={styles.issueText}>{weeklyActivity.excludedSuspectSessions} activity {weeklyActivity.excludedSuspectSessions === 1 ? "entry was" : "entries were"} excluded because of data-quality flags.</Text>
          ) : null}
          <Text style={styles.subtitle}>{encouragement.headline}</Text>
          <Text style={styles.bodyText}>{encouragement.message}</Text>
          <Text style={styles.bodyText}>Next step: {encouragement.nextStep}</Text>
          <Text style={styles.muted}>{encouragement.safetyNote}</Text>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => setActiveTab("log")}>
            <Text style={styles.primaryButtonText}>Log an activity</Text>
          </Pressable>
        </View>

        <View style={[styles.card, activeTab !== "coach" && styles.hidden]}>
          <Text style={styles.cardTitle}>Tip of the day</Text>
          <Text style={styles.subtitle}>{dailyTip.title}</Text>
          <Text style={styles.bodyText}>{dailyTip.body}</Text>
          <Text style={styles.muted}>Source: {dailyTip.sourceLabel}. General wellness information, not personal medical advice.</Text>
          {suggestedTips.length > 0 ? (
            <View style={styles.issueBox}>
              <Text style={styles.label}>Suggested for you this week</Text>
              {suggestedTips.map((tip) => (
                <View key={tip.id} style={styles.timelineRow}>
                  <Text style={styles.timelineLabel}>{tip.title}</Text>
                  <Text style={styles.muted}>{tip.body}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={[styles.card, activeTab !== "coach" && styles.hidden]}>
          <Text style={styles.cardTitle}>Daily check-in</Text>
          <Text style={styles.bodyText}>How are you doing today? Everything here is optional and stays on this device.</Text>
          <View style={styles.row}>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Sleep last night (hours)</Text>
              <TextInput value={inputs.checkInSleep} onChangeText={(value) => setInputs((current) => ({ ...current, checkInSleep: value }))} keyboardType="decimal-pad" style={styles.input} placeholder="7.5" placeholderTextColor="#80918A" />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Glasses of water</Text>
              <TextInput value={inputs.checkInWater} onChangeText={(value) => setInputs((current) => ({ ...current, checkInWater: value }))} keyboardType="number-pad" style={styles.input} placeholder="8" placeholderTextColor="#80918A" />
            </View>
          </View>
          <Text style={styles.label}>Mood</Text>
          <View style={styles.rowWrap}>
            {(["low", "flat", "okay", "good", "great"] as const).map((mood) => (
              <Pressable key={mood} accessibilityRole="radio" accessibilityState={{ checked: inputs.checkInMood === mood }} style={inputs.checkInMood === mood ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, checkInMood: current.checkInMood === mood ? "" : mood }))}>
                <Text style={inputs.checkInMood === mood ? styles.pillActiveText : styles.pillText}>{mood}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Stress</Text>
          <View style={styles.rowWrap}>
            {(["low", "moderate", "high"] as const).map((stress) => (
              <Pressable key={stress} accessibilityRole="radio" accessibilityState={{ checked: inputs.checkInStress === stress }} style={inputs.checkInStress === stress ? styles.pillActive : styles.pill} onPress={() => setInputs((current) => ({ ...current, checkInStress: current.checkInStress === stress ? "" : stress }))}>
                <Text style={inputs.checkInStress === stress ? styles.pillActiveText : styles.pillText}>{stress}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: inputs.checkInFootCheck }}
            style={inputs.checkInFootCheck ? styles.pillActive : styles.pill}
            onPress={() => setInputs((current) => ({ ...current, checkInFootCheck: !current.checkInFootCheck }))}
          >
            <Text style={inputs.checkInFootCheck ? styles.pillActiveText : styles.pillText}>{inputs.checkInFootCheck ? "Feet checked today" : "I checked my feet today"}</Text>
          </Pressable>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput value={inputs.checkInNotes} onChangeText={(value) => setInputs((current) => ({ ...current, checkInNotes: value }))} style={styles.input} placeholder="Anything you want to remember or share with your care team" placeholderTextColor="#80918A" multiline />
          </View>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveCheckIn}>
            <Text style={styles.primaryButtonText}>Save check-in</Text>
          </Pressable>
          {wellbeingReview.unreadableNotice ? <Text style={styles.warningText}>{wellbeingReview.unreadableNotice}</Text> : null}
          {wellbeingReview.messages.length > 0 ? (
            <View style={styles.issueBox}>
              {wellbeingReview.messages.map((message) => <Text key={message} style={styles.issueText}>• {message}</Text>)}
            </View>
          ) : null}
          <Text style={styles.muted}>
            Last 7 days: {wellbeingReview.checkInsInWindow} check-ins
            {wellbeingReview.averageSleepHours !== undefined ? `, average sleep ${wellbeingReview.averageSleepHours} h` : ""}
            {wellbeingReview.footChecksDone > 0 ? `, feet checked ${wellbeingReview.footChecksDone} ${wellbeingReview.footChecksDone === 1 ? "day" : "days"}` : ""}.
          </Text>
          {checkIns.slice(0, 7).map((checkIn) => (
            <View key={checkIn.id} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{formatCheckInLabel(checkIn)}</Text>
              <Text style={styles.muted}>{formatDateTime(checkIn.occurredAt)}</Text>
              {checkIn.notes ? <Text style={styles.muted}>{checkIn.notes}</Text> : null}
              <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={() => handleDeleteCheckIn(checkIn)}>
                <Text style={styles.dangerButtonText}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={[styles.card, activeTab !== "coach" && styles.hidden]}>
          <Text style={styles.cardTitle}>Weekly goals</Text>
          <Text style={styles.bodyText}>Defaults follow Health NZ guidance: 150 minutes of moderate activity and strength work on 2 days a week. Start lower if you are new to activity and build up.</Text>
          <View style={styles.row}>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Active minutes per week</Text>
              <TextInput value={goalInputs.weeklyActiveMinutes} onChangeText={(value) => setGoalInputs((current) => ({ ...current, weeklyActiveMinutes: value }))} keyboardType="number-pad" style={styles.input} />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.label}>Strength days per week</Text>
              <TextInput value={goalInputs.resistanceDaysPerWeek} onChangeText={(value) => setGoalInputs((current) => ({ ...current, resistanceDaysPerWeek: value }))} keyboardType="number-pad" style={styles.input} />
            </View>
          </View>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={handleSaveGoals}>
            <Text style={styles.primaryButtonText}>Save goals</Text>
          </Pressable>
        </View>

        <View style={[styles.card, activeTab !== "coach" && styles.hidden]}>
          <Text style={styles.cardTitle}>Regular checks to keep up</Text>
          <Text style={styles.bodyText}>Your care team sets the exact schedule. These are the usual intervals in New Zealand.</Text>
          {REGULAR_CHECKS.map((item) => (
            <View key={item.check} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{item.check}</Text>
              <Text style={styles.muted}>{item.typicalFrequency}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, activeTab !== "coach" && styles.hidden]}>
          <Text style={styles.cardTitle}>When to contact your care team</Text>
          <Text style={styles.bodyText}>This app cannot assess or treat these situations. Use the prompts below to decide who to call.</Text>
          {SEEK_HELP_SIGNS.map((item) => (
            <View key={item.sign} style={styles.timelineRow}>
              <Text style={styles.timelineLabel}>{item.sign}</Text>
              <Text style={styles.issueText}>{item.action}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={() => handleCall("111")}>
              <Text style={styles.dangerButtonText}>Call 111</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleCall("0800611116")}>
              <Text style={styles.secondaryButtonText}>Call Healthline</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>Guidance sources</Text>
          {GUIDELINE_SOURCES.map((source) => (
            <Pressable key={source.url} accessibilityRole="link" onPress={() => Linking.openURL(source.url).catch(() => setStatusMessage("Unable to open the link on this device."))}>
              <Text style={styles.linkText}>{source.label}</Text>
            </Pressable>
          ))}
          <Text style={styles.muted}>Coaching content is general wellness information and has not yet been reviewed by a New Zealand clinician. It never replaces your care plan.</Text>
        </View>

        <View style={[styles.card, activeTab !== "home" && styles.hidden]}>
          <Text style={styles.cardTitle}>Safety reminder</Text>
          <Text style={styles.bodyText}>If there is immediate danger or a medical emergency, call 111. If you are worried or unsure about your health, call Healthline free on 0800 611 116, 24 hours a day.</Text>
          <Text style={styles.muted}>Use your agreed care plan and local urgent-care pathways rather than relying on this app alone.</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={() => handleCall("111")}>
              <Text style={styles.dangerButtonText}>Call 111</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => handleCall("0800611116")}>
              <Text style={styles.secondaryButtonText}>Call Healthline</Text>
            </Pressable>
          </View>
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
  appHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.page },
  headerText: { gap: 2 },
  appTitle: { color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: "800" },
  freshnessDot: { width: 12, height: 12, borderRadius: 6 },
  dotCurrent: { backgroundColor: "#27845E" },
  dotLimited: { backgroundColor: "#C47A19" },
  tabBar: { paddingHorizontal: 16, paddingBottom: 10, gap: 8, backgroundColor: colors.page },
  tab: { minHeight: 42, justifyContent: "center", paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tabActive: { minHeight: 42, justifyContent: "center", paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accent },
  tabText: { color: colors.muted, fontWeight: "700" },
  tabActiveText: { color: "#FFFFFF", fontWeight: "800" },
  content: { paddingHorizontal: 20, paddingBottom: 36, gap: 14 },
  statusStrip: { backgroundColor: "#FFF6E8", borderColor: "#F0D3A3", borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  statusText: { color: "#70410C", fontSize: 13, lineHeight: 18 },
  issueBox: { backgroundColor: "#FFF6E8", borderColor: "#F0D3A3", borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  issueText: { color: "#8A4B08", fontSize: 13, lineHeight: 18 },
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
  warningText: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: "700" },
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
  dangerButton: { backgroundColor: "#FCE8E6", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, minHeight: 44, justifyContent: "center" },
  dangerButtonText: { color: "#9B2C22", fontWeight: "800" },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#FBFCFB" },
  pillActive: { borderWidth: 1, borderColor: colors.accent, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.accentSoft },
  pillText: { color: colors.muted, fontWeight: "700" },
  pillActiveText: { color: colors.accent, fontWeight: "800" },
  timelineRow: { gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  progressTrack: { height: 12, borderRadius: 999, backgroundColor: colors.accentSoft, overflow: "hidden" },
  progressFill: { height: 12, borderRadius: 999, backgroundColor: colors.accent },
  linkText: { color: colors.accent, fontSize: 13, lineHeight: 18, textDecorationLine: "underline" },
  timelineLabel: { color: colors.text, fontWeight: "700" },
  shelfImage: { width: "100%", height: 180, borderRadius: 12, backgroundColor: colors.accentSoft, resizeMode: "cover" },
  hidden: { display: "none" }
});
