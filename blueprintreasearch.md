# Diabetes Coaching App Blueprint Research

## Purpose

This document distills the main points from **Diabetes App Development Research.md** into a practical product and engineering blueprint. It is research guidance, not a substitute for clinical validation, regulatory review, or advice from a qualified healthcare professional.

## 1. Product vision

The proposed application is a multimodal diabetes-management platform that combines:

- Continuous Glucose Monitor (CGM) data.
- Blood Glucose Meter (BGM) readings.
- Meal-photo analysis and carbohydrate estimation.
- Exercise and activity recognition.
- Medication schedules, adherence prompts, and predictive modeling.
- Mobile, smartwatch, and cloud synchronization.

The core value is a unified timeline that helps users understand how glucose, food, activity, and medication interact. The system should provide decision support and safety alerts, while avoiding unsafe autonomous treatment decisions until the product has appropriate clinical evidence and regulatory authorization.

## 2. Sensor and data integration

### Bluetooth Low Energy

- Use BLE GATT for compatible BGMs and local glucose devices.
- Support the ISO/IEEE 11073-10417 glucose-meter profile where devices expose it.
- Discover the Glucose Service (`0x1808`) and subscribe to the relevant characteristics:
  - Glucose Measurement (`0x2A18`) for readings and timestamps.
  - Glucose Feature (`0x2A51`) for device capabilities.
  - Record Access Control Point (`0x2A52`) for historical-record retrieval.
  - Glucose Measurement Context (`0x2A34`) when available for meal or exercise context.
- Parse little-endian, variable-length payloads and handle optional fields based on the packet flags.
- Correctly interpret IEEE 11073 short-float values and reserved values such as NaN, not-at-resolution, and infinity states.
- On reconnection, request stored records through RACP so readings collected while offline are not lost.
- Build a device-compatibility layer because manufacturers vary in pairing, permissions, payload behavior, and supported features.

### Proprietary CGM cloud integrations

- Commercial CGMs may restrict direct sensor connections and require approved cloud or health-platform integrations.
- Use OAuth 2.0 for authorized services such as Dexcom-style APIs.
- Design for retrospective data: cloud CGM feeds may have delays and should not be treated as real-time control telemetry.
- Perform an initial historical import, then incremental synchronization from the last accepted timestamp.
- Use rate-limited polling where webhooks are unavailable; make the polling interval configurable.
- Consider Apple Health and Android Health Connect as intermediary repositories for supported CGM, BGM, medication, and wearable data.
- Clearly label each reading with source, timestamp, timezone, freshness, and confidence.

### Smartwatch and edge devices

- Treat the phone as the primary coordinator, with watch apps providing glanceable status, alerts, and activity data.
- Support direct watch or sensor bridges only where the hardware and manufacturer permissions allow it.
- Plan for intermittent connectivity, battery constraints, duplicated readings, and delayed synchronization.
- Do not make a watch display the sole safety channel for urgent medical alerts.

## 3. Physiological modeling of glucose data

### Interstitial-fluid lag

- CGMs measure glucose in interstitial fluid, not directly in blood.
- Blood-to-interstitial glucose lag is commonly several minutes and can increase during rapid rises, falls, meals, exercise, or medication action.
- The app must preserve this distinction in its data model and user interface.
- Predictive logic should use trend, rate of change, recent events, and sensor freshness rather than treating one CGM value as an exact current blood-glucose value.
- During suspected hypoglycemia, rapid exercise, or rapidly changing glucose, the app should encourage confirmation with a BGM when appropriate and follow the user’s clinician-provided treatment plan.

### Accuracy and calibration

- Track MARD and other accuracy measures during validation, but do not use MARD as the only quality metric.
- Evaluate directional bias, error during rapid change, hypoglycemia detection, missing data, and time synchronization.
- Store calibration provenance and prevent unsafe or ambiguous calibration workflows.
- Only allow calibration when the device manufacturer permits it and the reading is physiologically stable; reject or defer calibration during rapid trend changes.
- Flag sensor artifacts, compression-related anomalies, implausible jumps, stale data, and conflicting BGM/CGM readings.

