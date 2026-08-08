# Implementation Plan

## Scope and decisions

The mobile client is Expo/React Native with TypeScript. SQLite is the on-device source of truth, while `expo-notifications` schedules medication reminders locally on the device. The backend is an Express service designed for the user's local server; it is optional for core tracking and is the only place an external GPT-4o key may live.

The grocery experience is a chat thread: take/select shelf photo → local pending message → optional local-server analysis → validated JSON card. A photo is not a diagnosis or a complete nutrition assessment. The user must confirm any product details and ingredient information.

## Safety requirements before release

- Have New Zealand clinical, privacy, security, and accessibility review before using with real patients.
- Do not infer diagnoses, prescribe/adjust medicines, calculate doses, or provide emergency management.
- Make glucose targets, medication list, notifications, and escalation content clinician-reviewable and user-configurable.
- Put urgent symptoms and severe/unwell wording ahead of normal coaching, with links/call actions for local urgent care pathways (for example Healthline and emergency services); verify exact copy and contact details before release.
- Encrypt sensitive records at rest where the platform supports it, protect exports, obtain consent for any upload, and minimise photo retention.

## Delivery phases

### Current implementation status

- Repository inspection completed: Expo/React Native mobile app, optional Express local server, and shared TypeScript package.
- Added normalized health-event contracts for glucose compartment, meals, exercise, medication, source, timestamps, confidence, and quality state.
- Added validation for delayed cloud readings, interstitial-fluid lag risk, duplicate IDs, and conflicting nearby glucose readings.
- Added SQLite storage for normalized events and user consent/profile metadata.
- Added notification permission/capability reporting and Android exact-alarm permission declaration. Exact delivery remains platform-dependent and must be verified on physical devices.
- Added shared unit tests for the new event validation, merge behavior, profile state, and timeline summaries.
- Built the Phase 1 mobile shell with local consent handling, manual glucose and medication logging, a unified timeline, freshness labels, and reminder scheduling controls.
- Added Phase 2 medication-plan storage, silent launch-time reconciliation, explicit reminder resync controls, and persisted plan status labels.
- Added Phase 3 glucose trend helpers, target-context review controls, and a local clinician-review export snapshot.

1. Establish app navigation, local schema/migrations, consent, safety copy, and accessibility baseline.
2. Implement medication plan entry and native offline schedules. Reconcile schedules after edits, app launches, and timezone changes; test Android/iOS behaviour on physical devices.
3. Add glucose logging, target context, trend display, clinician-review export, and deterministic rules with unit tests.
4. Add photo capture, local queue, deletion controls, chat history, and a mocked structured shelf-analysis response.
5. Deploy the server only to the user's local network/server, add authenticated transport, audit controls, and optional GPT-4o analysis with schema validation and failure-safe UI.
6. Conduct clinical-safety, privacy, threat-model, notification reliability, and usability testing before any live use.

## Decisions needed before production

- Target iOS, Android, or both; and whether the app must function without first launching after device restart.
- Identity/authentication model and how devices reach the local server (LAN, VPN, or reverse proxy).
- Clinician-approved escalation wording and contact pathways for the intended Auckland service.
- Whether any data may leave the device, retention periods, and the approved GPT-4o account/data controls.
