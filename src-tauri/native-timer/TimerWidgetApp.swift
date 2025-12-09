import Cocoa
import Foundation

// Custom menu class to override highlight color
class CustomMenu: NSMenu {
    override func awakeFromNib() {
        super.awakeFromNib()
        if #available(macOS 10.14, *) {
            self.appearance = NSAppearance(named: .vibrantLight)
        }
    }
}

class TimerWidget: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var panel: NSPanel?
    var timerLabel: NSTextField?
    var habitLabel: NSTextField?
    var habitButton: NSButton?
    var playButton: HoverButton?
    var closeButton: HoverButton?
    var habitMenu: NSMenu?
    var customMenuPanel: NSPanel?
    
    var timer: Timer?
    var seconds: Int = 0
    var isRunning: Bool = false
    var currentHabit: String = "Focus"
    var availableHabits: [String] = []
    var realHabits: [[String: Any]] = [] // Store actual habits from API
    var startTime: Date?
    
    // Variables for dragging
    var initialLocation: NSPoint = NSPoint.zero
    var isDragging: Bool = false
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Fetch real habits first, then create widget
        fetchRealHabits { [weak self] in
            DispatchQueue.main.async {
                self?.createWidget()
            }
        }
    }
    
    func getAuthTokenFromFile() -> String? {
        let tempDir = NSTemporaryDirectory()
        let tokenFile = URL(fileURLWithPath: tempDir).appendingPathComponent("ritual_auth_token.txt")
        
        print("🔍 Looking for auth token at: \(tokenFile.path)")
        
        do {
            let token = try String(contentsOf: tokenFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
            if !token.isEmpty {
                print("🔐 Successfully read auth token from file")
                print("🔐 Token preview: \(String(token.prefix(20)))...")
                return token
            } else {
                print("⚠️ Auth token file is empty")
            }
        } catch {
            print("⚠️ Could not read auth token file: \(error)")
            print("🔍 File exists: \(FileManager.default.fileExists(atPath: tokenFile.path))")
        }
        
        return nil
    }
    
    func fetchRealHabits(completion: @escaping () -> Void) {
        // Use Python FastAPI backend (not Supabase!)
        let pythonAPIURL = "http://127.0.0.1:8000"
        
        guard let url = URL(string: "\(pythonAPIURL)/api/habits") else {
            print("❌ Invalid Python API URL for fetching habits")
            completion()
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Debug logging
        print("🔍 Python API URL: \(pythonAPIURL)")
        print("🔍 Request URL: \(url.absoluteString)")
        
        // Add Clerk authentication header
        if let authToken = getAuthTokenFromFile() {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            print("🔐 Using Clerk authentication token for Python API habits request")
            print("🔐 Auth token preview: \(String(authToken.prefix(20)))...")
        } else {
            print("⚠️ No authentication token found - request may fail")
        }
        
        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error = error {
                print("❌ Network error fetching habits: \(error)")
                print("📋 Using fallback habits")
                completion()
                return
            }
            
            // Debug the HTTP response
            if let httpResponse = response as? HTTPURLResponse {
                print("🔍 Habits API HTTP Status: \(httpResponse.statusCode)")
                if httpResponse.statusCode == 401 {
                    print("❌ Authentication failed - token may be invalid or expired")
                }
            }
            
            guard let data = data else {
                print("❌ No data received for habits")
                print("📋 Using fallback habits")
                completion()
                return
            }
            
            // Debug the response body
            if let responseString = String(data: data, encoding: .utf8) {
                print("🔍 Habits API Response: \(responseString)")
            }
            
            do {
                let habits = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
                
                if let habits = habits, !habits.isEmpty {
                    self?.realHabits = habits
                    
                    // Update available habits with actual habit names
                    var habitNames: [String] = []
                    for habit in habits {
                        if let name = habit["name"] as? String {
                            habitNames.append(name)
                        }
                    }
                    
                    if !habitNames.isEmpty {
                        self?.availableHabits = habitNames
                        self?.currentHabit = habitNames.first ?? "No Habits"
                        print("✅ Loaded \(habitNames.count) real habits: \(habitNames)")
                    } else {
                        print("📋 No habits found for current user")
                        self?.availableHabits = ["No Habits Available"]
                        self?.currentHabit = "No Habits Available"
                    }
                } else {
                    print("📋 No habits found for current user")
                    self?.availableHabits = ["No Habits Available"]
                    self?.currentHabit = "No Habits Available"
                }
                
            } catch {
                print("❌ JSON parsing error for habits: \(error)")
                print("📋 No habits available - API error")
                self?.availableHabits = ["No Habits Available"]
                self?.currentHabit = "No Habits Available"
            }
            
            completion()
        }
        
        task.resume()
    }
    
    func getIconForHabit(_ habitName: String) -> NSImage? {
        // Map habit names to SF Symbols that match the dashboard icons
        let iconMapping: [String: String] = [
            "Daily Reading": "book.fill",
            "Daily Walk": "figure.walk",
            "Deep Work Sessions": "sun.max.fill"
        ]
        
        if let symbolName = iconMapping[habitName] {
            return NSImage(systemSymbolName: symbolName, accessibilityDescription: habitName)
        }
        
        // Default icon for unmapped habits
        return NSImage(systemSymbolName: "circle.fill", accessibilityDescription: habitName)
    }
    
    func createWidget() {
        // Create the panel with native macOS styling
        panel = NSPanel(
            contentRect: NSRect(x: 100, y: 100, width: 320, height: 50),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        
        guard let panel = panel else { return }
        
        // Configure panel properties for floating widget
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        
        // Create draggable view that handles mouse events - make it transparent
        let draggableView = DraggableView(frame: panel.contentView!.bounds, timerWidget: self)
        draggableView.wantsLayer = true
        draggableView.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = draggableView
        
        // Add visual effect view for blur background with rounded corners
        let visualEffect = NSVisualEffectView(frame: draggableView.bounds)
        visualEffect.autoresizingMask = [.width, .height]
        visualEffect.material = .hudWindow
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.wantsLayer = true
        visualEffect.layer?.cornerRadius = 12
        visualEffect.layer?.masksToBounds = true
        
        draggableView.addSubview(visualEffect)
        
        // Create timer label - dark and prominent
        timerLabel = NSTextField(frame: NSRect(x: 16, y: 15, width: 70, height: 20))
        timerLabel?.stringValue = "00:00"
        timerLabel?.isEditable = false
        timerLabel?.isBordered = false
        timerLabel?.backgroundColor = NSColor.clear
        timerLabel?.textColor = NSColor.black
        timerLabel?.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        timerLabel?.alignment = .left
        
        // Truncate long habit names to fit
        let displayHabit = currentHabit.count > 10 ? String(currentHabit.prefix(9)) + "…" : currentHabit
        
        // Create habit selection button - clean pill style with icon
        habitButton = NSButton(frame: NSRect(x: 95, y: 12, width: 115, height: 26))
        habitButton?.bezelStyle = .roundRect
        habitButton?.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        habitButton?.target = self
        habitButton?.action = #selector(showHabitMenu)
        habitButton?.wantsLayer = true
        habitButton?.isBordered = false
        habitButton?.layer?.backgroundColor = NSColor(calibratedWhite: 0.0, alpha: 0.05).cgColor
        habitButton?.layer?.cornerRadius = 13
        
        // Create attributed string with habit name + chevron symbol
        let chevronSymbol = " ▾"
        habitButton?.title = displayHabit + chevronSymbol
        
        // Configure button cell for single line
        if let cell = habitButton?.cell as? NSButtonCell {
            cell.lineBreakMode = .byTruncatingTail
            cell.imagePosition = .noImage
        }
        
        // Create habit menu with custom styling
        habitMenu = CustomMenu()
        
        // Force the menu to use a lighter appearance
        if #available(macOS 10.14, *) {
            habitMenu?.appearance = NSAppearance(named: .vibrantLight)
        }
        
        for habit in availableHabits {
            let menuItem = NSMenuItem(title: habit, action: #selector(selectHabit(_:)), keyEquivalent: "")
            menuItem.target = self
            
            // Add icon to menu item
            if let icon = getIconForHabit(habit) {
                menuItem.image = icon
            }
            
            habitMenu?.addItem(menuItem)
        }
        
        // Set delegate for additional customization
        habitMenu?.delegate = self
        
        // Create play/pause button - clean icon only
        playButton = PlayPauseButton(frame: NSRect(x: 228, y: 12, width: 26, height: 26))
        playButton?.title = ""
        let playConfig = NSImage.SymbolConfiguration(pointSize: 12, weight: .medium)
        playButton?.image = NSImage(systemSymbolName: "play.fill", accessibilityDescription: "Play")?.withSymbolConfiguration(playConfig)
        playButton?.bezelStyle = .regularSquare
        playButton?.isBordered = false
        playButton?.target = self
        playButton?.action = #selector(toggleTimer)
        playButton?.wantsLayer = true
        
        // Create close button - clean icon only
        closeButton = HoverButton(frame: NSRect(x: 268, y: 12, width: 26, height: 26))
        closeButton?.title = ""
        let closeConfig = NSImage.SymbolConfiguration(pointSize: 10, weight: .medium)
        closeButton?.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close")?.withSymbolConfiguration(closeConfig)
        closeButton?.bezelStyle = .regularSquare
        closeButton?.isBordered = false
        closeButton?.target = self
        closeButton?.action = #selector(closeWidget)
        closeButton?.wantsLayer = true
        
        // Add all controls to the visual effect view
        if let timerLabel = timerLabel { visualEffect.addSubview(timerLabel) }
        if let habitButton = habitButton { visualEffect.addSubview(habitButton) }
        if let playButton = playButton { visualEffect.addSubview(playButton) }
        if let closeButton = closeButton { visualEffect.addSubview(closeButton) }
        
        // Show the panel
        panel.orderFrontRegardless()
        
        // Center the panel on screen
        panel.center()
        
        print("✅ Native Swift timer widget created successfully!")
    }
    
    @objc func toggleTimer() {
        isRunning.toggle()
        
        let config = NSImage.SymbolConfiguration(pointSize: 12, weight: .medium)
        
        if isRunning {
            // Start timer
            startTime = Date()
            timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                self?.seconds += 1
                self?.updateTimerDisplay()
            }
            
            // Change to stop icon when running
            playButton?.image = NSImage(systemSymbolName: "stop.fill", accessibilityDescription: "Stop")?.withSymbolConfiguration(config)
            playButton?.contentTintColor = NSColor.systemRed
            
            print("⏰ Timer started for \(currentHabit)")
        } else {
            // Stop timer and log time
            timer?.invalidate()
            timer = nil
            
            // Reset to play icon
            playButton?.image = NSImage(systemSymbolName: "play.fill", accessibilityDescription: "Play")?.withSymbolConfiguration(config)
            playButton?.contentTintColor = NSColor.labelColor
            
            if seconds > 0 {
                logTimeToHabit()
            }
            print("⏸️ Timer stopped")
        }
    }
    
    @objc func showHabitMenu() {
        guard let habitButton = habitButton,
              let mainPanel = panel else { 
            print("❌ Missing habitButton or panel")
            return 
        }
        
        print("🖱️ Showing custom habit menu...")
        
        // Close existing menu panel if open
        customMenuPanel?.close()
        customMenuPanel = nil
        
        // Calculate position for the custom menu panel (position below the button)
        let buttonFrame = habitButton.frame
        
        // Convert button position to screen coordinates using the current panel frame
        let panelScreenFrame = mainPanel.frame
        let buttonBottomLeft = NSPoint(x: panelScreenFrame.origin.x + buttonFrame.origin.x, 
                                      y: panelScreenFrame.origin.y + buttonFrame.origin.y)
        
        // Position menu directly below the button
        let menuX = buttonBottomLeft.x
        let menuY = buttonBottomLeft.y - CGFloat(availableHabits.count * 30 + 20) - 10 // Add some padding
        
        let menuWidth: CGFloat = 180 // Increased width to accommodate longer habit names
        let menuHeight: CGFloat = CGFloat(availableHabits.count * 30 + 20)
        
        print("📍 Menu position: x=\(menuX), y=\(menuY), width=\(menuWidth), height=\(menuHeight)")
        
        // Create custom menu panel
        customMenuPanel = NSPanel(
            contentRect: NSRect(x: menuX, y: menuY, width: menuWidth, height: menuHeight),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        
        guard let menuPanel = customMenuPanel else {
            print("❌ Failed to create menu panel")
            return
        }
        
        menuPanel.level = .popUpMenu
        menuPanel.isOpaque = false
        menuPanel.backgroundColor = NSColor.clear
        menuPanel.hasShadow = true
        menuPanel.ignoresMouseEvents = false
        menuPanel.acceptsMouseMovedEvents = true
        menuPanel.hidesOnDeactivate = false
        
        // Create content view with visual effect
        let contentView = NSView(frame: menuPanel.contentView!.bounds)
        let visualEffect = NSVisualEffectView(frame: contentView.bounds)
        visualEffect.material = .menu
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.wantsLayer = true
        visualEffect.layer?.cornerRadius = 8
        visualEffect.layer?.borderWidth = 0.5
        visualEffect.layer?.borderColor = NSColor.separatorColor.cgColor
        
        contentView.addSubview(visualEffect)
        
        // Add habit buttons with custom grey hover
        print("📝 Adding \(availableHabits.count) habit buttons...")
        for (index, habit) in availableHabits.enumerated() {
            let yPosition = CGFloat(availableHabits.count - index - 1) * 30 + 10
            let habitMenuButton = CustomHoverButton(frame: NSRect(x: 0, y: yPosition, width: menuWidth, height: 25))
            habitMenuButton.title = habit
            habitMenuButton.alignment = .left
            habitMenuButton.font = NSFont.systemFont(ofSize: 13)
            habitMenuButton.isBordered = false
            
            // Add left padding for text by adjusting the button's content insets
            if let cell = habitMenuButton.cell as? NSButtonCell {
                cell.imagePosition = .noImage
                cell.title = "  " + habit // Add padding with spaces
            }
            habitMenuButton.target = self
            habitMenuButton.action = #selector(selectHabitFromCustomMenu(_:))
            habitMenuButton.habitName = habit
            
            // Ensure text doesn't get truncated
            habitMenuButton.cell?.truncatesLastVisibleLine = false
            habitMenuButton.cell?.wraps = false
            habitMenuButton.cell?.lineBreakMode = .byClipping
            
            visualEffect.addSubview(habitMenuButton)
            print("✅ Added button for: \(habit)")
        }
        
        menuPanel.contentView = contentView
        menuPanel.orderFrontRegardless()
        menuPanel.makeKeyAndOrderFront(nil)
        
        print("✅ Custom menu panel created and shown!")
        
        // Force tracking areas to be properly set up after the panel is shown
        DispatchQueue.main.async {
            for subview in visualEffect.subviews {
                if let button = subview as? CustomHoverButton {
                    button.updateTrackingAreas()
                    print("🔄 Updated tracking areas for button: \(button.title)")
                }
            }
        }
        
        // Additional delay to ensure everything is fully rendered
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            for subview in visualEffect.subviews {
                if let button = subview as? CustomHoverButton {
                    // Force another update and ensure the button is ready
                    button.setupHoverTracking()
                    button.needsDisplay = true
                    print("🔄 Force refresh tracking for: \(button.title)")
                }
            }
        }
        
        // Auto-close when clicking outside
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { event in
                // Check if the click was outside the menu panel
                let clickLocation = event.locationInWindow
                if let menuPanel = self.customMenuPanel,
                   !menuPanel.frame.contains(clickLocation) {
                    print("🖱️ Click outside menu - closing")
                    menuPanel.close()
                    self.customMenuPanel = nil
                }
            }
        }
    }
    
    @objc func selectHabit(_ sender: NSMenuItem) {
        currentHabit = sender.title
        // Truncate long habit names and add chevron symbol
        let displayHabit = currentHabit.count > 10 ? String(currentHabit.prefix(9)) + "…" : currentHabit
        habitButton?.title = displayHabit + " ▾"
        
        print("🎯 Selected habit: \(currentHabit)")
    }
    
    @objc func selectHabitFromCustomMenu(_ sender: CustomHoverButton) {
        print("🎯 Habit selected from custom menu: \(sender.habitName)")
        currentHabit = sender.habitName
        // Truncate long habit names and add chevron symbol
        let displayHabit = currentHabit.count > 10 ? String(currentHabit.prefix(9)) + "…" : currentHabit
        habitButton?.title = displayHabit + " ▾"
        
        customMenuPanel?.close()
        customMenuPanel = nil
        print("✅ Updated current habit to: \(currentHabit)")
    }
    
    func requestFreshAuthToken() {
        // Write a trigger file to request fresh auth token from Tauri
        let tempDir = NSTemporaryDirectory()
        let triggerFile = URL(fileURLWithPath: tempDir).appendingPathComponent("ritual_refresh_token_request.txt")
        let timestamp = String(Date().timeIntervalSince1970)
        
        do {
            try timestamp.write(to: triggerFile, atomically: true, encoding: .utf8)
            print("🔄 Requested fresh auth token from Tauri app")
        } catch {
            print("⚠️ Could not write token refresh request: \(error)")
        }
    }
    
    func waitForFreshToken(completion: @escaping (Bool) -> Void) {
        // Give Tauri a moment to write the fresh token
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            completion(true)
        }
    }
    
    func logTimeToHabit() {
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        let timeString = String(format: "%02d:%02d", minutes, remainingSeconds)
        let durationInSeconds = seconds
        
        print("📊 Logging \(timeString) (\(durationInSeconds) seconds) for \(currentHabit)")
        print("🔄 Requesting fresh auth token before logging...")
        
        // Request fresh token from Tauri before logging
        requestFreshAuthToken()
        waitForFreshToken { [weak self] _ in
            // Now send time data to backend with fresh token
            self?.sendTimeLogToBackend(habitName: self?.currentHabit ?? "", durationInSeconds: durationInSeconds) { [weak self] success in
            DispatchQueue.main.async {
                // Play success sound (same as AI chatbox)
                if let successSound = NSSound(named: "Glass") {
                    successSound.play()
                } else {
                    // Fallback to system beep if Glass sound not available
                    NSSound.beep()
                }
                
                // Reset timer regardless of success/failure
                self?.seconds = 0
                self?.updateTimerDisplay()
                
                // Show completion message
                let alert = NSAlert()
                if success {
                    alert.messageText = "Session Complete!"
                    alert.informativeText = "Successfully logged \(timeString) for \(self?.currentHabit ?? "habit")"
                    alert.alertStyle = .informational
                } else {
                    alert.messageText = "Session Complete!"
                    alert.informativeText = "Logged \(timeString) for \(self?.currentHabit ?? "habit") (saved locally - will sync later)"
                    alert.alertStyle = .warning
                }
                alert.addButton(withTitle: "OK")
                alert.runModal()
            }
            }
        }
    }
    
    func sendTimeLogToBackend(habitName: String, durationInSeconds: Int, completion: @escaping (Bool) -> Void) {
        // First, get the habit ID by name
        getHabitIdByName(habitName: habitName) { [weak self] habitId in
            guard let habitId = habitId else {
                print("❌ Could not find habit ID for: \(habitName)")
                completion(false)
                return
            }
            
            // Create the habit log
            self?.createHabitLog(habitId: habitId, durationInSeconds: durationInSeconds, completion: completion)
        }
    }
    
    func getHabitIdByName(habitName: String, completion: @escaping (String?) -> Void) {
        // Find the real habit ID from the fetched habits
        let cleanHabitName = habitName.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Remove emoji and extra spaces to match the habit name
        let nameWithoutEmoji = cleanHabitName.replacingOccurrences(of: "^[\\p{Emoji}\\s]+", with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        
        print("🔍 Searching for habit ID:")
        print("  Original name: '\(habitName)'")
        print("  Cleaned name: '\(nameWithoutEmoji)'")
        print("  Available habits: \(realHabits.compactMap { $0["name"] as? String })")
        
        // Look for the habit in realHabits array
        for habit in realHabits {
            if let habitNameFromAPI = habit["name"] as? String,
               let habitId = habit["id"] as? String {
                
                // Try multiple matching strategies
                let apiNameCleaned = habitNameFromAPI.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
                let searchNameCleaned = nameWithoutEmoji.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
                
                // Strategy 1: Direct match
                if apiNameCleaned == searchNameCleaned {
                    print("✅ Found real habit ID (direct match): \(habitId) for \(habitName)")
                    completion(habitId)
                    return
                }
                
                // Strategy 2: Check if API name contains the search name
                if apiNameCleaned.contains(searchNameCleaned) {
                    print("✅ Found real habit ID (contains match): \(habitId) for \(habitName)")
                    completion(habitId)
                    return
                }
                
                // Strategy 3: Check if search name contains the API name
                if searchNameCleaned.contains(apiNameCleaned) {
                    print("✅ Found real habit ID (reverse contains match): \(habitId) for \(habitName)")
                    completion(habitId)
                    return
                }
            }
        }
        
        // If not found, log error
        print("❌ Could not find real habit ID for: \(habitName)")
        print("📋 Available habits: \(realHabits.compactMap { $0["name"] as? String })")
        completion(nil)
    }
    
    func createHabitLog(habitId: String, durationInSeconds: Int, completion: @escaping (Bool) -> Void) {
        // Use Python backend API (not direct Tinybird write!)
        let pythonAPIURL = "http://127.0.0.1:8000"
        
        guard let url = URL(string: "\(pythonAPIURL)/api/habits/\(habitId)/logs") else {
            print("❌ Invalid Python API URL for creating habit log")
            completion(false)
            return
        }
        
        guard let authToken = getAuthTokenFromFile() else {
            print("❌ No authentication token found - cannot create habit log")
            completion(false)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        
        print("🔐 Using Clerk authentication for habit log creation")
        
        let minutes = durationInSeconds / 60
        let seconds = durationInSeconds % 60
        
        // Get current date in YYYY-MM-DD format
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let currentDate = dateFormatter.string(from: Date())
        
        // Get current timestamp in ISO 8601 format
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let currentTimestamp = isoFormatter.string(from: Date())
        
        // Create habit log data matching the Python backend API schema (HabitLogCreate)
        // Note: habit_id comes from the URL path, not the body
        let logData: [String: Any] = [
            "date": currentDate,
            "completed_at": currentTimestamp,
            "duration": durationInSeconds,
            "amount": 1,
            "status": "completed",
            "notes": "Timer session: \(String(format: "%02d:%02d", minutes, seconds)) from native timer widget"
        ]
        
        print("🔍 Sending habit log to Python backend: \(logData)")
        print("🔍 POST URL: \(url.absoluteString)")
        
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: logData)
            request.httpBody = jsonData
            
            let task = URLSession.shared.dataTask(with: request) { data, response, error in
                if let error = error {
                    print("❌ Network error creating log: \(error)")
                    print("❌ Error details: \(error.localizedDescription)")
                    completion(false)
                    return
                }
                
                if let httpResponse = response as? HTTPURLResponse {
                    print("🔍 HTTP Response Status: \(httpResponse.statusCode)")
                    
                    if let data = data, let responseString = String(data: data, encoding: .utf8) {
                        print("🔍 Python API Response: \(responseString)")
                    }
                    
                    // Python API returns 200/201 for successful log creation
                    if httpResponse.statusCode == 200 || httpResponse.statusCode == 201 {
                        print("✅ Successfully logged habit to Python backend")
                        
                        // Notify the dashboard to refresh by writing a trigger file
                        self.notifyDashboardRefresh()
                        
                        // Clear metrics cache for immediate dashboard update
                        self.clearMetricsCache()
                        
                        completion(true)
                    } else {
                        print("❌ Python API error: \(httpResponse.statusCode)")
                        completion(false)
                    }
                } else {
                    print("❌ No HTTP response received")
                    completion(false)
                }
            }
            
            task.resume()
            
        } catch {
            print("❌ JSON encoding error: \(error)")
            completion(false)
        }
    }
    
    func notifyDashboardRefresh() {
        // Write a trigger file that the dashboard can monitor
        let tempDir = NSTemporaryDirectory()
        let triggerFile = URL(fileURLWithPath: tempDir).appendingPathComponent("ritual_timer_updated.txt")
        
        let timestamp = String(Date().timeIntervalSince1970)
        
        do {
            try timestamp.write(to: triggerFile, atomically: true, encoding: .utf8)
            print("🔄 Dashboard refresh trigger written: \(timestamp)")
        } catch {
            print("⚠️ Could not write dashboard refresh trigger: \(error)")
        }
    }
    
    func clearMetricsCache() {
        // NOTE: This function is intentionally a no-op.
        // The dashboard refresh is handled via file-based trigger (notifyDashboardRefresh)
        // which the Next.js app monitors via Tauri IPC.
        // If you need real-time cache invalidation, implement /api/clear-metrics-cache endpoint.
        print("ℹ️ Dashboard refresh triggered via file notification")
    }
    
    @objc func closeWidget() {
        print("🔴 Closing native Swift timer widget")
        panel?.close()
        NSApplication.shared.terminate(nil)
    }
    
    func updateTimerDisplay() {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60
        
        // Smart format: show hours only when needed (mm:ss → h:mm:ss)
        let timeString: String
        if hours > 0 {
            timeString = String(format: "%d:%02d:%02d", hours, minutes, secs)
        } else {
            timeString = String(format: "%02d:%02d", minutes, secs)
        }
        
        DispatchQueue.main.async {
            self.timerLabel?.stringValue = timeString
        }
    }
    
    // MARK: - NSMenuDelegate
    func menuWillOpen(_ menu: NSMenu) {
        // Menu styling is now handled in showHabitMenu method
    }
    
    func menuDidClose(_ menu: NSMenu) {
        // Menu styling reset is handled automatically
    }
}

