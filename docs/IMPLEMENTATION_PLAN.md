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
- Added consent-revocation cancellation and Android exact-alarm permission declaration.

Delivery punctuality, reboot handling, idle modes, and exact-alarm settings remain operating-system behaviours that require the physical-device acceptance matrix.

### 3. Quality, synchronization, and integrations — complete

- Added deterministic normalization, idempotent duplicate handling, ordering, malformed-event rejection, and visible conflict propagation.
- Added interstitial-fluid lag warnings during rapid flux and limited/stale status for old or unreliable data.
- Added BLE GATT glucose, one-to-three-hour cloud delay/rate-limit, meal-recognition, and IMU exercise simulations.
- Routed single and batch simulations through the same atomic synchronization path.

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
