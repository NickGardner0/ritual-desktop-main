import AppKit
import CoreGraphics
import Foundation

private let hudWidth: CGFloat = 430
private let hudHeight: CGFloat = 122
private let hudCornerRadius: CGFloat = 27

private struct Arguments {
    var sessionId = ""
    var statePath = ""
    var commandDir = ""
    var statusPath = ""
    var logPath = ""

    static func parse(_ raw: [String]) -> Arguments {
        var args = Arguments()
        var index = 1
        while index < raw.count {
            let key = raw[index]
            let value = index + 1 < raw.count ? raw[index + 1] : ""
            switch key {
            case "--session":
                args.sessionId = value
                index += 2
            case "--state":
                args.statePath = value
                index += 2
            case "--command-dir":
                args.commandDir = value
                index += 2
            case "--status":
                args.statusPath = value
                index += 2
            case "--log":
                args.logPath = value
                index += 2
            default:
                index += 1
            }
        }
        return args
    }
}

private struct HudState: Decodable {
    var sessionId: String
    var isListening: Bool
    var isProcessingVoice: Bool
    var error: String?
    var partialTranscript: String?
}

private final class HudPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private class HudRootView: NSView {
    var onStop: (() -> Void)?
    var onCancel: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 49:
            onStop?()
        case 53:
            onCancel?()
        default:
            super.keyDown(with: event)
        }
    }
}

private final class SurfaceView: NSVisualEffectView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        material = .popover
        blendingMode = .behindWindow
        state = .active
        wantsLayer = true
        layer?.cornerRadius = hudCornerRadius
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.91, alpha: 0.82).cgColor
        layer?.borderColor = NSColor(calibratedWhite: 0.62, alpha: 0.52).cgColor
        layer?.borderWidth = 1
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class ShadowView: NSView {
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
        layer?.shadowPath = CGPath(
            roundedRect: bounds,
            cornerWidth: hudCornerRadius,
            cornerHeight: hudCornerRadius,
            transform: nil
        )
    }
}

private final class RailView: NSVisualEffectView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        material = .contentBackground
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true
        layer?.cornerRadius = 9
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.white.withAlphaComponent(0.62).cgColor
        layer?.borderColor = NSColor.white.withAlphaComponent(0.38).cgColor
        layer?.borderWidth = 1
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class WaveformView: NSView {
    var isListening = false { didSet { setNeedsDisplay(bounds) } }
    var isProcessing = false { didSet { setNeedsDisplay(bounds) } }
    private var phase: CGFloat = 0
    private var timer: Timer?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            phase += 0.11
            if phase > .pi * 2 { phase = 0 }
            setNeedsDisplay(bounds)
        }
        RunLoop.main.add(timer!, forMode: .common)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        timer?.invalidate()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let baselineY = bounds.midY
        NSColor(calibratedWhite: 0.52, alpha: 0.62).setFill()

        var x: CGFloat = 0
        while x < bounds.width {
            NSBezierPath(
                roundedRect: NSRect(x: x, y: baselineY - 1, width: 2, height: 2),
                xRadius: 0.8,
                yRadius: 0.8
            ).fill()
            x += 4.5
        }

        guard isListening || isProcessing else { return }

        NSColor(calibratedWhite: 0.16, alpha: isProcessing ? 0.50 : 0.82).setFill()
        let center = bounds.midX
        let barWidth: CGFloat = 2
        let gap: CGFloat = 2.2
        let barCount = 54
        let maxHeight = bounds.height * (isProcessing ? 0.40 : 0.68)

        for index in 0..<barCount {
            let offset = CGFloat(index) - CGFloat(barCount - 1) / 2.0
            let distance = abs(offset) / (CGFloat(barCount) / 2.0)
            let envelope = pow(max(0, 1 - distance), 1.8)
            let motion = 0.60 + 0.40 * sin(phase + CGFloat(index) * 0.42)
            let height = max(4, maxHeight * (0.18 + envelope * 0.52 * motion))
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

private final class MarkView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor(calibratedWhite: 0.45, alpha: 0.78).setStroke()
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

private final class ExpandView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let image = NSImage(systemSymbolName: "arrow.up.left.and.arrow.down.right", accessibilityDescription: nil) else {
            return
        }
        let configured = image.withSymbolConfiguration(.init(pointSize: 12.5, weight: .medium)) ?? image
        NSColor(calibratedWhite: 0.55, alpha: 0.70).set()
        configured.draw(in: bounds, from: .zero, operation: .sourceAtop, fraction: 1)
    }
}

