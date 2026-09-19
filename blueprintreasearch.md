# Diabetes Coaching Architecture Blueprint

This document is the authoritative implementation blueprint for the Auckland-focused Type 2 diabetes coaching companion. The product is a wellness and decision-support application. It is not an autonomous medical device and must never diagnose, calculate insulin or other medication doses, change medicines, or manage emergencies.

## Product boundary

The core experience works offline and keeps personal health records on the device by default. The optional local server adds authenticated shelf-photo analysis but is not required for consent, manual logging, the timeline, reminders, target context, or clinician-review exports. Any clinical target is contextual, user-configurable, and marked as requiring clinician review.

Concerning readings or symptoms must lead to clear limitations and clinician/urgent-care escalation copy. They must never lead to treatment instructions. Estimates, delayed readings, physiological lag, conflicts, and unavailable data are visibly labelled.

## Workspace architecture

### `apps/mobile`

Expo/React Native owns screens, navigation, accessibility, SQLite persistence, local notification scheduling, camera/photo selection, local exports, and network calls to the optional local server. No external AI key may be bundled in the mobile app.

SQLite is the on-device source of truth. Schema changes use explicit, ordered migrations in a transaction. Data loaded from SQLite is parsed with shared Zod contracts before use; corrupt rows are excluded and surfaced as limited-quality data rather than crashing the app.

### `apps/local-server`

Express owns authenticated `/v1` routes and optional OpenAI calls. It binds to a configurable host/port, limits request size, validates every input and output, uses timing-safe token comparison, redacts audit details, and fails closed when authentication or AI configuration is absent. The server does not persist photos or health records by default.

### `packages/shared`

Shared TypeScript owns normalized event contracts, deterministic quality/synchronization rules, target-context rules, medication-plan state, shelf-analysis schemas, integration mocks, and unit tests. Platform APIs and UI code do not belong here.

## Normalized data model

Every health event includes a stable ID, user ID, event type, source, occurrence and receipt timestamps, IANA timezone, confidence from 0 to 1, quality state, and optional notes.

- Glucose distinguishes capillary blood from interstitial fluid and may include context, trend, and source delay.
- Meals contain user-confirmed descriptions and optional single-value or ranged macronutrient estimates with portion confidence.
- Exercise contains activity, duration, intensity, and whether IMU data produced the estimate.
- Medication events record the medication label and an acknowledgement state only; prescribed dose text is reference data, never a calculated recommendation.

Quality states are `valid`, `delayed`, `estimated`, `suspect`, `missing`, and `conflicting`. Invalid external records never reach storage or display. Duplicate IDs are idempotent. Out-of-order records are sorted by occurrence time, while material nearby glucose disagreements are retained and flagged for review.

## Mobile feature flows

1. Onboarding records explicit consent and a local profile before health logging or photo capture is enabled. Consent can be revoked without deleting the profile, and revocation stops new sensitive-data collection.
2. The dashboard shows the latest real reading only, its source/compartment, freshness, data limitations, target context, and event counts. Empty states never substitute demo values for personal data.
3. Manual logging validates glucose, meals, activity, and medication acknowledgement before storage, then updates one unified timeline.
4. Medication plans schedule device-local notifications. The app reports notification permission and exact-alarm limitations, reconciles schedules after launch/edits/timezone changes, and supports enable, disable, resync, and acknowledgement without missed-dose advice.
5. Integration simulation covers BLE GATT Glucose Service `0x1808` / Measurement `0x2A18`, delayed and rate-limited cloud CGM delivery, volumetric meal estimates, and IMU exercise estimates. The same normalization and merge path processes mock and future real adapters.
6. Shelf photos remain local unless the user explicitly requests server analysis. Server failure leaves a retryable queued item; it does not silently present a mock as a remote result. Users can delete both the database record and locally copied image.
7. Clinician-review export is generated locally, clearly dated, quality-aware, and shareable only through an explicit user action.

## Reminder reliability

Notification delivery is best-effort and subject to mobile OS limits. Android builds declare `POST_NOTIFICATIONS` and `SCHEDULE_EXACT_ALARM`, but the app must inspect capability at runtime and must not claim punctual delivery. Use a daily calendar trigger where supported, reconcile native notification identifiers, and mark failures or stale schedules visibly. Exact-while-idle behavior and restart handling require physical-device verification on each supported OS version.

## Optional server and AI safety

Protected endpoints require `LOCAL_SERVER_API_KEY`. GPT-backed analysis additionally requires `OPENAI_API_KEY` on the server. Requests require an allowed image data URL and bounded caption; responses must pass the strict shared `ShelfAnalysisSchema`. The mobile app displays limitations and the fixed coaching-only safety notice. No request, token, image, personal identifier, or health payload is written to plaintext logs.

## Delivery phases

1. Foundation: verified workspace, migrations, consent/profile, manual logs, unified timeline, quality labels, accessibility baseline, and local-only defaults.
2. Medication: editable plans, permission/capability reporting, native schedule reconciliation, acknowledgement events, and failure states.
3. Context and integrations: target review, quality-aware trends/export, BLE/cloud/meal/IMU mocks, synchronization, deduplication, ordering, conflicts, and lag flags.
4. Shelf workflow: local photo lifecycle, consent-aware queue, retry/delete controls, and schema-validated local-server analysis.
5. Server hardening: bounded validated routes, authentication, privacy-safe auditing, GPT failure containment, and endpoint tests.
6. Release verification: unit/integration tests, strict type checks, Expo compatibility/config checks, bundle smoke builds, physical-device notification/camera tests, clinical/privacy/security/accessibility review, and updated known-risk documentation.

## Verification commands

From the repository root after `npm ci`:

```sh
npm test
npm run typecheck
npm run check
npm run dev:mobile
npm run dev:server
```

Automated checks do not replace physical-device camera, notification, timezone, restart, offline, and accessibility tests or independent New Zealand clinical/privacy/security review.
