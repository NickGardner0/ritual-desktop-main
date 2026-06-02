# Ritual Local Link: Multipeer Connectivity and Apple Multicast Entitlement Plan

**Date:** 2026-05-21  
**Status:** Product and engineering plan, ready for implementation scoping  
**Primary recommendation:** Build `Ritual Local Link`, a local iPhone-to-Mac transport layer using Apple Multipeer Connectivity. Start with local HealthKit and biometrics sync into desktop context, then expand into live quantified-self surfaces and local interventions.

---

## 1. Executive Summary

Apple approved access to the Multicast Networking entitlement. That entitlement is useful, but it should not be the product abstraction Ritual exposes or the first low-level API Ritual builds around. The product abstraction should be **Ritual Local Link**: a private, nearby-device connection between the iOS companion and the Ritual desktop app.

The recommended transport is **Multipeer Connectivity**, not raw UDP multicast. Multipeer gives Ritual the important pieces needed for a consumer product:

- Bonjour/local-network discovery.
- User-visible pairing and trust.
- Encrypted `MCSession` transport.
- Reliable messages and resource transfer for larger payloads.
- A native Apple pattern that maps well to iPhone-to-Mac companion workflows.

The multicast entitlement still matters because iOS local-network discovery and Bonjour service use are entitlement and permission sensitive. Ritual should add the entitlement and required plist declarations to the iOS companion, but build the user-facing feature around a higher-level local sync layer.

Ritual is a strong fit for this because it already has both sides of the personal data graph:

- iOS companion: HealthKit, Apple Watch metrics, BLE heart-rate broadcast support, Screen Time, offline queues, and background sync.
- Desktop: local watcher, recorder, OCR, app/activity sessions, browser heartbeat, local databases, AI retrieval, and dashboard surfaces.

The strategic opportunity is to connect those two sides without requiring the cloud to be the only path. The strongest initial product value is **body-state data from iPhone fused with desktop context from Mac**.

---

## 2. Current Ritual Baseline

### iOS companion

Ritual's iOS companion already has the capture and queueing systems needed for a local transport layer:

- `HealthKitManagerV2` reads Apple Health metrics such as steps, active energy, heart rate, HRV, sleep, respiratory data, and related normalized metrics.
- `BackgroundSyncManagerV2` handles HealthKit background delivery, foreground sync, rate limiting, tracked metric caching, and incremental windows.
- `OfflineSyncQueue` persists failed sync payloads for retry with retention and backoff.
- `WhoopBroadcastService`, `BLEManager`, and `BiometricsLocalStore` capture BLE heart-rate samples and sessions from heart-rate broadcast devices.
- `ScreenTimeManager` and the Screen Time report extension can produce device usage snapshots when the Screen Time capability is enabled.
- `CompanionFeatureFlags.p2pSyncEnabled` already reserves "direct iPhone<->Mac P2P sync over Multipeer Connectivity" and is currently off until entitlement support is available.

### Desktop app

Ritual desktop already owns the local context side:

- Tauri desktop shell coordinates the hosted dashboard and native sidecars.
- `ritual-watcher` captures app usage, active-window metadata, browser heartbeat data, accessibility context, session boundaries, AFK/lock/sleep events, and local activity sessions.
- `ritual-recorder` captures visual context through screenshots, OCR, deduping, thumbnails, and local database writes.
- Local database layers store context snapshots, sessions, OCR frames, search chunks, activity events, and retrieval documents.
- Dashboard and chat layers expose personal-data query surfaces, summaries, and habit context.

### Cloud path

The current cloud sync path remains important and should not be removed:

- iOS registers with the backend and sends signed Apple Health ingest payloads.
- Backend validates device identity, idempotency, and metrics.
- Metrics are stored in Turso and converted into habit logs where appropriate.
- Tinybird and dashboard layers use the ingested data for analytics and user-facing views.

Local Link should become a fast, private, opportunistic path. Cloud remains the durable fallback and reconciliation path.

---

## 3. Shared Architecture: Ritual Local Link

### Product model

Ritual Local Link is a paired-device connection between one iPhone and one Mac for a single Ritual user. It should appear in product surfaces as:

- iOS: "Sync with Mac" or "Ritual Local Link" under companion settings/status.
- Desktop: "Local Link" under settings and a small status indicator in the dashboard.
- User promise: nearby iPhone data can reach the Mac directly, privately, and quickly. Cloud sync remains available when the local link is unavailable.