### Data-quality states

Every glucose observation should have an explicit state, such as:

- `valid` — usable for display and approved calculations.
- `delayed` — known source delay or stale synchronization.
- `estimated` — model-derived rather than directly measured.
- `suspect` — possible artifact or conflicting data.
- `missing` — no usable observation in the expected interval.

Safety-critical logic should fail safely when data is missing, delayed, or suspect.

## 4. Food recognition and carbohydrate estimation

### Image recognition

- Use a nutrition-intelligence service or validated model to identify foods and return structured nutrition data.
- Capture carbohydrates, fiber, sugars, protein, fats, relevant micronutrients, allergens, and confidence scores where available.
- Preserve the original image only when necessary, with explicit consent and retention controls.
- Allow users to correct food identity, serving size, ingredients, and nutrition values.

### Portion and volume estimation

- Food classification is easier than estimating portion size from a single 2D image.
- Prefer depth-capable phones, multiple viewpoints, known-size references, or user-entered serving information when available.
- Treat photo-based carbohydrate values as estimates, not ground truth.
- Display uncertainty and provide a quick correction flow.
- Handle mixed dishes, sauces, cooking methods, restaurant meals, packaged foods, and culturally diverse foods.
- Keep a user-specific food history to improve speed and consistency, without silently changing logged values.

### Meal event model

Each meal record should support:

- Image and recognized food items.
- Estimated portions and carbohydrate range.
- User corrections and confidence.
- Meal time and eating duration.
- Absorption characteristics, such as high-fat or high-fiber meals.
- Linkage to subsequent glucose trends for retrospective learning.

## 5. Exercise and kinematic tracking

- Combine accelerometer and gyroscope data from phones and watches.
- Use activity-classification models to distinguish walking, cycling, boxing, strength movements, and other relevant activities.
- Track duration, intensity, onset, end time, and confidence rather than only steps.
- Let users confirm or correct automatically detected activities.
- Account for exercise-related glucose uptake, counter-regulatory hormones, delayed effects, and post-exercise hypoglycemia risk.
- During intense exercise, treat CGM readings with additional caution because blood-to-interstitial lag may be greater.
- Store raw high-frequency motion data only when needed for model development; otherwise retain derived features to reduce privacy and storage risk.

## 6. Predictive modeling and medication support

### Prediction engine

- Combine glucose history, CGM trend, BGM readings, meals, exercise, medication events, sleep, and other consented context.
- Use physiology-informed constraints so predictions remain plausible under known glucose-insulin dynamics.
- Model delayed effects of meals, exercise, and medication rather than assuming an immediate linear response.
- Return a forecast range, confidence, contributing factors, and data freshness—not just a single number.
- Detect out-of-distribution situations and fall back to conservative, explainable behavior.
- Separate prediction from treatment recommendation. Any dosing or medication-change feature requires clinical oversight, validation, and regulatory assessment.

### Medication adherence

- Support medication name, dose prescribed by the clinician, schedule, timing flexibility, and confirmation status.
- Record taken, skipped, snoozed, unknown, and user-corrected events.
- Avoid inferring that a medication was taken merely because the user dismissed a notification.
- Provide a clear escalation path for missed or high-risk events based on the user’s care plan.

## 7. Mobile notification infrastructure

- Medication reminders must remain reliable during background suspension, battery optimization, and intermittent connectivity.
- Use platform-supported scheduling and notification APIs, including exact-alarm capabilities only where justified and permitted.
- Request permissions with clear explanations and provide fallbacks when permissions are denied.
- Use local notifications for scheduled events and push notifications for server-originated updates.
- Make urgent alerts distinctive, actionable, and accessible; avoid notification overload.
- Include a test-notification flow and an audit trail showing when a notification was scheduled, delivered, opened, dismissed, or missed.
- Do not depend on one channel for critical safety communication; define appropriate backup behavior.

