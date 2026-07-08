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
    var anchorX: CGFloat?
    var anchorY: CGFloat?
    var anchorWidth: CGFloat?
    var anchorHeight: CGFloat?

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
            case "--anchor-x":
                args.anchorX = Double(value).map { CGFloat($0) }
                index += 2
            case "--anchor-y":
                args.anchorY = Double(value).map { CGFloat($0) }
                index += 2
            case "--anchor-width":
                args.anchorWidth = Double(value).map { CGFloat($0) }
                index += 2
            case "--anchor-height":
                args.anchorHeight = Double(value).map { CGFloat($0) }
                index += 2
            default:
                index += 1
            }
        }
        return args
    }

    var anchor: HudAnchor? {
        guard let anchorX, let anchorY, let anchorWidth, let anchorHeight else {
            return nil
        }
        guard anchorWidth > 0, anchorHeight > 0 else {
            return nil
        }
        return HudAnchor(x: anchorX, y: anchorY, width: anchorWidth, height: anchorHeight)
    }
}

private struct HudState: Decodable {
    var sessionId: String
    var isListening: Bool
    var isProcessingVoice: Bool
    var audioLevel: Double?
    var error: String?
    var partialTranscript: String?
}

private struct HudAnchor {
    var x: CGFloat
    var y: CGFloat
    var width: CGFloat
    var height: CGFloat
}

