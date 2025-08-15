// TimerWidget.swift
import Cocoa

@objc public class TimerWidget: NSObject {
    static var panel: NSPanel?
    
    @objc public static func launch() {
        DispatchQueue.main.async {
            let panel = NSPanel(
                contentRect: NSRect(x: 100, y: 100, width: 300, height: 120),
                styleMask: [.nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            panel.level = .floating
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = true
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isReleasedWhenClosed = false
            
            let visualEffect = NSVisualEffectView(frame: panel.contentView!.bounds)
            visualEffect.autoresizingMask = [.width, .height]
            visualEffect.material = .hudWindow
            visualEffect.blendingMode = .behindWindow
            visualEffect.state = .active
            
            panel.contentView?.addSubview(visualEffect)
            TimerWidget.panel = panel
            panel.orderFrontRegardless()
        }
    }
}

// C wrapper function for FFI
@_cdecl("launch_floating_timer")
public func launch_floating_timer() {
    TimerWidget.launch()
}