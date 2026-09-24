# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Koru Companion is an Auckland-focused Type 2 diabetes wellness and
decision-support app. It supports personal tracking and clinician
conversations; it is **not** an autonomous medical device and must never
diagnose, calculate doses, change medication, or manage emergencies.

The mobile app works offline for its core features, with local records stored
in SQLite by default. An optional self-hosted Express service can validate or
analyse shelf photos when the user explicitly requests it — this server is the
only component permitted to hold an external AI key.

`blueprintreasearch.md` is the authoritative product and implementation
blueprint — read it before proposing or building new functionality. Read
[AGENTS.md](AGENTS.md) in full as well; it carries the same operating rules as
this file plus more detail on style and PR conventions.

## Commands

This is an npm workspace (`apps/*`, `packages/*`). Run from the repo root
after `npm ci`:

```sh
npm run check        # npm test + npm run typecheck across all workspaces (do this before submitting changes)
npm test             # Vitest for packages/shared and apps/local-server
npm run typecheck    # tsc --noEmit across all workspaces
npm run dev:mobile    # start the Expo dev server (apps/mobile)
npm run dev:server    # start the local Express server via tsx watch (apps/local-server)
```

Run a single Vitest file or test by `cd`-ing into the workspace first, e.g.:

```sh
cd packages/shared && npx vitest run src/clinical.test.ts
cd apps/local-server && npx vitest run -t "some test name"
```

Mobile bundle smoke check used during development:

```sh
npm exec --workspace @diabetes-coaching/mobile expo export -- --platform android --output-dir .expo-smoke
```

The local server binds to loopback on port `8787` by default (override with
`PORT`); protected routes require `LOCAL_SERVER_API_KEY` (24+ random chars).
See [README.md](README.md) for the full list of server env vars
(`LOCAL_SERVER_ALLOWED_ORIGINS`, `LOCAL_SERVER_RATE_LIMIT_PER_MINUTE`,
`LOCAL_SERVER_AUDIT_LOG`, `OPENAI_API_KEY`, `OPENAI_SHELF_MODEL`).

## Architecture

Three workspaces, with a strict dependency direction: platform apps depend on
`packages/shared`, never the reverse, and `apps/mobile` never talks directly
to any AI provider.

- **`packages/shared`** — the domain core. Zod contracts and deterministic
  rules for normalized health events (glucose, meals, activity, medication),
  clinical/safety logic (`clinical.ts`, `glucose-review.ts`), medication plans,
  timeline construction (`timeline.ts`), synchronization/dedup/ordering
  (`synchronization.ts`), shelf-photo analysis contracts
  (`shelf-analysis.ts`), device/cloud mocks (`mocks.ts`), the deterministic
  lifestyle coaching engine (`coaching.ts`: weekly activity goals, streaks,
  encouragement, sourced tips, seek-help prompts), glucose-friendly habit
  recognition (`habits.ts`), and wellbeing check-ins (`wellbeing.ts`). Every file has a
  colocated `*.test.ts`. New domain logic and validation belongs here, not in
  either app.
- **`apps/mobile`** — Expo/React Native client. SQLite (`src/storage.ts`) is
  the local source of truth for events, plans, target context, profile/consent
  state, and shelf history. `src/reminders.ts` handles local notifications
  (must account for Android `SCHEDULE_EXACT_ALARM` and similar OS limits —
  background delivery is never assumed to be punctual). `src/shelf-files.ts`
  manages app-owned photo storage. `src/local-server.ts` /
  `src/local-server-storage.ts` are the optional client for the local server,
  with its bearer token kept in `expo-secure-store`, never in SQLite.
- **`apps/local-server`** — optional Express service (`src/app.ts`,
  `src/index.ts`). `src/auth.ts` enforces the bearer-token check, `src/audit.ts`
  writes redacted JSONL audit records, `src/shelf.ts` validates and routes
  shelf-photo requests, `src/gpt4o.ts` is the only file allowed to call the
  external AI provider. Fails closed: without `OPENAI_API_KEY` the analysis
  route returns `503` and the mobile queue stays retryable rather than erroring.

Simulated device and cloud integrations (BLE GATT glucose `0x1808`/`0x2A18`,
delayed/rate-limited cloud sync, meal recognition, IMU exercise) in
`packages/shared/src/mocks.ts` are test harnesses standing in for future real
adapters, following the same normalization/sync path real devices will use.

## Safety and data rules (from AGENTS.md — do not relax these)

- Never implement insulin dosing, medication-change guidance, diagnosis, or
  emergency-treatment instructions. Label estimates, predictions, delayed
  readings, and uncertain data clearly in the UI and data model.
- Handle missing, delayed, duplicated, out-of-order, and contradictory
  readings with safe fallbacks — this is core, tested behavior in
  `packages/shared`, not an edge case to skip.
- Never log health data, meal images, access tokens, or personal identifiers
  in plaintext. Audit records must stay redacted.
- Never commit `.env` files, API keys, patient data, or real clinical records.
- Any uploaded photo or external AI response must remain optional,
  consent-aware, schema-validated (Zod), and failure-safe.

## Working process (from AGENTS.md)

Before changing files: inspect `blueprintreasearch.md`, the relevant part of
the tree, framework entry points, and existing tests/build commands; summarize
the current architecture and propose the first implementation phase before
coding. Work in explicit phases, running `npm run check` (or the relevant
workspace's tests/typecheck) after each phase, and report changed files,
results, remaining risks, and the next recommended phase.

Owner preference: when a review or investigation finds a concrete defect,
fix it in the same pass instead of stopping to ask whether to fix it. Add a
regression test where the logic is testable, run `npm run check` and the
mobile bundle smoke check, then report what was fixed. This does not relax
the safety and data rules above; anything needing clinical, privacy, or
product judgement still goes to the owner.

Track implementation status, safety assumptions, and known limitations in
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md),
[docs/WORK_ITEMS.md](docs/WORK_ITEMS.md), and
[docs/KNOWN_RISKS.md](docs/KNOWN_RISKS.md) — update these rather than leaving
risks undocumented. [docs/PHYSICAL_DEVICE_TEST_PLAN.md](docs/PHYSICAL_DEVICE_TEST_PLAN.md)
covers device-only behavior (camera, notification actions, exact-alarm
behavior, restart recovery, timezone changes, background delivery) that can't
be verified any other way.

## Style

TypeScript strict mode in both apps. Two-space indentation, double-quoted
strings, semicolons. `PascalCase` for React components and schemas,
`camelCase` for functions/variables/hooks, kebab-case for multiword filenames
(e.g. `health-events.ts`). Prefer small pure functions for clinical rules, and
validate all external data with Zod before display or storage.
