// Minimal imports to avoid module conflicts
import AppKit
import Foundation

class NativeTimerWidget: NSObject {
    private var panel: NSPanel?
    private var timerLabel: NSTextField?
    private var activityLabel: NSTextField?
    private var playButton: NSButton?
    private var closeButton: NSButton?
    private var completeButton: NSButton?
    private var isRunning: Bool = false
    private var timer: Timer?
    private var seconds: Int = 0
    
    override init() {
        super.init()
    }
    
    func createTimerPanel() {
        DispatchQueue.main.async { [weak self] in
            self?.setupPanel()
        }
    }
    
    private func setupPanel() {
        // Create a borderless, floating panel
        let contentRect = NSRect(x: 0, y: 0, width: 320, height: 50)
        
        panel = NSPanel(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        
        guard let panel = panel else { return }
        
        // Configure panel properties for native macOS look
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = NSColor.clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        
        // Create the main container with native macOS visual effect
        let containerView = NSView()
        containerView.wantsLayer = true
        
        // Native macOS visual effect view (like Raycast)
        let visualEffectView = NSVisualEffectView()
        visualEffectView.material = .hudWindow
        visualEffectView.blendingMode = .behindWindow
        visualEffectView.state = .active
        visualEffectView.wantsLayer = true
        visualEffectView.layer?.cornerRadius = 12
        visualEffectView.layer?.masksToBounds = true
        
        // Timer display with native styling
        timerLabel = NSTextField(labelWithString: "00:00")
        timerLabel?.font = NSFont.monospacedSystemFont(ofSize: 16, weight: .medium)
        timerLabel?.textColor = NSColor.labelColor
        timerLabel?.alignment = .center
        timerLabel?.wantsLayer = true
        timerLabel?.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        timerLabel?.layer?.cornerRadius = 8
        timerLabel?.layer?.masksToBounds = true
        
        // Activity label
        activityLabel = NSTextField(labelWithString: "Focus")
        activityLabel?.font = NSFont.systemFont(ofSize: 14, weight: .medium)
        activityLabel?.textColor = NSColor.labelColor
        
        // Play/Pause button
        playButton = NSButton()
        playButton?.setButtonType(.momentaryPushIn)
        playButton?.isBordered = false
        playButton?.image = NSImage(systemSymbolName: "play.fill", accessibilityDescription: "Play")
        playButton?.target = self
        playButton?.action = #selector(toggleTimer)
        playButton?.wantsLayer = true
        playButton?.layer?.cornerRadius = 6
        
        // Close button
        closeButton = NSButton()
        closeButton?.setButtonType(.momentaryPushIn)
        closeButton?.isBordered = false
        closeButton?.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close")
        closeButton?.target = self
        closeButton?.action = #selector(closePanel)
        closeButton?.wantsLayer = true
        closeButton?.layer?.cornerRadius = 6
        
        // Complete button (initially hidden)
        completeButton = NSButton()
        completeButton?.setButtonType(.momentaryPushIn)
        completeButton?.isBordered = false
        completeButton?.image = NSImage(systemSymbolName: "checkmark.circle.fill", accessibilityDescription: "Complete")
        completeButton?.target = self
        completeButton?.action = #selector(completeSession)
        completeButton?.wantsLayer = true
        completeButton?.layer?.cornerRadius = 6
        completeButton?.isHidden = true
        
        // Add hover effects
        setupHoverEffects()
        
        // Layout
        containerView.addSubview(visualEffectView)
        containerView.addSubview(timerLabel!)
        containerView.addSubview(activityLabel!)
        containerView.addSubview(playButton!)
        containerView.addSubview(closeButton!)
        containerView.addSubview(completeButton!)
        
        // Auto Layout
        visualEffectView.translatesAutoresizingMaskIntoConstraints = false
        timerLabel?.translatesAutoresizingMaskIntoConstraints = false
        activityLabel?.translatesAutoresizingMaskIntoConstraints = false
        playButton?.translatesAutoresizingMaskIntoConstraints = false
        closeButton?.translatesAutoresizingMaskIntoConstraints = false
        completeButton?.translatesAutoresizingMaskIntoConstraints = false
        
        NSLayoutConstraint.activate([
            // Visual effect view fills container
            visualEffectView.leadingAnchor.constraint(equalTo: containerView.leadingAnchor),
            visualEffectView.trailingAnchor.constraint(equalTo: containerView.trailingAnchor),
            visualEffectView.topAnchor.constraint(equalTo: containerView.topAnchor),
            visualEffectView.bottomAnchor.constraint(equalTo: containerView.bottomAnchor),
            
            // Timer label on the left
            timerLabel!.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 16),
            timerLabel!.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
            timerLabel!.widthAnchor.constraint(equalToConstant: 60),
            timerLabel!.heightAnchor.constraint(equalToConstant: 24),
            
            // Activity label next to timer
            activityLabel!.leadingAnchor.constraint(equalTo: timerLabel!.trailingAnchor, constant: 12),
            activityLabel!.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
            
            // Buttons on the right
            closeButton!.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -16),
            closeButton!.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
            closeButton!.widthAnchor.constraint(equalToConstant: 24),
            closeButton!.heightAnchor.constraint(equalToConstant: 24),
            
            completeButton!.trailingAnchor.constraint(equalTo: closeButton!.leadingAnchor, constant: -8),
            completeButton!.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
            completeButton!.widthAnchor.constraint(equalToConstant: 24),
            completeButton!.heightAnchor.constraint(equalToConstant: 24),
            
            playButton!.trailingAnchor.constraint(equalTo: completeButton!.leadingAnchor, constant: -8),
            playButton!.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
            playButton!.widthAnchor.constraint(equalToConstant: 24),
            playButton!.heightAnchor.constraint(equalToConstant: 24),
        ])
        