private final class HudPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private class HudRootView: NSView {
    var onStop: (() -> Void)?
    var onCancel: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }
    override var mouseDownCanMoveWindow: Bool { true }

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
        material = .hudWindow
        blendingMode = .behindWindow
        state = .active
        wantsLayer = true
        layer?.cornerRadius = hudCornerRadius
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.91, alpha: 0.78).cgColor
        layer?.borderColor = NSColor(calibratedWhite: 0.62, alpha: 0.44).cgColor
        layer?.borderWidth = 1
    }

    override var mouseDownCanMoveWindow: Bool { true }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class ShadowView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.shadowColor = NSColor.black.cgColor
        layer?.shadowOpacity = 0.18
        layer?.shadowRadius = 17
        layer?.shadowOffset = CGSize(width: 0, height: -7)
    }

    override var mouseDownCanMoveWindow: Bool { true }

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
        layer?.backgroundColor = NSColor.white.withAlphaComponent(0.68).cgColor
        layer?.borderColor = NSColor.white.withAlphaComponent(0.44).cgColor
        layer?.borderWidth = 1
    }

    override var mouseDownCanMoveWindow: Bool { true }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class WaveformView: NSView {
    var isListening = false { didSet { setNeedsDisplay(bounds) } }
    var isProcessing = false { didSet { setNeedsDisplay(bounds) } }
    var audioLevel: CGFloat = 0 { didSet { setNeedsDisplay(bounds) } }
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

    override var mouseDownCanMoveWindow: Bool { true }

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
        let fallbackLevel: CGFloat = isProcessing ? 0.18 : 0.22
        let liveLevel = min(1, max(audioLevel, fallbackLevel))
        let maxHeight = bounds.height * (0.24 + liveLevel * (isProcessing ? 0.36 : 0.58))

        for index in 0..<barCount {
            let offset = CGFloat(index) - CGFloat(barCount - 1) / 2.0
            let distance = abs(offset) / (CGFloat(barCount) / 2.0)
            let envelope = pow(max(0, 1 - distance), 1.8)
            let motion = 0.58 + 0.42 * sin(phase + CGFloat(index) * 0.42)
            let noise = 0.88 + 0.12 * sin(phase * 0.7 + CGFloat(index) * 0.19)
            let height = max(3.5, maxHeight * (0.12 + envelope * 0.76 * motion * noise))
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
    override var mouseDownCanMoveWindow: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let rect = bounds.insetBy(dx: 1.8, dy: 1.8)
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(ovalIn: rect).addClip()

        NSColor(calibratedWhite: 0.43, alpha: 0.84).setStroke()
        let strokes: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (-0.12, 0.68, 0.18, 0.83),
            (-0.18, 0.52, 0.30, 0.72),
            (-0.08, 0.36, 0.46, 0.58),
            (0.12, 0.21, 0.64, 0.42),
        ]

        for (startX, startY, controlY, endY) in strokes {
            let path = NSBezierPath()
            path.lineWidth = 3.4
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            path.move(to: NSPoint(x: rect.minX + rect.width * startX, y: rect.minY + rect.height * startY))
            path.curve(
                to: NSPoint(x: rect.maxX + rect.width * 0.12, y: rect.minY + rect.height * endY),
                controlPoint1: NSPoint(x: rect.minX + rect.width * 0.34, y: rect.minY + rect.height * controlY),
                controlPoint2: NSPoint(x: rect.minX + rect.width * 0.66, y: rect.minY + rect.height * (controlY - 0.20))
            )
            path.stroke()
        }

        NSColor(calibratedWhite: 0.43, alpha: 0.35).setStroke()
        let ring = NSBezierPath(ovalIn: rect.insetBy(dx: 0.2, dy: 0.2))
        ring.lineWidth = 1.2
        ring.stroke()
        NSGraphicsContext.restoreGraphicsState()
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
        layer?.cornerRadius = 6.5
        layer?.cornerCurve = .continuous
        layer?.backgroundColor = NSColor(calibratedWhite: 0.80, alpha: 0.76).cgColor
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
        font = .systemFont(ofSize: fontSize, weight: .semibold)
        contentTintColor = NSColor(calibratedWhite: 0.48, alpha: 1)
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
        markView.frame = NSRect(x: 18.5, y: 8.5, width: 19, height: 19)

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
        waveformView.audioLevel = CGFloat(max(0, min(1, state.audioLevel ?? 0)))

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
        panel.isMovableByWindowBackground = true

        let view = HudView(frame: NSRect(x: 0, y: 0, width: hudWidth, height: hudHeight))
        view.onStop = { [weak self] in self?.writeCommand("stop") }
        view.onCancel = { [weak self] in self?.writeCommand("cancel") }
        panel.contentView = view

        if let state = readState() {
            view.update(state)
        }

        self.panel = panel
        self.hudView = view
        position(panel)
        panel.orderFrontRegardless()
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(view)
        panel.displayIfNeeded()
        view.displayIfNeeded()
        writeStatus("shown")
    }

    private func position(_ panel: NSPanel) {
        if let anchor = args.anchor {
            position(panel, near: anchor)
            return
        }
        positionNearPointer(panel)
    }

    private func position(_ panel: NSPanel, near anchor: HudAnchor) {
        let screen = screen(containingTopLeftAnchor: anchor)
        let visible = screen.visibleFrame
        let gap: CGFloat = 8
        let preferredTopY = anchor.y + anchor.height + gap
        var originY = screen.frame.maxY - preferredTopY - hudHeight
        if originY < visible.minY + 8 {
            originY = screen.frame.maxY - anchor.y + gap
        }
        let origin = NSPoint(
            x: anchor.x + anchor.width / 2 - hudWidth / 2,
            y: originY
        )
        panel.setFrame(clampedFrame(origin: origin, visibleFrame: visible), display: true)
    }

    private func positionNearPointer(_ panel: NSPanel) {
        let pointerLocation = NSEvent.mouseLocation
        let screenFrame = NSScreen.screens.first(where: { $0.frame.contains(pointerLocation) })?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? NSScreen.screens.first?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var originY = pointerLocation.y - hudHeight - 10
        if originY < screenFrame.minY + 8 {
            originY = pointerLocation.y + 10
        }
        let origin = NSPoint(
            x: pointerLocation.x - hudWidth / 2,
            y: originY
        )
        panel.setFrame(clampedFrame(origin: origin, visibleFrame: screenFrame), display: true)
    }

    private func screen(containingTopLeftAnchor anchor: HudAnchor) -> NSScreen {
        let screens = NSScreen.screens
        for screen in screens {
            let anchorBottomY = screen.frame.maxY - (anchor.y + anchor.height)
            let anchorRect = NSRect(x: anchor.x, y: anchorBottomY, width: anchor.width, height: anchor.height)
            if screen.frame.intersects(anchorRect) || screen.frame.contains(NSPoint(x: anchor.x + anchor.width / 2, y: anchorBottomY + anchor.height / 2)) {
                return screen
            }
        }
        return NSScreen.main ?? screens.first!
    }

    private func clampedFrame(origin: NSPoint, visibleFrame: NSRect) -> NSRect {
        let x = min(max(origin.x, visibleFrame.minX + 8), visibleFrame.maxX - hudWidth - 8)
        let y = min(max(origin.y, visibleFrame.minY + 8), visibleFrame.maxY - hudHeight - 8)
        return NSRect(x: x, y: y, width: hudWidth, height: hudHeight)
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
