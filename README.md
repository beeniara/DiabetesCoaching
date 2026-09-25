# Diabetes Coaching App

Koru Companion is an Auckland-focused Type 2 diabetes wellness and decision-support app. It supports personal tracking and clinician conversations; it does not diagnose, calculate doses, change medication, or manage emergencies.

The mobile app works offline for its core features. Personal records are stored locally by default, and an optional self-hosted Express service can validate or analyse shelf photos when the user explicitly requests it.

## What works

- Local profile, explicit consent, consent revocation, and complete local-data deletion.
- Configurable clinician-reviewed glucose target context.
- Manual glucose, meal, activity, and medication acknowledgement logging.
- A unified quality-aware timeline with freshness, delayed-data, conflict, and interstitial-fluid lag labels.
- Local medication plans, notifications, Taken/Skipped/Snooze actions, permission status, and schedule reconciliation.
- Clinician-review summary generation and explicit operating-system sharing.
- BLE GATT glucose (`0x1808` / `0x2A18`), delayed/rate-limited cloud, volumetric meal, and IMU exercise simulations through the same normalization and synchronization path intended for future adapters.
- A Coach tab with weekly activity goals and progress, active-day streaks, encouragement with a concrete next step, quick-pick activity logging with type, and an exercise safety note.
- Sourced general wellness tips (activity, nutrition, sleep, stress, foot care, regular checks, hydration, habits) with a tip of the day and suggestions driven by the last 7 days of data.
- Daily wellbeing check-ins (sleep, mood, stress, water, foot check, notes) with a 7-day review, plus the usual New Zealand check intervals and a "when to contact your care team" list that routes to 111, Healthline, GP, or 1737.
- Local shelf-photo capture/selection, app-owned storage, retryable queue, explicit deletion, and schema-validated mock or server analysis.
- Authenticated optional local server with bounded requests, explicit CORS, rate limiting, redacted audit records, strict GPT output validation, and fail-closed configuration.

Simulated device and cloud integrations are test harnesses, not vendor integrations. See [Known risks and release gates](docs/KNOWN_RISKS.md) before any real-world deployment.

## Architecture

- `apps/mobile` — Expo/React Native client, SQLite source of truth, secure token storage, local notifications, photos, and sharing.
- `apps/local-server` — optional Express service and the only component permitted to hold an external AI key.
- `packages/shared` — Zod contracts, deterministic safety/context rules, synchronization, mocks, and Vitest tests.
- `blueprintreasearch.md` — authoritative product and implementation blueprint.

## Install and verify

Use a current Node.js LTS release and npm, then run from the repository root:

```sh
npm ci
npm run check
```

`npm run check` runs every workspace test followed by strict TypeScript checks. The final Expo bundle smoke command used during development is:

```sh
npm exec --workspace @diabetes-coaching/mobile expo export -- --platform android --output-dir .expo-smoke
```

## Run the mobile app

```sh
npm run dev:mobile
```

Open the QR code with a supported development client or emulator. Camera, notification actions, exact-alarm behaviour, restart recovery, timezone changes, and background delivery must be accepted on physical devices; follow [the physical-device test plan](docs/PHYSICAL_DEVICE_TEST_PLAN.md).

## Run the optional local server

Protected routes require a random token of at least 24 characters. The server binds to loopback by default on port `8787`.

PowerShell:

```powershell
$env:LOCAL_SERVER_API_KEY = "replace-with-a-long-random-secret"
npm run dev:server
```

macOS/Linux:

```sh
LOCAL_SERVER_API_KEY="replace-with-a-long-random-secret" npm run dev:server
```

For a physical phone on the same trusted network, set `HOST=0.0.0.0`, allow only the required firewall path, and configure the phone with the computer's LAN URL, such as `http://192.168.1.20:8787`. The development build permits local cleartext HTTP; a deployment beyond a trusted development LAN should use authenticated HTTPS or a VPN. Do not expose this service directly to the public internet.

Optional server settings:

- `LOCAL_SERVER_ALLOWED_ORIGINS` — comma-separated browser origins; no origin is allowed by default.
- `LOCAL_SERVER_RATE_LIMIT_PER_MINUTE` — protected-route request limit; default `60`, minimum `10`.
- `LOCAL_SERVER_AUDIT_LOG` — JSONL audit path. Records are redacted and never contain photos, bearer tokens, or health payloads.
- `OPENAI_API_KEY` — enables explicit GPT shelf-photo analysis. Without it, that route returns `503` and the local queue stays retryable.
- `OPENAI_SHELF_MODEL` — optional model override; defaults to `gpt-4o`.
- `SHELF_AI_PROVIDER` — `openai` (default) or `ollama`. With `ollama`, AI shelf analysis uses a local model and photos stay on your network; no OpenAI key is needed.
- `OLLAMA_URL` — Ollama origin; defaults to `http://127.0.0.1:11434`. Point it only at a machine you control: a hosted Ollama endpoint would send your photos off your network.
- `OLLAMA_SHELF_MODEL` — a vision model you have pulled; defaults to `qwen2.5vl:7b`. On a machine with less memory, try `gemma3:4b`.

To use Ollama: install it from ollama.com, run `ollama pull qwen2.5vl:7b`, then start the server with `SHELF_AI_PROVIDER=ollama`. Pick **AI analysis** as the server mode in the app. A local model can take a minute or more per photo on a machine without a GPU, and is usually less accurate than GPT-4o at reading labels; every answer is still checked against the strict shelf-analysis schema.

Save the URL and token in the mobile Settings tab and use **Test connection**. The token is stored with `expo-secure-store`, not in SQLite. Shelf images are sent only after the user selects **Analyze** in a configured server mode.

## Local data and privacy

Health events, plans, target context, profile/consent state, and shelf history live in SQLite. Shelf photos are copied into app-owned document storage. The server token lives in platform secure storage. The Settings tab can revoke consent, clear server settings, or delete all app-owned local data after confirmation.

Mobile operating-system backups, device compromise, exports, screenshots, notification previews, and AI-provider retention require an explicit privacy assessment for the intended deployment. This repository contains no production identity system, clinical record integration, or remote backup.

## Safety

Coaching content is general wellness information drawn from Health NZ, Healthify, Diabetes NZ, NZSSD, ADA, and WHO public guidance, linked in-app. It is not yet clinician-reviewed and never replaces an individual care plan. All values and trends are contextual estimates. Targets must be confirmed with the user's treating clinician. The app never supplies missed-dose advice or treatment instructions. In New Zealand, the UI offers `111` for emergencies and Healthline `0800 611 116` for free 24/7 health advice; approved release copy still requires local clinical review.

The implementation status is in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), remaining external work is in [docs/WORK_ITEMS.md](docs/WORK_ITEMS.md), and material limitations are in [docs/KNOWN_RISKS.md](docs/KNOWN_RISKS.md).
