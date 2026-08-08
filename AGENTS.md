# Repository Guidelines

## Operating Rules for Coding Agents

Before changing files, inspect `blueprintreasearch.md`, the repository tree, framework entry points, existing components, and available test/build commands. Summarize the current architecture and propose the first implementation phase before coding. Work in explicit phases; after each phase, run relevant tests and build/type checks, then report changed files, results, remaining risks, and the next recommended phase.

Treat this project as a wellness and decision-support application, not an autonomous medical device. Never provide insulin doses, medication changes, diagnoses, or emergency treatment instructions. Label estimates, predictions, delayed readings, and uncertain data clearly. Use safe fallbacks for missing, delayed, duplicated, out-of-order, or contradictory readings. Never log health data, meal images, access tokens, or personal identifiers in plaintext.

## Required Product Scope

Implement incrementally, keeping the architecture in `blueprintreasearch.md` authoritative:

- Foundation: user profile and consent, manual glucose and medication logging, a unified glucose/meal/activity timeline, quality labels, and local notifications.
- Normalized events: capillary-blood versus interstitial-fluid glucose, meals with volumetric macronutrient estimates, IMU exercise intensity/duration, medication events, source device, timestamps, timezone, confidence, and quality state.
- Mocks: BLE GATT glucose service `0x1808` and measurement characteristic `0x2A18`, delayed/rate-limited cloud syncs (1–3 hours), meal recognition, and IMU exercise data.
- Validation and UI: synchronization, deduplication, ordering/conflict handling, interstitial-fluid lag flags during rapid flux, and accessible dashboard views for freshness, trends, meals, activity, medication status, warnings, and limitations.

Medication reminders must accommodate mobile OS exact-alarm permissions and platform limits (for example Android `SCHEDULE_EXACT_ALARM` and exact-while-idle scheduling where supported); do not assume background tasks are punctual.

## Project Structure & Module Organization

This is an npm workspace for an Auckland-focused Type 2 diabetes coaching companion:

- `apps/mobile/` contains the Expo/React Native client, device storage, and local reminders.
- `apps/local-server/` contains the optional Express server; external AI keys belong here, never in the mobile app.
- `packages/shared/` contains shared TypeScript contracts, deterministic clinical rules, mocks, and unit tests.
- `docs/` contains implementation plans and work items. `README.md` documents scope and safety boundaries.

Keep new domain contracts and validation logic in `packages/shared`; keep platform-specific behavior in the relevant app.

## Build, Test, and Development Commands

Run these from the repository root after `npm install`:

```sh
npm test                 # Run shared Vitest tests
npm run dev:mobile       # Start the Expo development server
npm run dev:server       # Start the local Express server with tsx watch
```

The server listens on port `8787` by default; set `PORT` to override it. TypeScript configuration is strict in both apps. Add package-level scripts when introducing new build or type-check workflows.

## Coding Style & Naming Conventions

Use TypeScript with strict checking, two-space indentation, double-quoted strings, and semicolons, matching the existing source. Use `PascalCase` for React components and schemas, `camelCase` for functions, variables, and hooks, and kebab-case for multiword filenames (for example, `health-events.ts`). Prefer small pure functions for clinical rules and validate external data with Zod before display or storage.

## Testing Guidelines

Use Vitest for shared logic. Test files are colocated as `*.test.ts`; describe behavior and safety outcomes, including invalid, delayed, duplicate, out-of-order, and conflicting health events. Add coverage for normalized models, mock synchronization, deduplication, data-quality states, interstitial-fluid lag, and notification permission/capability reporting. Run `npm test` before submitting changes; add type/build checks as scripts become available. No formal coverage threshold is configured yet.

## Commit & Pull Request Guidelines

Use concise imperative commit subjects with a type prefix such as `chore:`, `feat:`, `fix:`, or `test:` (the existing history uses `chore: document work items and scaffold`). Keep commits focused. Pull requests should explain scope, safety implications, testing performed, and any configuration changes; include screenshots or a short device-flow recording for mobile UI changes and link related work items.

## Security & Safety Requirements

Do not commit `.env` files, API keys, patient data, or real clinical records. Preserve clinician-reviewable defaults and explicit urgent-care escalation copy. The app must not diagnose, change medication, calculate doses, or manage emergencies. Any uploaded photo or external AI response must remain optional, consent-aware, schema-validated, and failure-safe.

## Documentation

Keep setup instructions, architecture decisions, phase status, safety assumptions, and known mobile OS limitations current in `README.md` and `docs/`. Record unresolved clinical, privacy, security, accessibility, and device-behavior risks instead of hiding them behind optimistic defaults.