## 8. Security, privacy, and compliance

- Treat glucose, medication, activity, and dietary data as sensitive health information.
- Apply data minimization, encryption in transit and at rest, least-privilege access, and strong account security.
- Never place raw glucose values, meal images, tokens, or personal identifiers in application logs.
- Keep consent, data-sharing, device authorization, and retention records auditable.
- Support revocation, export, correction, and secure deletion workflows.
- Separate personally identifiable information from analytics data where practical.
- Establish retention limits for raw images, sensor payloads, model inputs, and audit records.
- Review HIPAA, GDPR/UK GDPR, New Zealand Privacy Act, medical-device, and local clinical-software obligations as applicable to the launch market.

## 9. Recommended architecture

### Client applications

- Mobile client for onboarding, dashboard, data entry, meal capture, medication confirmation, and alerts.
- Watch client for concise readings, activity capture, and notification acknowledgement.
- Local encrypted store for offline-first ingestion and queued synchronization.
- Device adapter layer for BLE, health repositories, vendor APIs, and watch bridges.

### Backend services

- Authentication and consent service.
- Device and integration service.
- Ingestion pipeline with deduplication and source precedence rules.
- Canonical health-event store with immutable raw-event references and normalized observations.
- Prediction service with model versioning, feature provenance, confidence, and rollback support.
- Notification orchestration service.
- Audit, privacy, support, and observability services.

### Canonical event fields

At minimum, store:

- Event ID and user ID.
- Event type and source device/service.
- Value and unit.
- Device timestamp and server-received timestamp.
- Timezone and synchronization status.
- Data-quality state and confidence.
- Model version when derived.
- Consent and retention classification.

## 10. Safety and validation requirements

- Begin with a non-diagnostic wellness and logging MVP before adding high-risk recommendations.
- Validate each device integration independently before combining streams.
- Test delayed, duplicated, missing, contradictory, and out-of-order data.
- Test low-glucose, rapidly changing glucose, exercise, meal, medication, offline, reboot, permission-denied, and battery-saving scenarios.
- Conduct clinical review of user-facing wording, thresholds, escalation behavior, and emergency guidance.
- Maintain a clear distinction between educational information, trend interpretation, clinician-configured reminders, and medical advice.
- Establish human review and incident-response processes before launch.

## 11. Suggested delivery phases

### Phase 1 — Safe foundation

- Account, consent, profile, manual glucose/BGM entry, medication logging, and a unified timeline.
- Basic notifications, audit logging, data export, and privacy controls.

### Phase 2 — Validated integrations

- One supported CGM integration, one BGM BLE integration, and one health-platform integration.
- Offline sync, deduplication, data-quality labeling, and device troubleshooting.

### Phase 3 — Context capture

- Meal photo workflow with human correction.
- Exercise detection with user confirmation.
- Watch dashboard and activity synchronization.

### Phase 4 — Explainable prediction

- Forecast ranges and trend explanations.
- Retrospective insights linking meals, activity, medication events, and glucose outcomes.
- Clinical evaluation before enabling any treatment-related recommendation.

## 12. Key risks to manage

- CGM delay can make a current-looking value clinically misleading.
- Vendor APIs, permissions, pricing, and access tiers can change.
- Photo-based portion estimates may be materially wrong.
- Exercise can cause both immediate and delayed glucose effects.
- Background restrictions can make reminders unreliable if not engineered and tested carefully.
- Combining multiple sources can create duplicate or conflicting readings.
- Sensitive health data can be exposed through logs, analytics, screenshots, backups, or third-party processors.
- Predictive outputs may appear more authoritative than their evidence supports; uncertainty and limitations must be visible.

## Source

This blueprint summarizes **Diabetes App Development Research.md**, including its discussion of BLE glucose services, proprietary CGM APIs, smartwatch bridges, interstitial-fluid physiology, CGM accuracy and calibration, computer-vision nutrition estimation, IMU exercise classification, physiology-informed prediction, mobile alarms, and privacy considerations.