### Transport choice

Use **Multipeer Connectivity**:

- iOS advertises a service type named `ritual-sync`.
- macOS browses for `ritual-sync`.
- Desktop invites the iPhone.
- iOS accepts only after a user-visible pairing approval.
- Both sides communicate through an encrypted `MCSession`.

Do not start with raw UDP multicast. Raw multicast would add more protocol, security, discovery, packet-loss, and background-behavior complexity without delivering a better first user experience.

### Apple capability and plist changes

Add to the iOS companion target:

- Entitlement: `com.apple.developer.networking.multicast`.
- Info.plist `NSLocalNetworkUsageDescription`.
- Info.plist `NSBonjourServices` with:
  - `_ritual-sync._tcp`
  - `_ritual-sync._udp`

Keep HealthKit, Bluetooth, BackgroundTasks, associated domains, and optional Screen Time capabilities unchanged.

Desktop macOS requirements:

- Ensure the desktop app has network client/server permissions where relevant for the packaged Mac app.
- If the Multipeer implementation runs in a Swift helper process, ensure the helper is packaged, signed, and allowed to use local networking.
- Add a user-facing local-network explanation in the desktop UI even if macOS does not show the same prompt behavior as iOS.

### Desktop bridge decision

Build the macOS side as a **Swift Local Link sidecar** packaged with the Tauri app.

Rationale:

- Multipeer Connectivity is a native Apple framework and is easiest to implement safely in Swift.
- Ritual desktop already uses native sidecar-style processes for watcher/recorder responsibilities.
- Keeping Multipeer in Swift avoids forcing Rust to bridge directly into Objective-C/Swift frameworks.

Recommended desktop bridge shape:

- `ritual-local-link` Swift sidecar owns `MCNearbyServiceBrowser`, `MCSession`, pairing, receive/send, and peer diagnostics.
- Tauri launches and supervises the sidecar the same way it supervises other native background services.
- Sidecar exposes events to Tauri through a loopback IPC channel using a per-launch random token.
- Tauri forwards Local Link status and payload events to the dashboard UI through existing command/event patterns.

The sidecar should not own high-level product decisions. It should be a transport and native-permission boundary. Tauri/dashboard code decides what to show and how to persist received data.

### Pairing and trust model

Local Link must not auto-accept arbitrary nearby devices.

Flow:

1. Desktop browses for nearby iOS advertisers.
2. Desktop shows "Pair iPhone" with the discovered device display name.
3. Desktop generates a short pairing code.
4. iOS shows the Mac name and pairing code.
5. User confirms on iOS.
6. Both sides exchange:
   - Ritual user ID hash or scoped account identifier.
   - Device ID.
   - Capabilities.
   - Local Link public identity.
   - A local sync secret or trust token.
7. Both sides persist a trusted peer record.

Trust storage:

- iOS: Keychain for local link secrets and trusted Mac identity.
- Desktop: macOS Keychain or encrypted local app storage for trusted iPhone identity and local link secret.

The first MVP can support one paired iPhone per desktop user. Multi-phone and household/team cases are out of scope.

### Message envelope

All application messages should use a shared envelope:

```json
{
  "schemaVersion": 1,
  "messageId": "uuid",
  "deviceId": "ritual-ios-device-id",
  "sentAt": "2026-05-21T12:34:56Z",
  "kind": "healthDeltaBatch",
  "requiresAck": true,
  "payload": {}
}
```

Required fields:

- `schemaVersion`: starts at `1`; increment only for breaking wire changes.
- `messageId`: globally unique per message, used for idempotency.
- `deviceId`: Ritual device ID or local link device ID.
- `sentAt`: ISO timestamp from sender.
- `kind`: message family.
- `payload`: kind-specific payload.

Optional fields:

- `requiresAck`: default `false`; true for batches, queue drains, pairing changes, and stateful writes.
- `correlationId`: for responses such as `syncAck` or `syncError`.
- `compressed`: true when payload is compressed.
- `chunk`: metadata for large chunked payloads if `sendResource` is not used.

### Message families

Use these message kinds for v1:

- `hello`: transport-level greeting after session connect.
- `capabilities`: supported schema versions, message kinds, max payload size, feature flags, and app/build versions.
- `pairingRequest`: desktop-to-iOS pairing proposal.
- `pairingAccepted`: iOS-to-desktop pairing confirmation.
- `pairingRejected`: iOS-to-desktop rejection or timeout.
- `healthDeltaBatch`: HealthKit-derived metric batch.
- `biometricSample`: live or near-live heart-rate/biometric sample.
- `biometricSession`: session start/end and device metadata.
- `screenTimeSnapshot`: optional Screen Time summary snapshot.
- `syncAck`: acknowledgement for idempotent writes.
- `syncError`: structured failure with retryability.
- `keepalive`: optional liveness message for diagnostics.

### Idempotency and conflict handling

Use two levels of idempotency:

- Transport idempotency: `messageId`.
- Domain idempotency: existing client event IDs, HealthKit sample identifiers, metric time windows, or offline queue payload IDs.

Rules:

- Receiver stores recently processed `messageId` values and ignores duplicates.
- Health metric writes should reuse existing backend/client idempotency keys where available.
- If iOS sends a payload locally and later sends the same payload to cloud, backend reconciliation should treat it as the same event, not a second measurement.
- If Mac receives data locally but cloud later has a newer corrected value, cloud reconciliation may update the local row according to existing metric freshness rules.

### Reliability behavior

Multipeer should be treated as opportunistic:

- If connected, Local Link can be preferred for low-latency delivery.
- If disconnected, iOS continues using current cloud/offline queue behavior.
- If a local transfer starts and fails, the sender retains the payload for retry or cloud fallback.
- Payloads over a configured threshold should use `MCSession.sendResource` or chunking instead of one large data message.

Recommended initial thresholds:

- Inline JSON message: up to 100 KB.
- Resource transfer or chunking: over 100 KB.
- Live samples: small inline messages batched every 1 to 5 seconds if needed.

---

## 4. The Six Use Cases

## Use Case 1: Direct iPhone -> Mac Biometrics Stream

### User value

Ritual can show what is happening in the user's body while they work on the Mac. This is valuable because desktop context alone can say "you were in Slack for 42 minutes"; biometrics can help explain whether that block looked calm, stressful, energizing, or draining.

Useful outcomes:

- Live heart-rate status in desktop.
- Work sessions enriched with body-state context.
- Better post-hoc summaries such as "your heart rate rose during repeated context switching" or "deep work blocks were more stable after your walk."
- A more differentiated quantified-self product than a normal habit tracker.

### Current system fit

iOS already has:

- BLE heart-rate broadcast ingestion through `WhoopBroadcastService` and `BLEManager`.
- Local heart-rate sample/session persistence through `BiometricsLocalStore`.
- Upload queueing through `BiometricsUploadQueue`.

Desktop already has:

- App/activity session capture through watcher.
- Local context sessions and timeline storage.
- Dashboard surfaces that can show current status and recent activity.

### Implementation

iOS:

- Add `RitualLocalLinkService`.
- When paired and connected, publish `biometricSession` and `biometricSample` messages from the existing biometrics pipeline.
- Keep current cloud upload queue unchanged.
- Add a rate limiter so live samples do not flood the session.

Desktop:

- Local Link sidecar receives biometric messages and forwards them to Tauri.
- Tauri persists samples into a local biometrics table or an existing metrics table with source `local_link`.
- Watcher/context code can join samples to active context sessions by timestamp.
- Dashboard shows live state and recent biometric trend.

MVP:

- Live heart rate.
- Active biometric session status.
- Connected device name.
- Last sample timestamp.

Non-MVP:

- HRV streaming if unavailable in real time.
- Complex stress scoring.
- AI interventions.

### Risks

- BLE source may disconnect while Local Link remains connected.
- Live HealthKit is not always truly live; BLE heart-rate stream is better for immediate samples.
- Users may perceive live biometrics as sensitive. UI copy should make clear the data stays local unless existing cloud sync is enabled.

---

## Use Case 2: Local-First HealthKit Sync

### User value

HealthKit data can reach the Mac without waiting for backend ingest, cloud availability, or scheduled sync. This is especially useful for privacy-conscious users and for users who keep Ritual open on their Mac all day.

Useful outcomes:

- Faster desktop freshness for Apple Health metrics.
- Local operation when the internet is degraded.
- A stronger local-first privacy story.
- Less reliance on cloud round trips for the user's own nearby devices.

### Current system fit

iOS already knows:

- Which metrics are tracked.
- How to fetch incremental windows.
- How to queue failed sync payloads.
- How to sign and send cloud ingest requests.

