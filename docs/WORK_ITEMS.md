# Work Items

This document tracks the implementation order for the diabetes coaching app scaffold.

## 1. Mobile foundation

- Wire the Expo app to a stable navigation shell.
- Add local state handling for goals, targets, and session context.
- Keep all user data on-device by default.

## 2. Local persistence

- Replace the placeholder storage layer with a durable SQLite-backed schema.
- Store glucose readings, reminders, shelf conversations, and review notes.
- Add migration/version handling.

## 3. Offline reminders

- Make medication reminders deterministic and device-local.
- Define repeat rules, local notification categories, and quiet hours.
- Add reminder acknowledgement and missed-dose logging without medical advice.

## 4. Grocery image workflow

- Add a chat-like image capture and review flow for shelf analysis.
- Validate strict JSON output from the analysis contract.
- Preserve clinician-review boundaries and safety notices.

## 5. Local backend

- Finalize the locally hosted server API surface.
- Add explicit CORS, auth, and LAN/VPN deployment assumptions.
- Keep optional GPT-4o integration behind a strict JSON validation gate.

## 6. Clinical rules engine

- Encode the target ranges and medication context already defined in shared code.
- Add clinician-configurable thresholds and review flags.
- Prevent autonomous diagnosis, medication changes, or emergency handling.

## 7. Safety and review

- Add user-facing disclaimers and escalation text.
- Add review flows for out-of-range readings and urgent-care prompts.
- Confirm the release boundary with a clinician before wider use.

## 8. Verification

- Add unit tests for the shared clinical rules and JSON validation.
- Add type checks for the mobile and server packages.
- Run install/build checks once the dependency set is finalized.
