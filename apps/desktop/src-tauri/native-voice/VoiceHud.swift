import AppKit
import Foundation

typealias RitualVoiceHudCallback = @convention(c) () -> Void

private let hudWidth: CGFloat = 430
private let hudHeight: CGFloat = 122
private let hudCornerRadius: CGFloat = 27
private var stopCallback: RitualVoiceHudCallback?
private var cancelCallback: RitualVoiceHudCallback?

private struct RitualVoiceHudState {
    var sessionId: String = ""
    var isListening: Bool = false
    var isProcessingVoice: Bool = false
    var error: String = ""
    var partialTranscript: String = ""

    static func fromJson(_ pointer: UnsafePointer<CChar>?) -> RitualVoiceHudState {
        guard let pointer else {
            return RitualVoiceHudState()
        }

        let raw = String(cString: pointer)
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return RitualVoiceHudState()
        }

        return RitualVoiceHudState(
            sessionId: object["sessionId"] as? String ?? "",
            isListening: object["isListening"] as? Bool ?? false,
            isProcessingVoice: object["isProcessingVoice"] as? Bool ?? false,
            error: object["error"] as? String ?? "",
            partialTranscript: object["partialTranscript"] as? String ?? ""
        )
    }
}

private final class RitualVoiceHudPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private class RitualVoiceHudRootView: NSView {
    var onStop: (() -> Void)?
    var onCancel: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 49 {
            onStop?()
            return
        }

        if event.keyCode == 53 {
            onCancel?()
            return
        }

        super.keyDown(with: event)
    }
}

private final class RitualVoiceHudSurfaceView: NSVisualEffectView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        material = .popover
        blendingMode = .behindWindow
        state = .active
        wantsLayer = true
        layer?.cornerRadius = hudCornerRadius
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.91, alpha: 0.78).cgColor
        layer?.borderColor = NSColor(calibratedWhite: 0.61, alpha: 0.54).cgColor
        layer?.borderWidth = 1
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class RitualVoiceHudShadowView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.shadowColor = NSColor.black.cgColor
        layer?.shadowOpacity = 0.20
        layer?.shadowRadius = 18
        layer?.shadowOffset = CGSize(width: 0, height: -8)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        layer?.shadowPath = CGPath(roundedRect: bounds, cornerWidth: hudCornerRadius, cornerHeight: hudCornerRadius, transform: nil)
    }
}

private final class RitualVoiceHudRailView: NSVisualEffectView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        material = .contentBackground
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true
        layer?.cornerRadius = 9
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.white.withAlphaComponent(0.58).cgColor
        layer?.borderColor = NSColor.white.withAlphaComponent(0.36).cgColor
        layer?.borderWidth = 1
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class RitualVoiceHudWaveformView: NSView {
    var isListening = false {
        didSet { setNeedsDisplay(bounds) }
    }

    var isProcessing = false {
        didSet { setNeedsDisplay(bounds) }
    }

    var level: CGFloat = 0.34 {
        didSet { setNeedsDisplay(bounds) }
    }

    private var phase: CGFloat = 0
    private var timer: Timer?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        startAnimating()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        timer?.invalidate()
    }

    private func startAnimating() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            phase += 0.11
            if phase > .pi * 2 {
                phase = 0
            }
            setNeedsDisplay(bounds)
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let baselineY = bounds.midY
        let dotColor = NSColor(calibratedWhite: 0.52, alpha: 0.62)
        dotColor.setFill()

        var x: CGFloat = 0
        while x < bounds.width {
            let dot = NSBezierPath(roundedRect: NSRect(x: x, y: baselineY - 1, width: 2, height: 2), xRadius: 0.8, yRadius: 0.8)
            dot.fill()
            x += 4.5
        }

        guard isListening || isProcessing else {
            return
        }

        let barColor = NSColor(calibratedWhite: 0.16, alpha: isProcessing ? 0.50 : 0.82)
        barColor.setFill()

        let center = bounds.midX
        let barWidth: CGFloat = 2
        let gap: CGFloat = 2.2
        let barCount = 54
        let maxHeight = bounds.height * (isProcessing ? 0.40 : 0.68)
        let activeLevel = max(0.18, min(level, 1.0))

        for index in 0..<barCount {
            let offset = CGFloat(index) - CGFloat(barCount - 1) / 2.0
            let distance = abs(offset) / (CGFloat(barCount) / 2.0)
            let envelope = pow(max(0, 1 - distance), 1.8)
            let motion = 0.60 + 0.40 * sin(phase + CGFloat(index) * 0.42)
            let height = max(4, maxHeight * (0.18 + envelope * activeLevel * motion))
            let rect = NSRect(
                x: center + offset * (barWidth + gap) - barWidth / 2,
                y: baselineY - height / 2,
                width: barWidth,
                height: height
            )
            NSBezierPath(roundedRect: rect, xRadius: 1, yRadius: 1).fill()
        }
    }
}