Desktop already has:

- Local SQLite/libSQL storage patterns.
- Dashboard metric and habit surfaces.
- Local context/session timeline.

### Implementation

iOS:

- Convert existing normalized metric payloads into `healthDeltaBatch` messages.
- Include existing client event IDs where possible.
- Use local link first when connected and paired.
- Preserve current backend ingest path as fallback.

Desktop:

- Receive `healthDeltaBatch`.
- Validate schema version and trusted device.
- Persist a local copy of normalized metrics.
- Mark locally received records as pending cloud reconciliation unless already known synced.
- Optionally call existing backend ingest routes later using the user's authenticated desktop session, or wait for iOS to upload through the existing path.

MVP metrics:

- steps
- active energy
- heart rate summary
- HRV summary
- sleep summary

MVP behavior:

- Send small daily delta batches.
- Desktop displays "fresh from iPhone" state.
- Cloud fallback remains the default when Local Link is unavailable.

### Risks

- Double-writing metrics if local and cloud paths both ingest the same records.
- Mismatched user identity if a phone pairs with the wrong desktop account.
- HealthKit data corrections can arrive after initial sync.

Mitigation:

- Require account match during pairing.
- Use idempotency keys and source sample IDs.
- Keep a received-message ledger on desktop.

---

## Use Case 3: Pairing and Device Trust

### User value

Pairing makes setup simpler and safer. The user should not need to type a LAN IP, configure local backend URLs, or understand networking. Ritual should show nearby devices and allow explicit trust.

Useful outcomes:

- Cleaner iOS companion setup.
- Better internal testing workflow.
- More confidence that local health data goes only to the user's Mac.
- Foundation for every other Local Link use case.

### Current system fit

The current iOS app uses Clerk, device registration, Keychain credentials, and backend API config. Local Link should complement that, not replace it immediately.

### Implementation

iOS:

- Advertise `ritual-sync` only when the user opens Local Link settings or enables the feature.
- Show discovered/connecting Mac state.
- Show pairing code confirmation.
- Persist trusted Mac identity in Keychain.

Desktop:

- Browse for nearby iPhones.
- Show candidate devices.
- Generate a short pairing code.
- Persist trusted iPhone identity.
- Expose status and diagnostics in settings.

Pairing acceptance criteria:

- A random nearby Ritual install cannot connect without user approval.
- Pairing is scoped to the current Ritual account.
- User can revoke trust from either device.
- Pairing survives app restart.

MVP:

- One iPhone paired to one Mac.
- Manual revoke on both sides.
- Pairing diagnostics: local network permission, service visible, session connected, last message, last error.

### Risks

- Nearby test/dev devices can create confusing discovery lists.
- Local-network permission denial can look like "nothing works."
- Device display names may expose personal names.

Mitigation:

- Use clear permission education.
- Show troubleshooting states.
- Allow custom local device display name later if needed.

---

## Use Case 4: Live Quantified-Self Cockpit

### User value

This turns Ritual from a historical dashboard into a real-time personal operating system. The user can see how today is unfolding across body, work, attention, and habits.

Useful outcomes:

- "Now" view on desktop.
- Current focus/app context plus live body data.
- Today's HealthKit deltas.
- Recent Screen Time or phone activity where available.
- Stronger daily feedback loops.

### Current system fit

Desktop already has:

- active app/window state
- browser context
- OCR/context snapshots
- activity sessions
- chat/retrieval surfaces

iOS can contribute:

- live or recent heart rate
- HealthKit deltas
- Screen Time snapshots
- iPhone-side status such as charging, last sync, or permission state if exposed

### Implementation

Dashboard:

- Add a "Now" panel or Local Link card.
- Show Local Link connection status, iPhone freshness, live heart rate, active desktop session, and today's selected metrics.
- Link from the panel to settings and historical context.

Data model:

- Join desktop context sessions and local iOS metrics by timestamp.
- Mark local-only data visibly until cloud reconciliation completes.
- Keep derived summaries separate from raw sample storage.

MVP:

- Connected iPhone status.
- Live BPM.
- Current desktop app/session.
- Today's steps/active energy if synced locally.
- Last local sync time.

Non-MVP:

- Full new dashboard redesign.
- Complex readiness score.
- Continuous health analytics model.

### Risks

- A cockpit can become noisy or gimmicky if it does not support decisions.
- Live state should not imply medical interpretation.

