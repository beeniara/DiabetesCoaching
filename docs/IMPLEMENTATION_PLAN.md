# Implementation Plan and Status

## Product boundary

The Expo/React Native client is an offline-first Type 2 diabetes wellness companion. SQLite is the on-device source of truth and `expo-notifications` owns best-effort local medication reminders. The optional Express server is the only place an external AI key may live. It is not required for tracking, reminders, trends, mocks, or exports.

The app does not diagnose, calculate a dose, change medication, or manage an emergency. Glucose target context is configurable and requires clinician confirmation. Estimates, delayed readings, conflicts, physiological lag, and missing data are shown as limitations rather than silently treated as current facts.

## Completed implementation phases

### 1. Foundation and data integrity — complete

- Restored the authoritative architecture blueprint and established workspace-wide test/type-check commands.
- Upgraded the mobile dependency set to Expo SDK 57 and added a valid Metro entry point.
- Added ordered SQLite migrations, strict read validation, local profile/consent, configurable care targets, and secure-token migration.
- Added normalized glucose, meal, activity, and medication contracts with source, compartment, timestamps, timezone, confidence, and quality state.
- Added manual logging, a unified timeline, freshness labels, honest empty states, target context, and a local clinician-review export.

### 2. Medication reminders — complete in software

- Added editable, enable/disable/delete medication plans and device-local daily scheduling.
- Added Taken, Skipped, and Snooze 10 min notification actions with idempotent medication events.
- Added notification permission/capability reporting, native identifier reconciliation, timezone refresh, and explicit resync.
- Added consent-revocation cancellation and Android exact-alarm permission declaration. Revocation cancels every scheduled reminder, including pending snoozes and reminders from unreadable plans.
- Moved reminder reconciliation decisions (keep, disable, await permission, reschedule with reason) and notification capability reporting into `packages/shared/src/medication-plans.ts` with unit tests; `apps/mobile/src/reminders.ts` now only performs the native calls.
- Failed, stale, and permission-blocked reminders show distinct status text, and a denied or blocked notification permission is shown as a warning with the recovery step.

Delivery punctuality, reboot handling, idle modes, and exact-alarm settings remain operating-system behaviours that require the physical-device acceptance matrix.

### 3. Quality, synchronization, and integrations — complete

- Added deterministic normalization, idempotent duplicate handling, ordering, malformed-event rejection, and visible conflict propagation.
- Added interstitial-fluid lag warnings during rapid flux and limited/stale status for old or unreliable data.
- Added BLE GATT glucose, one-to-three-hour cloud delay/rate-limit, meal-recognition, and IMU exercise simulations.
- Routed single and batch simulations through the same atomic synchronization path.
- Stored health events, reminder plans, and wellbeing check-ins that can no longer be read are counted instead of silently dropped. The dashboard, reminder list, wellbeing review, and clinician summary say the data may be incomplete, and the timeline is never reported as `current` while records are unreadable.
- **Remove unreadable plans** cancels only the device reminders and snoozes that belong to unreadable or missing plans, then removes those rows; full local deletion now cancels every scheduled app reminder and clears wellbeing data from the screen.
- A stored `conflicting` glucose label now survives reload and re-normalization, nearby-reading conflicts are detected per glucose compartment even when other events are logged in between, and the clinician trend compares readings from the same compartment only.

The supplied integrations are safe mocks. Real BLE packet decoding, vendor authentication, and production cloud adapters remain separate future work.

### 4. Shelf-photo workflow — complete in software

- Added consent-gated camera/library intake, bounded app-owned photo storage, local queue, visible status, retry, and deletion.
- Added strict shelf-analysis contracts and validated mock results.
- Added explicit server modes; network failures never silently substitute a mock result.
- Added local-only behaviour by default and explicit upload only when the user requests analysis.

Camera/library permission and storage behaviour still require physical-device acceptance.

### 5. Optional server and AI boundary — complete

- Added bounded JSON requests, protected `/v1` routes, timing-safe bearer-token checks, explicit CORS, per-client rate limiting, request IDs, and defensive response headers.
- Added redacted audit writing that excludes photos, bearer tokens, identifiers, and health payloads.
- Added schema-validated mock and GPT endpoints with timeout/retry limits and safe `503`, `422`, and `502` failure states.
- Added secure mobile token storage, normalized server origins, request timeouts, connection testing, and settings deletion.
- Added integration tests covering health, auth failure, schema validation, AI fail-closed behaviour, CORS, and audit redaction.

### 6. Release-candidate verification — complete for repository checks

- Added full local-data deletion with confirmation.
- Added current setup, privacy, deployment, risk, and physical-device testing documentation.
- Verified shared and server tests, all strict TypeScript configurations, Expo dependency compatibility/config resolution, and an Android bundle export.
- Verified the server process and authenticated mock route over loopback.

### 7. Lifestyle coaching and wellbeing check-ins — complete in software

- Added a deterministic coaching engine in `packages/shared/src/coaching.ts`: 7-day activity summary against user-set weekly goals (defaults 150 moderate-equivalent minutes and 2 strength days, per Health NZ, NZSSD, ADA, and WHO guidance), active-day streaks, non-shaming encouragement with a concrete next step, and an always-visible exercise safety note.
- Added optional `category` (aerobic, resistance, flexibility, balance, everyday) to activity events with keyword inference for legacy entries; suspect or conflicting sessions are excluded from totals and the exclusion is shown.
- Added a sourced library of general wellness tips (activity, nutrition, sleep, stress, foot care, checks, hydration, habits), a deterministic tip of the day, and targeted weekly suggestions driven by logged data.
- Added wellbeing check-ins in `packages/shared/src/wellbeing.ts` (sleep, mood, stress, water, foot check, notes) with a 7-day review that surfaces short sleep, high stress, low mood, and missing foot checks as prompts to act or talk with the care team.
- Added a "when to contact your care team" list built from Healthify and Diabetes NZ warning signs, routing to 111, Healthline, GP, or 1737 only; it never gives treatment steps.
- Added SQLite migration v4 (`wellbeing_checkins`, `wellness_goals`), quick-pick activities, a Coach tab, and a home-screen weekly summary. All new data is included in full local deletion.

Coaching copy is general wellness information with linked public sources. It has not been reviewed by a New Zealand clinician and is flagged as such in-app and in [KNOWN_RISKS.md](KNOWN_RISKS.md).

## Release decision

The repository is a functioning software release candidate, not a clinically or operationally approved production release. The core app is usable offline and failure-safe within the documented boundary. Release to real users is blocked on the external gates in [WORK_ITEMS.md](WORK_ITEMS.md), especially physical-device notification/camera testing and independent New Zealand clinical, privacy, security, and accessibility review.

## Verification commands

From the repository root after `npm ci`:

```sh
npm test
npm run typecheck
npm run check
npm run dev:mobile
npm run dev:server
```

Automated checks do not replace the [physical-device test plan](PHYSICAL_DEVICE_TEST_PLAN.md).
