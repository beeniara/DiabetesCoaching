# Release Work Items

## Completed repository work

- [x] Offline-first profile, consent, local deletion, and SQLite migrations.
- [x] Manual glucose, meal, activity, and medication acknowledgement logging.
- [x] Unified timeline with freshness, source, quality, lag, conflict, and limitation labels.
- [x] Configurable target context and local clinician-review export/share flow.
- [x] Editable local medication reminders with action handling, snooze, capability reporting, and reconciliation.
- [x] Normalization, synchronization, deduplication, ordering, conflict handling, and safe malformed-data rejection.
- [x] BLE/cloud/meal/IMU simulation and failure controls.
- [x] Consent-aware shelf-photo queue, app-owned photo lifecycle, validated results, retry, and deletion.
- [x] Optional authenticated local server, explicit CORS, rate limit, redacted audit trail, and fail-closed AI route.
- [x] Workspace tests, strict type checks, Expo compatibility/config checks, Android bundle smoke build, and loopback server smoke test.
- [x] Setup, deployment, known-risk, and physical-device test documentation.
- [x] Deterministic lifestyle coaching: weekly activity goals and progress, streaks, encouragement, sourced wellness tips, wellbeing check-ins, regular-check reminders, and contact-your-care-team prompts.

## Required before real-user release

- [ ] Execute and sign off [PHYSICAL_DEVICE_TEST_PLAN.md](PHYSICAL_DEVICE_TEST_PLAN.md) on every supported Android and iOS version/device family.
- [ ] Produce native Android and iOS release builds with final package IDs, signing, icon, splash, privacy manifests, and store metadata.
- [ ] Obtain New Zealand clinician approval for target defaults, warning thresholds, Healthline/111 copy, and all limitations.
- [ ] Obtain New Zealand clinician and dietitian review of all coaching copy: activity goal defaults, glucose-friendly habit targets and wording, wellness tips, wellbeing-review messages, regular-check intervals, and the seek-help sign list.
- [ ] Obtain New Zealand clinician approval to show the personal after-meal glucose pattern, including its thresholds, minimum data, and wording, or remove it before release.
- [ ] Complete a privacy impact assessment covering health records, device backups, photos, exports, notifications, retention, deletion, and any AI-provider data controls.
- [ ] Complete a threat model and independent security review for the chosen LAN, VPN, or HTTPS deployment.
- [ ] Complete accessibility testing with VoiceOver/TalkBack, large text, contrast, switch/keyboard navigation where applicable, and cognitive usability review.
- [ ] Decide supported platforms, minimum OS versions, identity model, retention policy, and operational owner.
- [ ] Confirm dependency advisories and supported Expo/React Native versions again immediately before release.

## Future integrations, if required

- [ ] Implement and validate actual BLE Glucose Service packet decoding and device provenance.
- [ ] Implement vendor-approved CGM/cloud authentication, rate-limit, replay, and deletion flows.
- [ ] Add a production identity/authorization model if the local server will serve more than one person.
- [ ] Add encrypted remote backup or clinical-system exchange only after explicit consent, privacy, security, and interoperability design.
- [ ] Add automated native end-to-end tests after the supported device/OS matrix is chosen.