Mitigation:

- Keep copy descriptive, not diagnostic.
- Make the panel compact and actionable.
- Prefer simple facts first, then later insights.

---

## Use Case 5: Local Interventions

### User value

Local interventions let Ritual nudge the user at the right time without waiting for server-side jobs. The most valuable version is not generic reminders; it is context-aware prompts based on current Mac behavior and nearby iPhone data.

Examples:

- High context switching plus elevated heart rate: "You've jumped between Slack, browser, and Cursor for 18 minutes. Want to start a 25-minute focus block?"
- Long sedentary block plus no movement: "You've been at the desk for 90 minutes. Log a quick walk or stand break?"
- Late-day screen activity plus poor sleep: "You slept less than usual and are still in high-friction apps. Want to wind down?"

### Current system fit

Desktop watcher can detect:

- app switching
- active app/session duration
- AFK/return
- browser activity
- context windows

iOS can provide:

- heart rate
- movement/steps
- sleep summaries
- Screen Time summaries

### Implementation

Desktop:

- Add a local rule engine for conservative intervention candidates.
- Use Local Link state as an input.
- Show prompts through existing desktop UI or native notifications.
- Track dismissal, acceptance, and snooze locally.

iOS:

- Send the necessary live/recent signals.
- Do not decide desktop intervention timing in v1.

MVP rules:

- High context switching for a sustained period.
- Sedentary duration threshold when steps are low.
- Elevated heart rate while active desktop context is fragmented.

Guardrails:

- No medical claims.
- No intervention during meetings/presentations if detectable.
- Quiet hours and maximum daily prompt cap.
- User can disable all local interventions.

### Risks

- Bad prompts feel invasive.
- Health-based nudges are sensitive.
- False positives can reduce trust.

Mitigation:

- Ship after pairing, local sync, and cockpit.
- Start with internal-only feature flag.
- Use conservative thresholds and low daily caps.

---

## Use Case 6: Offline Sync Queue Drain

### User value

If the phone has data but cannot reach the backend, and the Mac is nearby, Ritual can still preserve and display the data locally. If the Mac has internet later, it can help reconcile with cloud.

Useful outcomes:

- Less stale data.
- More reliable capture in poor connectivity.
- A stronger "your data is not trapped on one device" story.

### Current system fit

iOS already has `OfflineSyncQueue` with:

- persisted payloads
- retry timing
- retention
- attempt counts
- network availability awareness

Desktop already has:

- persistent local storage
- background native processes
- cloud/backend access through authenticated desktop app flows

### Implementation

iOS:

- Add a queue-drain mode when Local Link is connected.
- Send queued payload metadata first.
- Send payloads requiring ack.
- Mark a queue item locally delivered only after receiving `syncAck`.
- Keep the item eligible for cloud retry until cloud reconciliation confirms durable backend ingest, unless product explicitly supports Mac-local-only mode.

Desktop:

- Receive queued payloads.
- Persist them as local pending sync records.
- Deduplicate by queue ID/client event ID/message ID.
- Display pending reconciliation status.
- Later forward to backend or mark reconciled when backend data arrives.

MVP:

- Drain HealthKit ingest queue payloads only.
- No Screen Time or biometrics queue drain in the first pass.
- No destructive removal from iOS queue until ack is received.

### Risks

- Incorrect ack semantics can lose data.
- Desktop may receive payloads but fail to upload later.
- Queue drain could duplicate cloud ingest.

Mitigation:

- Treat desktop ack as "Mac received and persisted", not "cloud ingested."
- Keep separate local and cloud reconciliation states.
- Use existing client event IDs and backend idempotency.

---

## 5. Recommended Implementation Phases

## Phase 0: Permissions and Scaffolding

Goal: prepare the app without exposing a user-facing transport.

Build:

- Add iOS multicast entitlement and Bonjour/local-network plist keys.
- Keep `CompanionFeatureFlags.p2pSyncEnabled` off by default.
- Add a desktop-side feature flag, for example `RITUAL_LOCAL_LINK_ENABLED`.
- Add empty Local Link settings surfaces on iOS and desktop behind flags.
- Add telemetry/debug logging for local-network permission states.

Acceptance:

- iOS target builds with entitlement and plist entries.
- Local Link UI remains hidden unless feature flag is enabled.
- Existing HealthKit, BLE, Screen Time, and cloud sync continue unchanged.