private final class Keycap: NSTextField {
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

private final class TextButton: NSButton {
    init(title: String, fontSize: CGFloat) {
        super.init(frame: .zero)
        self.title = title
        isBordered = false
        bezelStyle = .regularSquare
        setButtonType(.momentaryChange)
        font = .systemFont(ofSize: fontSize, weight: .medium)
        contentTintColor = NSColor(calibratedWhite: 0.50, alpha: 1)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class HudView: HudRootView {
    private let shadowView = ShadowView()
    private let surfaceView = SurfaceView()
    private let waveformView = WaveformView()
    private let railView = RailView()
    private let markView = MarkView()
    private let expandView = ExpandView()
    private let statusButton = TextButton(title: "Stop", fontSize: 13)
    private let optionKey = Keycap(text: "⌥", width: 22)
    private let spaceKey = Keycap(text: "Space", width: 50)
    private let cancelButton = TextButton(title: "Cancel", fontSize: 13)
    private let escapeKey = Keycap(text: "esc", width: 34)
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

    func update(_ state: HudState) {
        waveformView.isListening = state.isListening
        waveformView.isProcessing = state.isProcessingVoice

        if state.isProcessingVoice {
            statusButton.title = "Processing"
            statusButtonWidth = 70
        } else {
            statusButton.title = "Stop"
            statusButtonWidth = 38
        }

        if let error = state.error, !error.isEmpty {
            messageLabel.stringValue = error
            messageLabel.textColor = NSColor(calibratedRed: 0.56, green: 0.16, blue: 0.16, alpha: 1)
            messageLabel.isHidden = false
        } else if let partial = state.partialTranscript, !partial.isEmpty {
            messageLabel.stringValue = partial
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

private final class VoiceHudApp: NSObject, NSApplicationDelegate {
    private let args: Arguments
    private var panel: HudPanel?
    private var hudView: HudView?
    private var stateTimer: Timer?
    private var lastStateModified: Date?

    init(args: Arguments) {
        self.args = args
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        createHud()
        startPolling()
    }

    func applicationWillTerminate(_ notification: Notification) {
        writeStatus("hidden")
    }

    private func createHud() {
        let panel = HudPanel(
            contentRect: NSRect(x: 0, y: 0, width: hudWidth, height: hudHeight),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false

        let view = HudView(frame: NSRect(x: 0, y: 0, width: hudWidth, height: hudHeight))
        view.onStop = { [weak self] in self?.writeCommand("stop") }
        view.onCancel = { [weak self] in self?.writeCommand("cancel") }
        panel.contentView = view

        if let state = readState() {
            view.update(state)
        }

        self.panel = panel
        self.hudView = view
        center(panel)
        panel.orderFrontRegardless()
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(view)
        panel.displayIfNeeded()
        view.displayIfNeeded()
        writeStatus("shown")
    }

    private func center(_ panel: NSPanel) {
        let pointerLocation = NSEvent.mouseLocation
        let screenFrame = NSScreen.screens.first(where: { $0.frame.contains(pointerLocation) })?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? NSScreen.screens.first?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let origin = NSPoint(
            x: screenFrame.midX - hudWidth / 2,
            y: screenFrame.midY - hudHeight / 2 + 14
        )
        panel.setFrame(NSRect(x: origin.x, y: origin.y, width: hudWidth, height: hudHeight), display: true)
    }

    private func startPolling() {
        stateTimer?.invalidate()
        stateTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            self?.poll()
        }
        RunLoop.main.add(stateTimer!, forMode: .common)
    }

    private func poll() {
        if FileManager.default.fileExists(atPath: commandPath("quit")) {
            NSApplication.shared.terminate(nil)
            return
        }

        guard let stateURL = stateURL else { return }
        let modified = (try? FileManager.default.attributesOfItem(atPath: stateURL.path)[.modificationDate]) as? Date
        if modified != nil && modified != lastStateModified, let state = readState() {
            lastStateModified = modified
            hudView?.update(state)
        }
    }

    private var stateURL: URL? {
        args.statePath.isEmpty ? nil : URL(fileURLWithPath: args.statePath)
    }

    private func readState() -> HudState? {
        guard let stateURL else { return nil }
        guard let data = try? Data(contentsOf: stateURL) else { return nil }
        return try? JSONDecoder().decode(HudState.self, from: data)
    }

    private func writeCommand(_ name: String) {
        guard !args.commandDir.isEmpty else { return }
        try? FileManager.default.createDirectory(
            atPath: args.commandDir,
            withIntermediateDirectories: true
        )
        let payload = "{\"sessionId\":\"\(args.sessionId)\",\"command\":\"\(name)\",\"timestamp\":\(Date().timeIntervalSince1970)}\n"
        try? payload.write(toFile: commandPath(name), atomically: true, encoding: .utf8)
    }

    private func commandPath(_ name: String) -> String {
        URL(fileURLWithPath: args.commandDir).appendingPathComponent(name).path
    }

    private func writeStatus(_ event: String) {
        guard !args.statusPath.isEmpty else { return }
        let frame = panel?.frame ?? .zero
        let status: [String: Any] = [
            "sessionId": args.sessionId,
            "event": event,
            "pid": ProcessInfo.processInfo.processIdentifier,
            "width": frame.width,
            "height": frame.height,
            "timestamp": Date().timeIntervalSince1970
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: status) else { return }
        try? data.write(to: URL(fileURLWithPath: args.statusPath), options: .atomic)
    }
}

private let args = Arguments.parse(CommandLine.arguments)
private let app = NSApplication.shared
private let delegate = VoiceHudApp(args: args)
app.delegate = delegate
app.run()
