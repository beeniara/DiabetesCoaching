# Physical-Device Acceptance Plan

Record the app build, device model, OS version, locale, timezone, tester, date, observed result, screenshots/video, and pass/fail for every case. Repeat the full matrix for each supported OS major version and at least one low-memory device.

## 1. Install, consent, and local data

- Fresh install shows no invented glucose value or personal history.
- Logging, reminder creation, and photo intake are blocked before consent.
- Accepting consent survives a normal restart; revoking it blocks new collection and disables/cancels reminder plans.
- Create one event of every type, edit targets, create a reminder, queue a photo, then confirm **Delete all local data** removes the profile, events, target overrides, plans, scheduled notifications, shelf records/photos, and secure server token.
- Force-close the app during deletion where test tooling permits, relaunch, and verify any remaining state is reported and can be deleted safely.
- Verify airplane-mode startup, logging, timeline, reminders, and export work without the server.

## 2. Manual data and quality handling

- Check lower/upper validation boundaries for glucose, meal macro ranges, activity duration/intensity, medication text, and care targets.
- Run BLE, cloud, meal, IMU, combined, duplicate, conflict, and rate-limit simulations; verify source, timestamps, quality, freshness, lag, conflict, and issue labels.
- Change the device clock/timezone and verify occurrence/receipt times remain intelligible and reminder schedules reconcile on the next launch.
- Share the clinician-review summary only by explicit action; verify its destination and deletion controls.

## 3. Notifications

- Test first-run permission allow, deny, and deny-then-settings-enable paths.
- On Android, test with exact-alarm access allowed and denied; verify the app never promises punctual delivery when capability is unavailable or unknown.
- Verify create, edit time, enable, disable, delete, and manual resync against the operating-system scheduled-notification list.
- From foreground, background, terminated, and cold-start states, test Taken, Skipped, and Snooze 10 min. Each action must create at most one acknowledgement and must never give missed-dose advice.
- Test screen locked, Doze/idle, battery saver, OEM battery optimization, force-stop/relaunch, and at least one overnight schedule.
- Reboot the phone and verify/reconcile schedules. Change timezone and daylight-saving boundary if supported by test tooling.
- Deny notification permission after plans exist; verify visible limited status and safe recovery.

## 4. Camera, photos, and shelf analysis

- Test camera and photo-library allow, deny, limited-library, cancel, and settings-recovery paths.
- Verify a selected photo is copied into app-owned storage and remains local until **Analyze** is pressed in a configured server mode.
- Test missing/corrupt photo, unsupported format, and over-6-MB analysis input; verify bounded, retryable errors without a crash.
- Verify deleting a shelf item removes both its app-owned image and record, while refusing to delete a non-app-owned URI.
- Test mock, server validation, and GPT modes. For each server mode test offline, timeout, wrong URL, wrong token, malformed response, server `503`, and retry after recovery.
- Verify server/audit output never contains a bearer token, data URL, email, photo path, caption, health value, or personal identifier.

## 5. Network and server deployment

- Verify loopback development and the chosen physical-device route (trusted LAN, VPN, or HTTPS) with the server bound only as broadly as intended.
- Confirm disallowed browser origins receive no CORS permission and protected routes reject missing, short-configured, and incorrect tokens.
- Confirm the production firewall/reverse proxy does not expose the service beyond the approved network and applies TLS where required.
- Rotate the test token and verify the old token immediately fails and the new token can be cleared from the device.

## 6. Accessibility and usability

- Complete the main tasks with VoiceOver and TalkBack: consent, log glucose, inspect limitations, create/acknowledge reminder, queue/delete photo, export, and delete data.
- Test the largest supported text size, display zoom, landscape where enabled, dark/light themes, contrast, focus order, labels, error announcements, and touch target sizes.
- Confirm critical limitations do not rely on colour alone and remain visible without scrolling past an action that depends on them.
- Conduct a comprehension session with representative users and clinicians for target context, freshness, quality, uncertainty, reminder limits, and escalation wording.

## 7. Release evidence

- Attach successful `npm ci`, `npm run check`, Expo compatibility/config, native Android/iOS build, and store preflight outputs to the release record.
- Record independent clinical, privacy, security, and accessibility approvals with reviewer, version, date, findings, and disposition.
- Re-run dependency and secret scans on the exact signed source tree.
- Mark the release blocked if any safety-critical case fails, is untested, or has ambiguous evidence.