private final class RitualVoiceHudMarkView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        let stroke = NSColor(calibratedWhite: 0.45, alpha: 0.78)
        stroke.setStroke()

        let rect = bounds.insetBy(dx: 3, dy: 2.5)
        let path = NSBezierPath()
        path.lineWidth = 2.3
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.move(to: NSPoint(x: rect.midX, y: rect.maxY))
        path.line(to: NSPoint(x: rect.maxX, y: rect.minY + 1))
        path.line(to: NSPoint(x: rect.minX, y: rect.minY + 1))
        path.close()
        path.stroke()
    }
}

private final class RitualVoiceHudIconView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let image = NSImage(systemSymbolName: "arrow.up.left.and.arrow.down.right", accessibilityDescription: nil) else {
            return
        }

        let config = NSImage.SymbolConfiguration(pointSize: 12.5, weight: .medium)
        let configured = image.withSymbolConfiguration(config) ?? image
        NSColor(calibratedWhite: 0.55, alpha: 0.70).set()
        configured.draw(in: bounds, from: .zero, operation: .sourceAtop, fraction: 1)
    }
}

private final class RitualVoiceHudKeycap: NSTextField {
    init(text: String, width: CGFloat) {
        super.init(frame: NSRect(x: 0, y: 0, width: width, height: 24))
        stringValue = text
        isEditable = false
        isSelectable = false
        isBordered = false
        drawsBackground = false
        alignment = .center
        font = .systemFont(ofSize: text == "esc" ? 11.5 : 13, weight: .semibold)
        textColor = NSColor(calibratedWhite: 0.12, alpha: 1)
        wantsLayer = true
        layer?.cornerRadius = 6
        layer?.cornerCurve = .continuous
        layer?.backgroundColor = NSColor(calibratedWhite: 0.80, alpha: 0.72).cgColor
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class RitualVoiceHudTextButton: NSButton {
    init(title: String, fontSize: CGFloat, weight: NSFont.Weight = .medium) {
        super.init(frame: .zero)
        self.title = title
        isBordered = false
        bezelStyle = .regularSquare
        setButtonType(.momentaryChange)
        font = .systemFont(ofSize: fontSize, weight: weight)
        contentTintColor = NSColor(calibratedWhite: 0.50, alpha: 1)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class RitualVoiceHudContentView: RitualVoiceHudRootView {
    private let shadowView = RitualVoiceHudShadowView()
    private let surfaceView = RitualVoiceHudSurfaceView()
    private let waveformView = RitualVoiceHudWaveformView()
    private let railView = RitualVoiceHudRailView()
    private let markView = RitualVoiceHudMarkView()
    private let expandView = RitualVoiceHudIconView()
    private let statusButton = RitualVoiceHudTextButton(title: "Stop", fontSize: 13)
    private let optionKey = RitualVoiceHudKeycap(text: "⌥", width: 22)
    private let spaceKey = RitualVoiceHudKeycap(text: "Space", width: 50)
    private let cancelButton = RitualVoiceHudTextButton(title: "Cancel", fontSize: 13)
    private let escapeKey = RitualVoiceHudKeycap(text: "esc", width: 34)
    private let messageLabel = NSTextField(labelWithString: "")
    private var statusButtonWidth: CGFloat = 38

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor

        addSubview(shadowView)
        shadowView.addSubview(surfaceView)
        surfaceView.addSubview(waveformView)
        surfaceView.addSubview(expandView)
        surfaceView.addSubview(messageLabel)
        surfaceView.addSubview(railView)
        railView.addSubview(markView)
        railView.addSubview(statusButton)
        railView.addSubview(optionKey)
        railView.addSubview(spaceKey)
        railView.addSubview(cancelButton)
        railView.addSubview(escapeKey)

        messageLabel.alignment = .center
        messageLabel.font = .systemFont(ofSize: 11.5, weight: .medium)
        messageLabel.textColor = NSColor(calibratedWhite: 0.44, alpha: 1)
        messageLabel.lineBreakMode = .byTruncatingTail
        messageLabel.isHidden = true

        statusButton.target = self
        statusButton.action = #selector(stopPressed)
        cancelButton.target = self
        cancelButton.action = #selector(cancelPressed)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()

        shadowView.frame = bounds
        surfaceView.frame = shadowView.bounds
        expandView.frame = NSRect(x: bounds.width - 38, y: bounds.height - 33, width: 18, height: 18)
        waveformView.frame = NSRect(x: 30, y: 65, width: bounds.width - 60, height: 28)
        messageLabel.frame = NSRect(x: 56, y: 48, width: bounds.width - 112, height: 15)
        railView.frame = NSRect(x: 7, y: 7, width: bounds.width - 14, height: 36)
        markView.frame = NSRect(x: 19, y: 8.5, width: 19, height: 19)

        let keyY: CGFloat = 6
        let buttonY: CGFloat = 6
        escapeKey.frame.origin = NSPoint(x: railView.bounds.width - 18 - escapeKey.frame.width, y: keyY)
        cancelButton.frame = NSRect(x: escapeKey.frame.minX - 56, y: buttonY - 1, width: 46, height: 24)
        spaceKey.frame.origin = NSPoint(x: cancelButton.frame.minX - 58, y: keyY)
        optionKey.frame.origin = NSPoint(x: spaceKey.frame.minX - 28, y: keyY)
        statusButton.frame = NSRect(x: optionKey.frame.minX - statusButtonWidth - 15, y: buttonY - 1, width: statusButtonWidth, height: 24)
    }

    func update(_ state: RitualVoiceHudState) {
        waveformView.isListening = state.isListening
        waveformView.isProcessing = state.isProcessingVoice

        if state.isProcessingVoice {
            statusButton.title = "Processing"
            statusButtonWidth = 70
        } else {
            statusButton.title = "Stop"
            statusButtonWidth = 38
        }

        if !state.error.isEmpty {
            messageLabel.stringValue = state.error
            messageLabel.textColor = NSColor(calibratedRed: 0.56, green: 0.16, blue: 0.16, alpha: 1)
            messageLabel.isHidden = false
        } else if !state.partialTranscript.isEmpty {
            messageLabel.stringValue = state.partialTranscript
            messageLabel.textColor = NSColor(calibratedWhite: 0.43, alpha: 1)
            messageLabel.isHidden = false
        } else {
            messageLabel.isHidden = true
        }

        needsLayout = true
        waveformView.needsDisplay = true
    }

    @objc private func stopPressed() {
        onStop?()
    }

    @objc private func cancelPressed() {
        onCancel?()
    }
}

private final class RitualVoiceHudController {
    private let panel: RitualVoiceHudPanel
    private let hudView: RitualVoiceHudContentView

    init() {
        panel = RitualVoiceHudPanel(
            contentRect: NSRect(x: 0, y: 0, width: hudWidth, height: hudHeight),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        hudView = RitualVoiceHudContentView(frame: NSRect(x: 0, y: 0, width: hudWidth, height: hudHeight))
        hudView.onStop = {
            stopCallback?()
        }
        hudView.onCancel = {
            cancelCallback?()
        }
        panel.contentView = hudView
    }

    func show(_ state: RitualVoiceHudState) {
        runOnMain {
            self.hudView.update(state)
            self.centerPanel()
            self.panel.orderFrontRegardless()
            self.panel.makeKey()
            self.hudView.window?.makeFirstResponder(self.hudView)
        }
    }

    func update(_ state: RitualVoiceHudState) {
        runOnMain {
            self.hudView.update(state)
        }
    }

    func hide() {
        runOnMain {
            self.panel.orderOut(nil)
        }
    }

    func isVisible() -> Bool {
        if Thread.isMainThread {
            return panel.isVisible
        }

        var visible = false
        DispatchQueue.main.sync {
            visible = panel.isVisible
        }
        return visible
    }

    private func centerPanel() {
        let pointerLocation = NSEvent.mouseLocation
        let screenFrame = NSScreen.screens.first(where: { $0.frame.contains(pointerLocation) })?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? NSScreen.screens.first?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let origin = NSPoint(
            x: screenFrame.midX - hudWidth / 2,
            y: screenFrame.midY - hudHeight / 2 + 14
        )
        panel.setFrameOrigin(origin)
    }

    private func runOnMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }
}

private var ritualVoiceHudController: RitualVoiceHudController?

private func withVoiceHudController(_ work: @escaping (RitualVoiceHudController) -> Void) {
    let run = {
        if ritualVoiceHudController == nil {
            ritualVoiceHudController = RitualVoiceHudController()
        }
        if let controller = ritualVoiceHudController {
            work(controller)
        }
    }

    if Thread.isMainThread {
        run()
    } else {
        DispatchQueue.main.async(execute: run)
    }
}

private func voiceHudIsVisible() -> Bool {
    if Thread.isMainThread {
        return ritualVoiceHudController?.isVisible() ?? false
    }

    var visible = false
    DispatchQueue.main.sync {
        visible = ritualVoiceHudController?.isVisible() ?? false
    }
    return visible
}

@_cdecl("ritual_set_voice_hud_callbacks")
func ritual_set_voice_hud_callbacks(_ stop: RitualVoiceHudCallback?, _ cancel: RitualVoiceHudCallback?) {
    stopCallback = stop
    cancelCallback = cancel
}

@_cdecl("ritual_show_voice_hud")
func ritual_show_voice_hud(_ stateJson: UnsafePointer<CChar>?) -> Bool {
    let state = RitualVoiceHudState.fromJson(stateJson)
    withVoiceHudController { controller in
        controller.show(state)
    }
    return true
}

@_cdecl("ritual_update_voice_hud")
func ritual_update_voice_hud(_ stateJson: UnsafePointer<CChar>?) -> Bool {
    let state = RitualVoiceHudState.fromJson(stateJson)
    withVoiceHudController { controller in
        controller.update(state)
    }
    return true
}

@_cdecl("ritual_hide_voice_hud")
func ritual_hide_voice_hud() -> Bool {
    withVoiceHudController { controller in
        controller.hide()
    }
    return true
}

@_cdecl("ritual_voice_hud_is_visible")
func ritual_voice_hud_is_visible() -> Bool {
    return voiceHudIsVisible()
}