        panel.contentView = containerView
        panel.center()
        panel.makeKeyAndOrderFront(nil)
    }
    
    private func setupHoverEffects() {
        // Add hover effects to buttons
        [playButton, closeButton, completeButton].forEach { button in
            guard let button = button else { return }
            
            let trackingArea = NSTrackingArea(
                rect: button.bounds,
                options: [.mouseEnteredAndExited, .activeInVisibleRect],
                owner: self,
                userInfo: ["button": button]
            )
            button.addTrackingArea(trackingArea)
        }
    }
    
    override func mouseEntered(with event: NSEvent) {
        if let button = event.trackingArea?.userInfo?["button"] as? NSButton {
            button.layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.1).cgColor
        }
    }
    
    override func mouseExited(with event: NSEvent) {
        if let button = event.trackingArea?.userInfo?["button"] as? NSButton {
            button.layer?.backgroundColor = NSColor.clear.cgColor
        }
    }
    
    @objc private func toggleTimer() {
        isRunning.toggle()
        
        if isRunning {
            playButton?.image = NSImage(systemSymbolName: "pause.fill", accessibilityDescription: "Pause")
            completeButton?.isHidden = false
            startTimer()
        } else {
            playButton?.image = NSImage(systemSymbolName: "play.fill", accessibilityDescription: "Play")
            completeButton?.isHidden = true
            stopTimer()
        }
    }
    
    @objc private func completeSession() {
        stopTimer()
        
        // Show completion alert
        let alert = NSAlert()
        alert.messageText = "Session Complete!"
        alert.informativeText = "Great work! You completed \(formatTime(seconds)) of focused time."
        alert.addButton(withTitle: "OK")
        alert.runModal()
        
        // Reset
        seconds = 0
        updateTimerDisplay()
        isRunning = false
        playButton?.image = NSImage(systemSymbolName: "play.fill", accessibilityDescription: "Play")
        completeButton?.isHidden = true
    }
    
    @objc private func closePanel() {
        stopTimer()
        panel?.close()
        panel = nil
    }
    
    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.seconds += 1
            self?.updateTimerDisplay()
        }
    }
    
    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
    
    private func updateTimerDisplay() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.timerLabel?.stringValue = self.formatTime(self.seconds)
        }
    }
    
    private func formatTime(_ totalSeconds: Int) -> String {
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

// Global instance for C bridge
private var globalTimerWidget: NativeTimerWidget?

// C bridge functions for Tauri
@_cdecl("create_native_timer_widget")
public func createNativeTimerWidget() -> Bool {
    globalTimerWidget = NativeTimerWidget()
    globalTimerWidget?.createTimerPanel()
    return true
}

@_cdecl("close_native_timer_widget")
public func closeNativeTimerWidget() -> Bool {
    globalTimerWidget?.closePanel()
    globalTimerWidget = nil
    return true
}