import AppKit
import SwiftUI
import Darwin

@main
struct TimerWidgetMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = NativeNotchAppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

final class NativeNotchAppDelegate: NSObject, NSApplicationDelegate {
    private var notchController: NotchController?
    private var parentWatchTimer: Timer?
    private var parentPID: pid_t?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let enabled = UserDefaults.standard.object(forKey: "notch_timer_enabled") as? Bool ?? true
        guard enabled else {
            NSApplication.shared.terminate(nil)
            return
        }

        if let pid = resolveParentPID() {
            self.parentPID = pid
            installParentWatchdog()
        }

        let store = TimerSessionStore()
        let speechEngine = SpeechEngine()
        notchController = NotchController(sessionStore: store, speechEngine: speechEngine)
        notchController?.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        parentWatchTimer?.invalidate()
        parentWatchTimer = nil
    }

    private func installParentWatchdog() {
        parentWatchTimer?.invalidate()
        parentWatchTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            guard let self, let pid = self.parentPID else { return }
            guard self.isProcessAlive(pid: pid) else {
                NSApplication.shared.terminate(nil)
                return
            }
        }
    }

    private func isProcessAlive(pid: pid_t) -> Bool {
        if kill(pid, 0) == 0 {
            return true
        }

        return errno == EPERM
    }

    /// Reads the Tauri parent PID from command-line args (`--parent-pid=N`)
    /// or the environment variable (`RITUAL_PARENT_PID`).
    private func resolveParentPID() -> pid_t? {
        // Command-line arg (used when launched via `open --args`)
        for arg in CommandLine.arguments {
            if arg.hasPrefix("--parent-pid="),
               let val = Int32(arg.dropFirst("--parent-pid=".count)),
               val > 1
            {
                return val
            }
        }
        // Env var fallback (used when launched via direct Command::new)
        if let str = ProcessInfo.processInfo.environment["RITUAL_PARENT_PID"],
           let val = Int32(str), val > 1
        {
            return val
        }
        return nil
    }
}
