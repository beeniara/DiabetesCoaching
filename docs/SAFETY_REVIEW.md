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

## Data completeness and personal patterns (for clinician review)

Stored records that can no longer be read (for example after storage corruption or an incompatible legacy row) are excluded from display but never hidden silently:

- The dashboard warns that the timeline and latest reading may be incomplete and reports freshness as `limited` rather than `current`.
- The clinician-review export states how many saved records were not included.
- Stored conflict labels survive reload, conflicting readings are flagged per glucose compartment even with other events logged between them, and trends never compare capillary with interstitial readings.
- The weekly wellbeing review warns that it may be incomplete and withholds "no check-ins" and "no foot checks" prompts that could be false.
- Unreadable reminder plans are reported, and the person can cancel their device reminders and remove them. Readable plans are never changed by that action.

The Coach tab can show a personal after-meal pattern: the typical glucose about 2 hours after meals with movement compared with meals without, from the person's own records, with a not-proof and no-medicine-change caveat.

Questions for the New Zealand clinical reviewer: is the after-meal pattern safe and useful to show, with 5 meals per group and a 0.5 mmol/L threshold? And is the incomplete-data wording clear enough in the export, and should an export with unreadable records carry a stronger caution or be blocked?

## Usability and accessibility

- Keep freshness, estimates, and limitations visible in the UI.
- Preserve high-contrast text, readable labels, and clear button names.
- Show when shelf analysis came from the local mock path versus the local server.

## Release blocker reminders

- Confirm Android and iOS behavior on physical devices.
- Confirm local server auth, audit logging, and GPT analysis on a trusted LAN only.
- Verify final Auckland escalation wording and contact paths before any real-user deployment.