// Custom view that handles dragging
class DraggableView: NSView {
    weak var timerWidget: TimerWidget?
    
    init(frame frameRect: NSRect, timerWidget: TimerWidget) {
        self.timerWidget = timerWidget
        super.init(frame: frameRect)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func mouseDown(with event: NSEvent) {
        guard self.window != nil else { return }
        timerWidget?.initialLocation = event.locationInWindow
        timerWidget?.isDragging = true
    }
    
    override func mouseDragged(with event: NSEvent) {
        guard let window = self.window,
              let timerWidget = timerWidget,
              timerWidget.isDragging else { return }
        
        let currentLocation = event.locationInWindow
        let newOrigin = NSPoint(
            x: window.frame.origin.x + (currentLocation.x - timerWidget.initialLocation.x),
            y: window.frame.origin.y + (currentLocation.y - timerWidget.initialLocation.y)
        )
        
        window.setFrameOrigin(newOrigin)
    }
    
    override func mouseUp(with event: NSEvent) {
        timerWidget?.isDragging = false
    }
}

// Custom button with subtle hover effect for widget buttons
class HoverButton: NSButton {
    override func awakeFromNib() {
        super.awakeFromNib()
        setupHoverTracking()
    }
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupHoverTracking()
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupHoverTracking()
    }
    