## Phase 1: Pairing + Hello/Capabilities

Goal: prove reliable discovery, pairing, trust, and diagnostics.

Build:

- `RitualLocalLinkService` on iOS with advertiser/session state.
- Swift `ritual-local-link` sidecar on desktop with browser/session state.
- Pairing code flow.
- Trusted peer persistence on both devices.
- `hello`, `capabilities`, `pairingRequest`, `pairingAccepted`, `pairingRejected`, `keepalive`, `syncError`.
- Dashboard/iOS status views and troubleshooting states.

Acceptance:

- Same-account iPhone and Mac can pair.
- Pairing persists across restart.
- Revoking trust prevents reconnection.
- Wrong-account pairing is blocked.
- Permission denial shows a clear explanation.

## Phase 2: Local-First HealthKit Sync

Goal: make Local Link useful with bounded, low-risk data.

Build:

- `healthDeltaBatch` message from existing normalized HealthKit sync payloads.
- Desktop local persistence for received HealthKit delta batches.
- Idempotency ledger.
- Local freshness display in dashboard.
- Cloud fallback unchanged.

Acceptance:

- Desktop receives and displays today's selected HealthKit metrics over Local Link.
- Duplicate messages do not double-write.
- If Local Link disconnects, iOS continues cloud/offline sync.
- Backend reconciliation does not create duplicate habit logs.

## Phase 3: Live Biometrics Stream

Goal: connect body state to desktop context.

Build:

- `biometricSession` and `biometricSample` messages.
- Rate-limited sample forwarding from `WhoopBroadcastService`.
- Desktop persistence of local biometric samples.
- Timestamp join between samples and active context sessions.
- Minimal dashboard live-state display.

Acceptance:

- Desktop shows live BPM and last sample time while iOS receives BLE heart-rate data.
- UI remains responsive during sample streaming.
- Disconnect/reconnect does not corrupt session state.
- Samples are marked by source and sync state.

## Phase 4: Cockpit + Interventions

Goal: turn local data into a user-facing product surface.

Build:

- Desktop "Now" panel with Local Link, current desktop context, live BPM, and today's selected health metrics.
- Local rules for conservative interventions.
- Notification/prompt controls, daily cap, snooze, disable.
- Internal telemetry for prompt shown/accepted/dismissed.

Acceptance:

- Users can understand current body + work state at a glance.
- Interventions are feature-flagged and capped.
- No medical claims appear in copy.
- Dismissing or disabling interventions is respected.

## Phase 5: Offline Queue Drain

Goal: improve reliability when cloud is unavailable.

Build:

- Queue metadata exchange.
- Acked queue payload transfer.
- Desktop pending reconciliation store.
- Backend reconciliation path using existing idempotency.
- UI state for "received locally, pending cloud sync."

Acceptance:

- Queued HealthKit payloads can drain to desktop.
- Disconnect during transfer resumes without data loss.
- Duplicate queue items are ignored.
- Desktop and iOS do not both create duplicate backend records.

---

## 6. Public and Internal Interfaces

### iOS: `RitualLocalLinkService`

Responsibilities:

- Own Multipeer advertiser and session.
- Manage local-network permission-triggering operations.
- Start/stop advertising based on feature flag, user setting, and app state.
- Persist trusted Mac identity.
- Send message envelopes.
- Receive acks/errors.
- Expose connection state to SwiftUI.

Suggested states:

- `disabled`
- `permissionNeeded`
- `advertising`
- `pairing`
- `pairedDisconnected`
- `connecting`
- `connected`
- `error`

Suggested methods:

- `startAdvertising()`
- `stopAdvertising()`
- `acceptPairing(request:)`
- `rejectPairing(request:)`
- `sendHealthDeltaBatch(_:)`
- `sendBiometricSample(_:)`
- `sendScreenTimeSnapshot(_:)`
- `disconnect()`
- `revokeTrustedMac()`

### Desktop: `RitualLocalLinkReceiver`

Responsibilities:

- Own Multipeer browser and session inside the Swift sidecar.
- Browse for nearby iOS peers.
- Invite selected peer.
- Manage pairing code flow.
- Persist trusted iPhone identity.
- Forward connection events and received envelopes to Tauri.
- Receive send commands from Tauri when desktop-to-iOS messages are needed.

Suggested states:

- `disabled`
- `browsing`
- `pairing`
- `pairedDisconnected`
- `connected`
- `receiving`
- `error`

