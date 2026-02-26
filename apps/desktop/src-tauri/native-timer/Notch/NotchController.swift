import AppKit
import SwiftUI
import Combine
import DynamicNotchKit

@MainActor
final class NotchController {
    private enum VisualState: Equatable {
        case hidden
        case compact
        case expanded
        case voiceActive
    }

    private let sessionStore: TimerSessionStore
    private let speechEngine: SpeechEngine
    private var dynamicNotch: DynamicNotch<NotchExpandedView, NotchCompactLeadingView, NotchCompactTrailingView>?

    // Hotkey infrastructure (set from outside via `configureHotkeys`)
    private(set) var modifierTap: ModifierEventTap?
    private(set) var globalHotkey: GlobalHotkey?

    private var pointerPollTimer: Timer?
    private var globalClickMonitor: Any?
    private var localClickMonitor: Any?
    private var globalMouseMoveMonitor: Any?
    private var localMouseMoveMonitor: Any?

    private var hoverExpandWorkItem: DispatchWorkItem?
    private var collapseWorkItem: DispatchWorkItem?
    private var transitionTask: Task<Void, Never>?

    private var state: VisualState = .hidden
    private var stateBeforeVoice: VisualState = .hidden
    private var cancellables = Set<AnyCancellable>()
    private var permissionOnboardingShown = false

    init(sessionStore: TimerSessionStore, speechEngine: SpeechEngine) {
        self.sessionStore = sessionStore
        self.speechEngine = speechEngine
    }

    deinit {
        pointerPollTimer?.invalidate()
        hoverExpandWorkItem?.cancel()
        collapseWorkItem?.cancel()
        transitionTask?.cancel()
        modifierTap?.stop()
        globalHotkey?.unregister()

        if let globalClickMonitor {
            NSEvent.removeMonitor(globalClickMonitor)
        }
        if let localClickMonitor {
            NSEvent.removeMonitor(localClickMonitor)
        }
        if let globalMouseMoveMonitor {
            NSEvent.removeMonitor(globalMouseMoveMonitor)
        }
        if let localMouseMoveMonitor {
            NSEvent.removeMonitor(localMouseMoveMonitor)
        }
    }

    func start() {
        configureNotch()
        installPointerPolling()
        installClickMonitors()
        configureHotkeys()

        VoicePermissions.registerWithSystem()

        sessionStore.$isRunning
            .combineLatest(sessionStore.$accumulated)
            .dropFirst()
            .receive(on: RunLoop.main)
            .sink { [weak self] isRunning, accumulated in
                guard let self else { return }
                guard self.state != .voiceActive else { return }
                let hasSession = isRunning || accumulated > 0
                guard !self.isPointerInHotZoneOrWindow() else { return }

                if hasSession && self.state == .hidden {
                    self.scheduleCompact(delay: 0.0)
                } else if !hasSession && self.state != .hidden {
                    self.scheduleHide(delay: 0.3)
                }
            }
            .store(in: &cancellables)

        speechEngine.onFinalTranscript = { [weak self] transcript in
            self?.handleFinalTranscript(transcript)
        }
        speechEngine.onError = { [weak self] message in
            self?.handleVoiceError(message)
        }

        Task {
            await sessionStore.loadHabits(force: true)
        }
    }

    // MARK: - Hotkey Configuration

    func configureHotkeys() {
        print("🎙️ [Voice] Configuring hotkeys...")

        // Modifier-only hold Command (requires Accessibility)
        if sessionStore.holdCommandEnabled {
            let tap = ModifierEventTap()
            tap.onCommandDown = { [weak self] in
                Task { @MainActor [weak self] in
                    self?.handleCommandDown()
                }
            }
            tap.onCommandUp = { [weak self] in
                Task { @MainActor [weak self] in
                    self?.handleCommandUp()
                }
            }

            if AccessibilityPermission.isTrusted() {
                if tap.start() {
                    modifierTap = tap
                    print("🎙️ [Voice] CGEventTap started (Accessibility granted)")
                } else {
                    print("🎙️ [Voice] CGEventTap failed to start")
                }
            } else {
                modifierTap = tap
                print("🎙️ [Voice] CGEventTap deferred (Accessibility not granted)")
            }
        } else {
            print("🎙️ [Voice] Hold-Command disabled in settings")
        }

        // Fallback hotkey (no Accessibility needed) — uses selected key combo
        if sessionStore.fallbackHotkeyEnabled {
            let option = sessionStore.selectedHotkey
            let hotkey = GlobalHotkey(option: option)
            hotkey.onToggle = { [weak self] in
                print("🎙️ [Voice] \(option.displayLabel) hotkey fired")
                Task { @MainActor [weak self] in
                    self?.handleFallbackHotkeyToggle()
                }
            }
            if hotkey.register() {
                globalHotkey = hotkey
                print("🎙️ [Voice] \(option.displayLabel) hotkey registered successfully")
            } else {
                print("🎙️ [Voice] \(option.displayLabel) hotkey registration FAILED")
            }
        } else {
            print("🎙️ [Voice] Fallback hotkey disabled in settings")
        }

        sessionStore.onHotkeyChanged = { [weak self] newOption in
            guard let self, let hotkey = self.globalHotkey else { return }
            print("🎙️ [Voice] Hotkey changed to \(newOption.displayLabel), re-registering...")
            if hotkey.reregister(option: newOption) {
                print("🎙️ [Voice] \(newOption.displayLabel) hotkey re-registered successfully")
            } else {
                print("🎙️ [Voice] \(newOption.displayLabel) hotkey re-registration FAILED")
            }
        }
    }

