# Known Risks and Release Gates

This file records material limitations that must remain visible. Passing repository checks does not resolve the external gates below.

## Clinical and product safety

- No independent New Zealand clinical review has been performed. Default target context, warning thresholds, escalation copy, and Healthline/111 placement require approval before use with real patients.
- The app is decision support only. It must not be marketed or configured as a diagnostic, dosing, medication-management, or emergency system.
- Unreadable stored health events, reminder plans, and wellbeing check-ins are counted and shown as data-completeness warnings. This behaviour is verified against real SQLite through the storage layer in development, not yet on a physical device (see the device test plan section 2a).
- Manual entries and mock data can be wrong. Quality labels reduce ambiguity but do not prove measurement accuracy or device provenance.
- The clinician-review export is plain text selected by the user. The receiving application and user control its protection after sharing.

## Coaching content

- Coaching messages, tips, goal defaults, check intervals, and seek-help prompts are general wellness information transcribed from public Health NZ, Healthify, Diabetes NZ, NZSSD, ADA, and WHO pages in September 2026. They have not been clinically reviewed for this app and may not suit every person (for example frailty, neuropathy, pregnancy, kidney disease, or insulin use).
- Weekly activity totals are derived from self-reported or simulated entries and count vigorous minutes double. They are motivation aids, not a clinical measure of fitness or glycaemic effect.
- Wellbeing check-in reviews (sleep, stress, mood) are pattern prompts only. Low-mood prompts point to the GP and 1737; they are not a depression screen.
- Contact prompts list warning signs so the person can decide who to call. They never instruct treatment, and thresholds quoted from public pages (such as 4 mmol/L, 17 mmol/L, or 20 mmol/L) must be confirmed against the person's own care plan.

## Notification reliability

- Local notifications are best-effort. Permission denial, Android exact-alarm policy, Doze/idle modes, battery optimization, force-stop, reboot, timezone changes, OEM restrictions, and iOS scheduling limits can delay or suppress them.
- A saved reminder plan that can no longer be read is not listed and cannot be edited. Its device notification may still fire until the person uses **Remove unreadable plans** or full local deletion. If the device scheduler cannot be queried, a pending snooze from that plan may survive removal; the app says so and points to the operating system's notification settings.
- The app reports known capabilities and reconciles identifiers, but Expo cannot guarantee or continuously prove exact delivery. Medication reminders must never be the only safety mechanism.

## Privacy and local storage

- SQLite health records and app-owned photos are protected by the mobile operating-system sandbox, not an application-level database encryption key.
- Device backup, compromised/unlocked devices, screenshots, notification previews, clipboard/share destinations, and development tooling can expand exposure. Decide backup and managed-device policy before release.
- Full deletion is best-effort across database, files, secure storage, and operating-system schedules. A mid-operation platform failure can leave partial external state and must be retried/verified.
- GPT analysis sends the selected shelf photo and optional caption to the configured OpenAI account only after an explicit action. Provider retention, geography, contractual controls, and consent language require a privacy assessment.

## Server and network

- The local server uses one shared bearer token. It has no user identity, role authorization, token rotation workflow, TLS termination, persistent job queue, or production observability.
- The server binds to `127.0.0.1` by default. LAN access requires an explicit host change and firewall decision.
- Android cleartext traffic is enabled for development LAN access. Any non-development deployment should use authenticated HTTPS or a controlled VPN and should reassess the mobile network-security configuration.
- In-memory rate limiting is per process and is not a distributed denial-of-service control. Do not expose the service directly to the public internet.

## AI and integration quality

- Shelf analysis is an uncertain visual estimate, not a complete label or nutrition assessment. Packaging, portions, ingredients, allergens, and suitability must be confirmed by the user.
- Model availability, behaviour, price, and API schemas can change. Every response is validated, but a schema-valid response can still be factually wrong.
- BLE, cloud, meal-recognition, and IMU features currently simulate integration behaviour. They do not connect to a real glucose meter, CGM vendor, vision service, or motion sensor.

## Accessibility

- Warning banner text is #8A4B08 on #FFF6E8 (6.34:1) with a #C47A19 border (3.19:1 against the banner, 3.42:1 against the card), meeting WCAG 2.1 AA for text and non-text contrast. The app has no dark theme, so `userInterfaceStyle` is `light`: status-bar icons, system dialogs, and the keyboard stay light to match the screens even when the device uses dark mode.
- Banners use `accessibilityRole="alert"` and a polite live region. Android live-region announcement on first appearance and VoiceOver behaviour (no live-region equivalent on iOS) are unverified until the device test plan runs.

## Platform and verification

- Android JavaScript export has been verified; a native signed Android build and iOS build have not. iOS native build verification requires macOS/Xcode.
- Camera, library access, notification actions, cold starts, exact alarms, reboot, idle modes, timezone changes, large text, and screen readers require physical-device testing.
- Automated UI/end-to-end tests are not yet present. Shared rules (including reminder reconciliation decisions and notification capability reporting) and server endpoints have automated coverage, while the native notification calls and mobile flow are protected only by strict compilation and bundle checks.
- The dependency audit currently includes moderate advisories in Expo's build-tool dependency chain. The automated audit proposes an incompatible old Expo downgrade rather than a forward fix; monitor upstream releases and reassess before shipping. Two high-severity advisories are now reported in Expo's native build tooling (`@xmldom/xmldom` via `@expo/plist`/`plist`, and `js-yaml` via `@expo/xcpretty`). They run at build time on the developer machine, not in the shipped app, but must be rechecked and resolved or accepted before release.

## Release gate

Do not distribute this app for unsupervised clinical use until all unchecked items in [WORK_ITEMS.md](WORK_ITEMS.md) are resolved and the [physical-device test plan](PHYSICAL_DEVICE_TEST_PLAN.md) has signed evidence for the supported matrix.