Suggested sidecar events:

- `localLink.peerFound`
- `localLink.pairingRequested`
- `localLink.connected`
- `localLink.disconnected`
- `localLink.messageReceived`
- `localLink.error`

### Tauri/dashboard bridge

Responsibilities:

- Launch and supervise Local Link sidecar.
- Translate sidecar events into dashboard-visible state.
- Persist received data through local DB commands.
- Expose Local Link status to React.
- Keep feature hidden when desktop flag is off.

Suggested commands/events:

- `local_link_status`
- `local_link_start_browsing`
- `local_link_pair_device`
- `local_link_revoke_device`
- `local_link_received_health_batch`
- `local_link_received_biometric_sample`

### Shared payload contracts

Create a small shared contract document or generated model set for:

- envelope
- capabilities
- pairing messages
- health delta batch
- biometric sample/session
- screen time snapshot
- ack/error

Keep payloads aligned with existing normalized metric models where possible. Do not invent a second HealthKit metric schema if the current ingest payload can be reused.

---

## 7. Product Value by User Segment

### Privacy-first quantified-self users

Value:

- Nearby sync without cloud as the only path.
- Clear local-first story for sensitive health/context data.
- Better trust for users who are cautious about health and screen data.

Most relevant use cases:

- Local-first HealthKit sync.
- Offline queue drain.
- Pairing and trust.

### Heavy desktop workers

Value:

- Body state and work context in one timeline.
- Faster insight into how work patterns affect physiology.
- More useful summaries of focus, stress, breaks, and context switching.

Most relevant use cases:

- Direct biometrics stream.
- Live cockpit.
- Local interventions.

### Existing Ritual habit users

Value:

- Less manual logging.
- Fresher Apple Watch metrics.
- More reliable habit projections from wearable data.

Most relevant use cases:

- Local-first HealthKit sync.
- Offline queue drain.
- Cockpit.

### Internal/product development users

Value:

- Easier local testing of iOS-to-desktop features.
- Less dependence on staging backend URLs for iteration.
- A foundation for future device-to-device experiments.

Most relevant use cases:

- Pairing and trust.
- HealthKit sync.
- Local diagnostics.

---

## 8. Risks, Constraints, and Rollout

### Apple platform constraints

- Local-network prompts can appear only after network operations trigger them.
- Users may deny local-network permission.
- Multipeer works best when both apps are active or recently active.
- iOS background execution is limited; Local Link cannot be treated as a guaranteed always-on daemon.
- Bonjour service strings must be declared correctly in `NSBonjourServices`.

### Privacy constraints

- Health, biometrics, Screen Time, and desktop context are highly sensitive.
- Pairing must require explicit user approval.
- Users must be able to revoke trust.
- The UI must distinguish local-only data from cloud-synced data.
- Copy should avoid medical interpretation.

### Technical constraints

- Tauri/Rust cannot own Multipeer as cleanly as Swift.
- Sidecar packaging/signing must be validated in release builds, not only dev.
- Duplicate ingestion is the main data correctness risk.
- Reconnection and partially transferred payloads need explicit acks.

### Rollout plan

1. Internal-only flag.
2. Developer devices only.
3. TestFlight group with diagnostics enabled.
4. Paid beta users who opt in.
5. General availability only after cloud fallback and duplicate protection are proven.

### Kill switches

Add remote or config-driven kill switches for:

- all Local Link functionality
- live biometrics stream
- local interventions
- offline queue drain

If Local Link fails, the app should degrade to current cloud sync behavior.

---

## 9. Success Metrics

Activation:

- Local Link settings view open rate.
- Pairing start rate.
- Pairing completion rate.
- Local-network permission allow rate.

Reliability:

- Local session connection success rate.
- Average session duration.
- Messages sent/acked per session.
- Local sync success rate.
- Error rate by message kind.
- Disconnect rate during transfer.

Freshness:

- Time from iPhone sample capture to desktop visibility.
- Time from HealthKit update to desktop metric update.
- Reduction in stale Apple Health metrics on desktop.

Product value:

- Repeat Local Link usage after first pair.
- "Now" panel engagement.
- Intervention acceptance/dismissal/snooze rates.
- Local Link users' retention compared with non-Local-Link users.
- Query quality improvements for questions that combine health and desktop context.

Data correctness:

- Duplicate metric write rate.
- Local-vs-cloud reconciliation mismatches.
- Queue drain success and replay rate.