    // MARK: - Voice Flow: Hold Command

    private func handleCommandDown() {
        guard sessionStore.holdCommandEnabled else { return }
        guard state != .voiceActive else { return }

        if !AccessibilityPermission.isTrusted() {
            showPermissionOnboarding()
            return
        }

        startVoiceListening()
    }

    private func handleCommandUp() {
        guard sessionStore.voiceMode == .listening else { return }
        stopVoiceListening()
    }

    // MARK: - Voice Flow: Fallback Hotkey Toggle

    private func handleFallbackHotkeyToggle() {
        print("🎙️ [Voice] handleFallbackHotkeyToggle called, voiceMode=\(sessionStore.voiceMode)")
        guard sessionStore.fallbackHotkeyEnabled else { return }

        switch sessionStore.voiceMode {
        case .listening:
            stopVoiceListening()
        case .inactive:
            startVoiceListening()
        default:
            break
        }
    }

    // MARK: - Voice Lifecycle

    private func startVoiceListening() {
        print("🎙️ [Voice] startVoiceListening called")
        print("🎙️ [Voice] Permissions: mic=\(VoicePermissions.microphoneStatus), speech=\(VoicePermissions.speechStatus)")

        guard VoicePermissions.allAuthorized else {
            let msg = VoicePermissions.missingPermissionMessage ?? "Permissions required"
            print("🎙️ [Voice] Missing permissions – opening Settings. \(msg)")
            VoicePermissions.openRelevantSettings()
            sessionStore.voiceMode = .error(message: msg)
            showVoiceNotch()
            scheduleVoiceDismiss(delay: 5.0)
            return
        }

        print("🎙️ [Voice] Permissions OK, starting speech engine")
        stateBeforeVoice = state
        sessionStore.voiceMode = .listening
        showVoiceNotch()
        speechEngine.startListening()
    }

    private func stopVoiceListening() {
        speechEngine.stopListening()
        sessionStore.voiceMode = .processing
    }

    private func handleFinalTranscript(_ transcript: String) {
        guard !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            sessionStore.voiceMode = .error(message: "No speech detected")
            scheduleVoiceDismiss(delay: 2.0)
            return
        }

        let resolved = sessionStore.resolveHabit(from: transcript)

