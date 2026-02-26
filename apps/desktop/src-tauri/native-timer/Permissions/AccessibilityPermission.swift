import Cocoa
import ApplicationServices

enum AccessibilityPermission {

    /// Returns `true` if this process is trusted for Accessibility.
    static func isTrusted() -> Bool {
        AXIsProcessTrusted()
    }

    /// Checks trust and optionally shows the macOS "allow Accessibility" prompt.
    /// Returns `true` if already trusted.
    @discardableResult
    static func requestTrustPromptIfNeeded() -> Bool {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
        return AXIsProcessTrustedWithOptions(opts)
    }

    /// Opens System Settings → Privacy & Security → Accessibility.
    static func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
}
