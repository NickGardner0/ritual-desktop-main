import Cocoa
import Foundation

class NativeTimerWidget: NSObject {
    private var panel: NSPanel?
    private var timerLabel: NSTextField?
    private var activityLabel: NSTextField?
    
    @objc func createTimerPanel(timer: String, activity: String) -> Bool {
        DispatchQueue.main.async { [weak self] in
            self?.setupPanel(timer: timer, activity: activity)
        }
        return true
    }
    
    private func setupPanel(timer: String, activity: String) {
        // Create a borderless, floating panel
        let contentRect = NSRect(x: 0, y: 0, width: 300, height: 50)
        
        panel = NSPanel(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        
        guard let panel = panel else { return }
        
        // Configure panel properties
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = NSColor.clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        
        // Create the visual effect view (native macOS blur)
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = .hudWindow
        visualEffectView.blendingMode = .behindWindow
        visualEffectView.state = .active
        visualEffectView.wantsLayer = true
        visualEffectView.layer?.cornerRadius = 12
        visualEffectView.layer?.masksToBounds = true
        
        // Create container view
        let containerView = NSView()
        containerView.wantsLayer = true
        
        // Timer label
        timerLabel = NSTextField(labelWithString: timer)
        timerLabel?.font = NSFont.monospacedSystemFont(ofSize: 16, weight: .medium)
        timerLabel?.textColor = NSColor.labelColor
        timerLabel?.backgroundColor = NSColor.controlBackgroundColor
        timerLabel?.layer?.cornerRadius = 8
        timerLabel?.layer?.masksToBounds = true
        
        // Activity label
        activityLabel = NSTextField(labelWithString: activity)
        activityLabel?.font = NSFont.systemFont(ofSize: 14, weight: .medium)
        activityLabel?.textColor = NSColor.secondaryLabelColor
        
        // Layout
        containerView.addSubview(visualEffectView)
        containerView.addSubview(timerLabel!)
        containerView.addSubview(activityLabel!)
        
        // Auto Layout
        visualEffectView.translatesAutoresizingMaskIntoConstraints = false
        timerLabel?.translatesAutoresizingMaskIntoConstraints = false
        activityLabel?.translatesAutoresizingMaskIntoConstraints = false
        
        NSLayoutConstraint.activate([
            visualEffectView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            visualEffectView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            visualEffectView.topAnchor.constraint(equalTo: containerView.topAnchor),
            visualEffectView.bottomAnchor.constraint(equalTo: containerView.bottomAnchor),
            
            timerLabel!.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 16),
            timerLabel!.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
            
            activityLabel!.leadingAnchor.constraint(equalTo: timerLabel!.trailingAnchor, constant: 12),
            activityLabel!.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
        ])
        
        panel.contentView = containerView
        panel.center()
        panel.makeKeyAndOrderFront(nil)
    }
    
    @objc func updateTimer(_ timer: String) -> Bool {
        DispatchQueue.main.async { [weak self] in
            self?.timerLabel?.stringValue = timer
        }
        return true
    }
    
    @objc func closeTimer() -> Bool {
        DispatchQueue.main.async { [weak self] in
            self?.panel?.close()
            self?.panel = nil
        }
        return true
    }
}

// C bridge functions for Rust FFI
@_cdecl("create_native_macos_timer_panel")
func createNativeMacOSTimerPanel(timer: UnsafePointer<CChar>, activity: UnsafePointer<CChar>) -> Bool {
    let timerString = String(cString: timer)
    let activityString = String(cString: activity)
    
    let widget = NativeTimerWidget()
    return widget.createTimerPanel(timer: timerString, activity: activityString)
}

@_cdecl("update_native_timer")
func updateNativeTimer(timer: UnsafePointer<CChar>) -> Bool {
    let timerString = String(cString: timer)
    // You'd need to maintain a reference to the widget instance
    return true
}

@_cdecl("close_native_timer")
func closeNativeTimer() -> Bool {
    // Close the timer widget
    return true
}