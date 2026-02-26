import Cocoa
import CoreGraphics

/// Captures global Command-key press/release via a CGEventTap on `.flagsChanged`.
/// Requires Accessibility permission (`AXIsProcessTrusted`).
///
/// Fires `onCommandDown` only after Command is held *alone* for `holdDelay`
/// seconds, avoiding false-positives when the user presses ⌘⇧L or other
/// multi-modifier shortcuts.
final class ModifierEventTap {
    var onCommandDown: (() -> Void)?
    var onCommandUp: (() -> Void)?

    /// Minimum seconds Command must be held alone before firing `onCommandDown`.
    var holdDelay: TimeInterval = 0.30

    private(set) var isRunning = false
    private var tap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var commandIsDown = false
    private var holdTimer: DispatchWorkItem?
    private var holdFired = false
    private var restartAttempts = 0
    private let maxRestartAttempts = 5

    func start() -> Bool {
        guard !isRunning else { return true }

        let eventMask: CGEventMask = (1 << CGEventType.flagsChanged.rawValue)
            | (1 << CGEventType.tapDisabledByTimeout.rawValue)
            | (1 << CGEventType.tapDisabledByUserInput.rawValue)

        let refcon = Unmanaged.passUnretained(self).toOpaque()

        guard let newTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: modifierEventTapCallback,
            userInfo: refcon
        ) else {
            return false
        }

        tap = newTap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, newTap, 0)
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: newTap, enable: true)
        isRunning = true
        restartAttempts = 0
        return true
    }

    func stop() {
        if let tap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        }
        tap = nil
        runLoopSource = nil
        isRunning = false
        cancelHold()
    }

    // MARK: - Internal

    fileprivate func handleFlags(_ flags: CGEventFlags) {
        let cmdOnly = flags.contains(.maskCommand)
            && !flags.contains(.maskShift)
            && !flags.contains(.maskAlternate)
            && !flags.contains(.maskControl)

        if cmdOnly && !commandIsDown {
            commandIsDown = true
            holdFired = false
            startHoldTimer()
        } else if cmdOnly && commandIsDown {
            // Command still held alone – no-op (timer is already ticking)
        } else if !cmdOnly && commandIsDown {
            // Command released or another modifier appeared
            commandIsDown = false
            cancelHold()
            if holdFired {
                holdFired = false
                onCommandUp?()
            }
        }
    }

    private func startHoldTimer() {
        cancelHold()
        let item = DispatchWorkItem { [weak self] in
            guard let self, self.commandIsDown else { return }
            self.holdFired = true
            self.onCommandDown?()
        }
        holdTimer = item
        DispatchQueue.main.asyncAfter(deadline: .now() + holdDelay, execute: item)
    }

    private func cancelHold() {
        holdTimer?.cancel()
        holdTimer = nil
    }

    fileprivate func handleTapDisabled() {
        guard let tap, restartAttempts < maxRestartAttempts else {
            stop()
            return
        }
        restartAttempts += 1
        let delay = min(Double(restartAttempts) * 0.25, 1.0)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.isRunning else { return }
            CGEvent.tapEnable(tap: tap, enable: true)
        }
    }
}

private func modifierEventTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let refcon else { return Unmanaged.passRetained(event) }
    let handler = Unmanaged<ModifierEventTap>.fromOpaque(refcon).takeUnretainedValue()

    switch type {
    case .flagsChanged:
        handler.handleFlags(event.flags)
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        handler.handleTapDisabled()
    default:
        break
    }

    return Unmanaged.passRetained(event)
}
