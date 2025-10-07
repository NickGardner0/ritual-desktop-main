#!/usr/bin/env swift

// Minimal Swift widget using only Core Foundation to avoid Cocoa module conflicts
import Foundation

print("🚀 Native Swift timer widget starting...")

// Create a simple timer that prints to console
// This avoids all the UI framework conflicts
class SimpleTimer {
    var seconds: Int = 0
    var timer: Timer?
    var isRunning: Bool = false
    
    func start() {
        print("⏰ Timer started")
        isRunning = true
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            self.seconds += 1
            let minutes = self.seconds / 60
            let secs = self.seconds % 60
            print("Timer: \(String(format: "%02d:%02d", minutes, secs))")
        }
        
        // Keep the app running
        RunLoop.main.run()
    }
    
    func stop() {
        print("⏹️ Timer stopped")
        timer?.invalidate()
        timer = nil
        isRunning = false
    }
}

// Create and start the timer
let simpleTimer = SimpleTimer()

// Handle termination signals
signal(SIGTERM) { _ in
    print("🔴 Received termination signal")
    exit(0)
}

signal(SIGINT) { _ in
    print("🔴 Received interrupt signal")
    exit(0)
}

print("✅ Starting minimal Swift timer (console-only)...")
simpleTimer.start()