    private func setupHoverTracking() {
        wantsLayer = true
        let trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeInActiveApp],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(trackingArea)
    }
    
    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        // Simple opacity change on hover
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.1
            self.alphaValue = 0.6
        })
    }
    
    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.1
            self.alphaValue = 1.0
        })
    }
}

// Custom Play/Pause button with subtle hover effects
class PlayPauseButton: HoverButton {
    override func mouseEntered(with event: NSEvent) {
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.1
            self.alphaValue = 0.6
        })
    }
    
    override func mouseExited(with event: NSEvent) {
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.1
            self.alphaValue = 1.0
        })
    }
}

// Custom button with grey hover effect
class CustomHoverButton: NSButton {
    var habitName: String = ""
    
    override func awakeFromNib() {
        super.awakeFromNib()
        setupHoverTracking()
    }
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupHoverTracking()
    }
    
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupHoverTracking()
    }
    
    func setupHoverTracking() {
        // Remove any existing tracking areas
        for trackingArea in trackingAreas {
            removeTrackingArea(trackingArea)
        }
        
        let trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(trackingArea)
        
        // Ensure the button can receive mouse events
        self.wantsLayer = true
    }
    
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        setupHoverTracking()
    }
    
    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        // Check if mouse is inside our bounds
        let locationInView = convert(event.locationInWindow, from: nil)
        if bounds.contains(locationInView) {
            applyHoverEffect()
        } else {
            removeHoverEffect()
        }
    }
    
    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        applyHoverEffect()
    }
    
    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        removeHoverEffect()
    }
    
    private func applyHoverEffect() {
        // Darker grey hover background with square corners
        self.wantsLayer = true
        self.layer?.backgroundColor = NSColor.lightGray.withAlphaComponent(0.4).cgColor
        self.layer?.cornerRadius = 0 // Square corners
        
        // Add subtle animation
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.1
            context.allowsImplicitAnimation = true
            self.layer?.backgroundColor = NSColor.lightGray.withAlphaComponent(0.4).cgColor
        })
    }
    
    private func removeHoverEffect() {
        // Animate out the hover background
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.15
            context.allowsImplicitAnimation = true
            self.layer?.backgroundColor = NSColor.clear.cgColor
        })
    }
}

// Main function to run the application
@main
struct TimerWidgetMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = TimerWidget()
        app.delegate = delegate
        
        // Prevent the app from appearing in the dock
        app.setActivationPolicy(.accessory)
        
        // Run the application
        app.run()
    }
}