        if sessionStore.confirmBeforeLog {
            sessionStore.voiceMode = .confirm(transcript: transcript, habitID: resolved?.id)
        } else if let habit = resolved {
            Task { await confirmVoiceLog(habitID: habit.id, transcript: transcript) }
        } else {
            sessionStore.voiceMode = .confirm(transcript: transcript, habitID: nil)
        }
    }

    private func handleVoiceError(_ message: String) {
        sessionStore.voiceMode = .error(message: message)
        scheduleVoiceDismiss(delay: 2.5)
    }

    func confirmVoiceLog(habitID: String, transcript: String) async {
        sessionStore.voiceMode = .processing
        let success = await sessionStore.voiceLog(habitID: habitID, transcript: transcript)
        if success {
            sessionStore.voiceMode = .inactive
            restoreStateBeforeVoice()
        } else {
            sessionStore.voiceMode = .error(message: "Log failed")
            scheduleVoiceDismiss(delay: 2.0)
        }
    }

    func cancelVoice() {
        speechEngine.cancel()
        sessionStore.voiceMode = .inactive
        restoreStateBeforeVoice()
    }

    private func showPermissionOnboarding() {
        guard !permissionOnboardingShown else { return }
        permissionOnboardingShown = true
        stateBeforeVoice = state
        sessionStore.voiceMode = .permissionsRequired
        showVoiceNotch()
    }

    func dismissPermissionOnboarding() {
        permissionOnboardingShown = false
        sessionStore.voiceMode = .inactive
        restoreStateBeforeVoice()
    }

    func retryEventTapAfterPermission() {
        permissionOnboardingShown = false
        sessionStore.voiceMode = .inactive

        if AccessibilityPermission.isTrusted(), let tap = modifierTap {
            if !tap.isRunning {
                _ = tap.start()
            }
            restoreStateBeforeVoice()
        }
    }

    // MARK: - Voice Helpers

    private func showVoiceNotch() {
        guard let dynamicNotch, let screen = activeScreen else { return }
        state = .voiceActive
        transitionTask?.cancel()
        transitionTask = Task {
            await dynamicNotch.expand(on: screen)
        }
    }

    private func restoreStateBeforeVoice() {
        let target = stateBeforeVoice
        stateBeforeVoice = .hidden
        guard let screen = activeScreen else {
            transitionToHidden()
            return
        }

        switch target {
        case .compact:
            transition(to: .compact, on: screen)
        case .expanded:
            transition(to: .expanded, on: screen)
        case .hidden, .voiceActive:
            transitionToHidden()
        }
    }

    private func scheduleVoiceDismiss(delay: TimeInterval) {
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self else { return }
            if case .error = self.sessionStore.voiceMode {
                self.cancelVoice()
            }
        }
    }

    private func configureNotch() {
        let initialStyle: DynamicNotchStyle = .notch(topCornerRadius: 15, bottomCornerRadius: 24)

        let notch = DynamicNotch(
            hoverBehavior: [],
            style: initialStyle,
            expanded: {
                NotchExpandedView(
                    store: self.sessionStore,
                    speechEngine: self.speechEngine,
                    onVoiceLog: { [weak self] habitID, transcript in
                        guard let self else { return }
                        Task { await self.confirmVoiceLog(habitID: habitID, transcript: transcript) }
                    },
                    onVoiceCancel: { [weak self] in
                        self?.cancelVoice()
                    },
                    onOpenAccessibility: { [weak self] in
                        AccessibilityPermission.openAccessibilitySettings()
                        self?.dismissPermissionOnboarding()
                    },
                    onUseFallbackHotkey: { [weak self] in
                        self?.dismissPermissionOnboarding()
                    },
                    onDismissPermissions: { [weak self] in
                        self?.dismissPermissionOnboarding()
                    }
                )
            },
            compactLeading: { NotchCompactLeadingView(store: self.sessionStore) },
            compactTrailing: { NotchCompactTrailingView(store: self.sessionStore) }
        )

        dynamicNotch = notch
    }

    private func installPointerPolling() {
        pointerPollTimer?.invalidate()
        pointerPollTimer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handlePointerHoverTick()
            }
        }
    }

    private func installClickMonitors() {
        globalClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleClick(at: NSEvent.mouseLocation)
            }
        }

        localClickMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            guard let self else { return event }
            self.handleClick(at: NSEvent.mouseLocation)
            return event
        }

        globalMouseMoveMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved]) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handlePointerHoverTick()
            }
        }

        localMouseMoveMonitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { [weak self] event in
            self?.handlePointerHoverTick()
            return event
        }
    }

    // MARK: - Click Handling

    private func handleClick(at point: NSPoint) {
        guard state != .voiceActive else { return }
        guard let screen = screenFor(point: point) else { return }
        let inCompact = compactTriggerZone(on: screen).contains(point)
        let inExpanded = expandedInteractionZone(on: screen).contains(point)

        if inCompact {
            switch state {
            case .hidden:
                scheduleCompact(delay: 0)
            case .compact:
                scheduleExpanded(on: screen, delay: 0)
            case .expanded:
                scheduleCompact(delay: 0)
            case .voiceActive:
                break
            }
            return
        }

        if inExpanded && (state == .expanded || state == .voiceActive) {
            return
        }

        switch state {
        case .expanded:
            scheduleCompact(delay: 0)
        case .compact:
            scheduleHide(delay: 0.08)
        case .hidden, .voiceActive:
            break
        }
    }

    // MARK: - Hover Handling

    private func handlePointerHoverTick() {
        guard state != .voiceActive else { return }
        let point = NSEvent.mouseLocation

        guard let screen = screenFor(point: point) else {
            if state != .hidden {
                scheduleHide(delay: 0.20)
            }
            return
        }

        let inCompact = compactTriggerZone(on: screen).contains(point)
        let inExpanded = expandedInteractionZone(on: screen).contains(point)

        switch state {
        case .hidden:
            if inCompact {
                scheduleCompact(delay: 0.02)
            }

        case .compact:
            if inCompact || inExpanded {
                collapseWorkItem?.cancel()
            } else {
                scheduleHide(delay: 0.35)
            }

        case .expanded:
            if inCompact || inExpanded {
                collapseWorkItem?.cancel()
            } else {
                scheduleCompact(delay: 0.25)
            }

        case .voiceActive:
            break
        }
    }

    private func isPointerInHotZoneOrWindow() -> Bool {
        let point = NSEvent.mouseLocation
        guard let screen = screenFor(point: point) else { return false }
        let inCompact = compactTriggerZone(on: screen).contains(point)
        let inExpanded = expandedInteractionZone(on: screen).contains(point)

        if state == .hidden { return inCompact }
        return inCompact || inExpanded
    }

    // MARK: - Scheduling

    private func scheduleExpanded(on screen: NSScreen, delay: TimeInterval) {
        collapseWorkItem?.cancel()
        guard state != .expanded else { return }
        hoverExpandWorkItem?.cancel()

        let item = DispatchWorkItem { [weak self] in
            self?.transition(to: .expanded, on: screen)
        }
        hoverExpandWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func scheduleCompact(delay: TimeInterval) {
        hoverExpandWorkItem?.cancel()
        collapseWorkItem?.cancel()

        guard state != .compact else { return }

        let item = DispatchWorkItem { [weak self] in
            guard let self, let screen = self.activeScreen else { return }
            self.transition(to: .compact, on: screen)
        }
        collapseWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func scheduleHide(delay: TimeInterval) {
        hoverExpandWorkItem?.cancel()
        collapseWorkItem?.cancel()

        guard state != .hidden else { return }

        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.transitionToHidden()
        }
        collapseWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    // MARK: - Transitions

    private var activeScreen: NSScreen? {
        let point = NSEvent.mouseLocation
        return screenFor(point: point) ?? NSScreen.main ?? NSScreen.screens.first
    }

    private func transition(to destination: VisualState, on screen: NSScreen) {
        guard let dynamicNotch else { return }
        guard state != destination else { return }

        state = destination
        transitionTask?.cancel()
        transitionTask = Task {
            switch destination {
            case .expanded, .voiceActive:
                await dynamicNotch.expand(on: screen)
            case .compact:
                await dynamicNotch.compact(on: screen)
            case .hidden:
                await dynamicNotch.hide()
            }
        }
    }

    private func transitionToHidden() {
        guard let dynamicNotch else { return }
        guard state != .hidden else { return }

        state = .hidden
        transitionTask?.cancel()
        transitionTask = Task {
            await dynamicNotch.hide()
        }
    }

    // MARK: - Geometry

    private func screenFor(point: NSPoint) -> NSScreen? {
        NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    private func notchHotZone(on screen: NSScreen) -> NSRect {
        var notchWidth: CGFloat = 220
        var notchHeight: CGFloat = 30

        if #available(macOS 12.0, *) {
            if let left = screen.auxiliaryTopLeftArea?.width,
               let right = screen.auxiliaryTopRightArea?.width
            {
                notchWidth = max(140, screen.frame.width - left - right)
            }

            if screen.safeAreaInsets.top > 0 {
                notchHeight = screen.safeAreaInsets.top
            } else {
                notchHeight = screen.frame.maxY - screen.visibleFrame.maxY
            }
        } else {
            notchHeight = screen.frame.maxY - screen.visibleFrame.maxY
        }

        let width = max(120, notchWidth)
        let height = max(22, notchHeight)
        return NSRect(
            x: round(screen.frame.midX - width / 2),
            y: round(screen.frame.maxY - height),
            width: width,
            height: height
        )
    }

    private func compactTriggerZone(on screen: NSScreen) -> NSRect {
        let hotZone = notchHotZone(on: screen)
        let width = max(hotZone.width + 80, 220)
        let height = max(hotZone.height + 14, 38)
        return NSRect(
            x: round(screen.frame.midX - width / 2),
            y: round(screen.frame.maxY - height),
            width: width,
            height: height
        )
    }

    private func expandedInteractionZone(on screen: NSScreen) -> NSRect {
        let width: CGFloat = min(screen.frame.width - 20, 420)
        let height: CGFloat = 180
        let y = max(
            screen.visibleFrame.minY + 8,
            round(screen.frame.maxY - height - 4)
        )
        return NSRect(
            x: round(screen.frame.midX - width / 2),
            y: y,
            width: width,
            height: height
        )
    }
}