---

## 10. Test Plan

### Entitlements and plist

- Validate iOS generated entitlements include `com.apple.developer.networking.multicast`.
- Validate iOS Info.plist includes `NSLocalNetworkUsageDescription`.
- Validate iOS Info.plist includes `_ritual-sync._tcp` and `_ritual-sync._udp` under `NSBonjourServices`.
- Validate existing HealthKit, Bluetooth, BackgroundTasks, associated domains, and optional Screen Time capabilities still build.

### Pairing

- Pair iPhone and Mac on same Wi-Fi.
- Pair iPhone and Mac with Bluetooth/Wi-Fi available but internet disabled.
- Deny local-network permission and confirm the UI shows a recoverable failure.
- Revoke trusted device on iOS and confirm desktop cannot reconnect.
- Revoke trusted device on desktop and confirm iOS returns to unpaired state.
- Attempt wrong-account pairing and confirm it is blocked.

### Message reliability

- Send duplicate `messageId` and confirm receiver ignores the second copy.
- Send duplicate domain event/client event ID and confirm no duplicate metric write.
- Disconnect during `healthDeltaBatch` and confirm retry/fallback behavior.
- Send payload over inline threshold and confirm resource transfer or chunking path is used.
- Send malformed schema version and confirm structured `syncError`.

### HealthKit local sync

- Receive a small HealthKit delta batch and persist it locally.
- Display local metric freshness in desktop.
- Confirm cloud fallback still works when Local Link is disabled.
- Confirm backend reconciliation does not double-create habit logs.

### Live biometrics

- Stream live heart-rate samples from iOS to desktop.
- Confirm desktop UI remains responsive during streaming.
- Stop BLE source while Local Link remains connected and confirm state updates correctly.
- Reconnect BLE source and confirm session state resumes or starts cleanly.

### Offline queue drain

- Create queued iOS payloads while backend is unreachable.
- Connect Local Link and drain queued payloads to desktop.
- Disconnect mid-drain and confirm resume does not double-write.
- Confirm desktop ack means "persisted locally", not "cloud ingested."
- Confirm later cloud reconciliation clears pending state.

### Packaged desktop

- Validate Local Link sidecar is bundled in Tauri dev and release builds.
- Validate sidecar is signed/notarized with the app.
- Validate sidecar launch, crash, restart, and log collection behavior.

---

## 11. Implementation Defaults and Assumptions

- First implementation target is one iPhone paired to one Mac.
- Multipeer Connectivity is the transport. Raw UDP multicast is out of scope for v1.
- Product name is `Ritual Local Link`.
- Highest-value MVP is local HealthKit/biometrics sync into desktop context.
- Local interventions ship only after pairing, sync, and cockpit are reliable.
- Cloud remains the canonical durable fallback and reconciliation path.
- Health and biometric payloads reuse existing normalized metric models where possible.
- Desktop Multipeer implementation uses a Swift sidecar packaged with Tauri.
- Local Link is feature-flagged on both iOS and desktop.
- Local Link never silently pairs with a nearby device.
- Local Link data must be visibly local-only or pending when it has not reconciled with cloud.

---

## 12. Recommended First Ticket Breakdown

1. **iOS capability setup**
   - Add multicast entitlement and local-network Bonjour plist entries.
   - Keep feature hidden behind `p2pSyncEnabled`.

2. **Local Link contract draft**
   - Define message envelope and v1 message kinds.
   - Reuse existing normalized metric payload shapes.

3. **iOS advertiser prototype**
   - Implement `RitualLocalLinkService`.
   - Advertise `ritual-sync`.
   - Expose state to SwiftUI.

4. **macOS sidecar prototype**
   - Implement Swift browser/session sidecar.
   - Forward events to Tauri through local IPC.

5. **Pairing UI and trust**
   - Add pairing code flow.
   - Persist trusted peer identity.
   - Add revoke controls.

6. **Health delta batch MVP**
   - Send selected HealthKit summaries from iOS to desktop.
   - Persist and display local freshness.
   - Add idempotency ledger.

7. **Live biometrics MVP**
   - Forward live BPM and session status.
   - Join samples to desktop context sessions by timestamp.
   - Show compact dashboard live-state card.

This order creates user-visible value while containing risk: first prove trust and transport, then ship low-volume HealthKit data, then stream live biometrics, then add richer cockpit and intervention behavior.
