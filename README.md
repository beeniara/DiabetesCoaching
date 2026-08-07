# Diabetes Coaching App

An Auckland, New Zealand-focused Type 2 diabetes coaching companion. It supports self-management and clinician conversations; it does not diagnose conditions, change medicines, or manage emergencies.

## Starter architecture

- `apps/mobile`: Expo / React Native app. Personal data, reminder schedules, and queued grocery scans stay on-device by default.
- `apps/local-server`: Node / Express server intended to run on the user's local server. It owns optional external AI calls and never embeds an API key in the app.
- `packages/shared`: deterministic clinical-context rules and strict data contracts used by both sides.

## Safety boundary

All targets are clinician-reviewable and configurable. Guidance describes context only, never a dosage or treatment change. The app must always show emergency/urgent-care escalation guidance when a user reports concerning symptoms or a result requires prompt review. It must not claim to replace a GP, diabetes nurse, pharmacist, Healthline, or emergency services.

## Initial guidance context (not an individual care plan)

Default starting context: fasting glucose 6.0–8.0 mmol/L, postprandial glucose under 10.0 mmol/L, and HbA1c generally at or under 53 mmol/mol. These values are defaults only and must be confirmed or changed by the user's treating clinician.

## Planned first release

1. Local profile, configurable targets, manual glucose log, and exportable clinician-review summary.
2. Deterministic device-scheduled medication reminders with acknowledgement; no medicine changes or missed-dose advice.
3. Chat-like grocery-shelf photo workflow: capture, explain what is visible, and queue an optional review. Any GPT-4o response is validated against a strict JSON schema before display.
4. Local-server-only integration boundary, audit-friendly records, and no cloud dependency for core daily tracking.

## Run (after installing dependencies)

```sh
npm install
npm run dev:mobile
# in a separate terminal
npm run dev:server
```

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for decisions, scope, and the staged build plan.
