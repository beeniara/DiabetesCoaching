# Safety Review Checklist

This checklist records the current release boundary for the diabetes coaching app. It is not a clinical approval; it is a working gate for internal review.

## Clinical boundaries

- The app is wellness and decision support only.
- It must not calculate doses, change medication, diagnose, or manage emergencies.
- Any target ranges, reminders, or explanations must remain clinician-reviewable and user-configurable.

## Privacy and security

- Do not store raw health data, meal images, access tokens, or identifiers in plaintext logs.
- Keep optional local-server access behind `LOCAL_SERVER_API_KEY`.
- Keep GPT-backed shelf analysis off unless `OPENAI_API_KEY` is explicitly configured on the local server.
- Preserve redacted audit records for protected server routes.

## Reliability

- Validate delayed, duplicate, out-of-order, and conflicting readings.
- Treat interstitial-fluid glucose as potentially lagged during rapid change, meals, and exercise.
- Keep reminder scheduling dependent on OS permissions and device verification, not background assumptions.

## Usability and accessibility

- Keep freshness, estimates, and limitations visible in the UI.
- Preserve high-contrast text, readable labels, and clear button names.
- Show when shelf analysis came from the local mock path versus the local server.

## Release blocker reminders

- Confirm Android and iOS behavior on physical devices.
- Confirm local server auth, audit logging, and GPT analysis on a trusted LAN only.
- Verify final Auckland escalation wording and contact paths before any real-user deployment.
