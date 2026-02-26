import Cocoa
import Carbon.HIToolbox

enum VoiceHotkeyOption: String, CaseIterable {
    case cmdShiftL = "cmd_shift_l"
    case cmdShiftV = "cmd_shift_v"
    case cmdShiftM = "cmd_shift_m"

    var keyCode: UInt32 {
        switch self {
        case .cmdShiftL: return UInt32(kVK_ANSI_L)
        case .cmdShiftV: return UInt32(kVK_ANSI_V)
        case .cmdShiftM: return UInt32(kVK_ANSI_M)
        }
    }

    var modifiers: UInt32 { UInt32(cmdKey | shiftKey) }

    var displayLabel: String {
        switch self {
        case .cmdShiftL: return "⌘⇧L"
        case .cmdShiftV: return "⌘⇧V"
        case .cmdShiftM: return "⌘⇧M"
        }
    }
}

/// Registers a configurable global hotkey via the Carbon Event API.
/// Does NOT require Accessibility permission (unlike CGEventTap).
final class GlobalHotkey {
    var onToggle: (() -> Void)?

    private var hotkeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private(set) var isRegistered = false
    private(set) var currentOption: VoiceHotkeyOption

    fileprivate static let hotkeyID = EventHotKeyID(
        signature: OSType(0x5249_544C), // "RITL"
        id: 1
    )

    init(option: VoiceHotkeyOption = .cmdShiftL) {
        self.currentOption = option
    }

    func register() -> Bool {
        guard !isRegistered else { return true }

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        let refcon = Unmanaged.passUnretained(self).toOpaque()

        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            globalHotkeyHandler,
            1,
            &eventType,
            refcon,
            &handlerRef
        )
        guard handlerStatus == noErr else { return false }

        let hotkeyID = Self.hotkeyID

        let registerStatus = RegisterEventHotKey(
            currentOption.keyCode,
            currentOption.modifiers,
            hotkeyID,
            GetApplicationEventTarget(),
            0,
            &hotkeyRef
        )
        guard registerStatus == noErr else {
            if let handlerRef { RemoveEventHandler(handlerRef) }
            self.handlerRef = nil
            return false
        }

        isRegistered = true
        return true
    }

    func reregister(option: VoiceHotkeyOption) -> Bool {
        unregister()
        currentOption = option
        return register()
    }

    func unregister() {
        if let hotkeyRef {
            UnregisterEventHotKey(hotkeyRef)
        }
        if let handlerRef {
            RemoveEventHandler(handlerRef)
        }
        hotkeyRef = nil
        handlerRef = nil
        isRegistered = false
    }

    fileprivate func handleHotkey() {
        onToggle?()
    }
}

private func globalHotkeyHandler(
    nextHandler: EventHandlerCallRef?,
    event: EventRef?,
    userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let userData else { return OSStatus(eventNotHandledErr) }
    let hotkey = Unmanaged<GlobalHotkey>.fromOpaque(userData).takeUnretainedValue()

    var hotkeyID = EventHotKeyID()
    let status = GetEventParameter(
        event,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hotkeyID
    )
    guard status == noErr else { return status }

    if hotkeyID.signature == GlobalHotkey.hotkeyID.signature
        && hotkeyID.id == GlobalHotkey.hotkeyID.id
    {
        DispatchQueue.main.async { hotkey.handleHotkey() }
    }

    return noErr
}
