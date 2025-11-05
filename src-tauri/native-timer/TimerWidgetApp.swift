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
        // Use Supabase REST API directly - match the web app's Supabase project
        let supabaseURL = "https://bvwgycgdmrozxfmyxpuy.supabase.co"
        let supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2d2d5Y2dkbXJvenhmbXl4cHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzczNDEwMDIsImV4cCI6MjA1MjkxNzAwMn0.ENcTaG68l8hZS8jW8nne8gqQuSqtdknJ5gck-Pg5PCg"
        
        guard let url = URL(string: "\(supabaseURL)/rest/v1/habits?select=*") else {
            print("❌ Invalid Supabase URL for fetching habits")
            completion()
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseKey, forHTTPHeaderField: "apikey")
        
        // Debug logging
        print("🔍 Supabase URL: \(supabaseURL)")
        print("🔍 Supabase Key: \(supabaseKey)")
        print("🔍 Request URL: \(url.absoluteString)")
        
        // Add authentication header
        if let authToken = getAuthTokenFromFile() {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
            print("🔐 Using authentication token for Supabase habits request")
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
            styleMask: [.nonactivatingPanel],
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
        
        // Create draggable view that handles mouse events
        let draggableView = DraggableView(frame: panel.contentView!.bounds, timerWidget: self)
        panel.contentView = draggableView
        
        // Add visual effect view for blur background
        let visualEffect = NSVisualEffectView(frame: draggableView.bounds)
        visualEffect.autoresizingMask = [.width, .height]
        visualEffect.material = .hudWindow
        visualEffect.blendingMode = .behindWindow
        visualEffect.state = .active
        visualEffect.wantsLayer = true
        visualEffect.layer?.cornerRadius = 12
        
        draggableView.addSubview(visualEffect)
        
        // Create timer label
        timerLabel = NSTextField(frame: NSRect(x: 16, y: 15, width: 80, height: 20))
        timerLabel?.stringValue = "00:00"
        timerLabel?.isEditable = false
        timerLabel?.isBordered = false
        timerLabel?.backgroundColor = NSColor.clear
        timerLabel?.textColor = NSColor.labelColor
        timerLabel?.font = NSFont.monospacedSystemFont(ofSize: 14, weight: .medium)
        timerLabel?.alignment = .center
        
        // Create habit selection button with icon
        habitButton = NSButton(frame: NSRect(x: 110, y: 12, width: 110, height: 26))
        habitButton?.title = currentHabit
        habitButton?.bezelStyle = .rounded
        habitButton?.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        habitButton?.target = self
        habitButton?.action = #selector(showHabitMenu)
        
        // Set icon for current habit
        if let icon = getIconForHabit(currentHabit) {
            habitButton?.image = icon
            habitButton?.imagePosition = .imageLeading
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
        
        // Create play/pause button with hover effects
        playButton = HoverButton(frame: NSRect(x: 230, y: 12, width: 26, height: 26))
        playButton?.title = ""
        playButton?.image = NSImage(systemSymbolName: "play.fill", accessibilityDescription: "Play")
        playButton?.bezelStyle = .circular
        playButton?.isBordered = true
        playButton?.target = self
        playButton?.action = #selector(toggleTimer)
        
        // Create close button with hover effects
        closeButton = HoverButton(frame: NSRect(x: 280, y: 12, width: 26, height: 26))
        closeButton?.title = ""
        closeButton?.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close")
        closeButton?.bezelStyle = .circular
        closeButton?.isBordered = true
        closeButton?.target = self
        closeButton?.action = #selector(closeWidget)
        
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
        
        if isRunning {
            // Start timer
            startTime = Date()
            timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
                self.seconds += 1
                self.updateTimerDisplay()
            }
            playButton?.image = NSImage(systemSymbolName: "pause.fill", accessibilityDescription: "Pause")
            print("⏰ Timer started for \(currentHabit)")
        } else {
            // Stop timer and log time
            timer?.invalidate()
            timer = nil
            playButton?.image = NSImage(systemSymbolName: "play.fill", accessibilityDescription: "Play")
            
            if seconds > 0 {
                logTimeToHabit()
            }
            print("⏸️ Timer paused")
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
        habitButton?.title = currentHabit
        
        // Update button icon
        if let icon = getIconForHabit(currentHabit) {
            habitButton?.image = icon
            habitButton?.imagePosition = .imageLeading
        }
        
        print("🎯 Selected habit: \(currentHabit)")
    }
    
    @objc func selectHabitFromCustomMenu(_ sender: CustomHoverButton) {
        print("🎯 Habit selected from custom menu: \(sender.habitName)")
        currentHabit = sender.habitName
        habitButton?.title = currentHabit
        
        // Update button icon
        if let icon = getIconForHabit(currentHabit) {
            habitButton?.image = icon
            habitButton?.imagePosition = .imageLeading
        }
        customMenuPanel?.close()
        customMenuPanel = nil
        print("✅ Updated current habit to: \(currentHabit)")
    }
    
    func logTimeToHabit() {
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        let timeString = String(format: "%02d:%02d", minutes, remainingSeconds)
        let durationInSeconds = seconds
        
        print("📊 Logging \(timeString) (\(durationInSeconds) seconds) for \(currentHabit)")
        
        // Send time data to Tauri backend via HTTP API
        sendTimeLogToBackend(habitName: currentHabit, durationInSeconds: durationInSeconds) { [weak self] success in
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
        // Direct write to Tinybird (bypassing AI processing for speed)
        guard let url = URL(string: "https://api.us-east.aws.tinybird.co/v0/events?name=habit_logs") else {
            print("❌ Invalid Tinybird API URL")
            completion(false)
            return
        }
        
        // Get Tinybird token from environment variable file
        let tinybirdToken = "p.eyJ1IjogIjljMTA0NGJhLTM5NjAtNDZkOS1iMWQ5LTAyY2Q2OTc5ZDVlOSIsICJpZCI6ICJjYjJlMTUwYi02YTg0LTQyMjgtYjdkZi1mYThkYjFhODEwMzQiLCAiaG9zdCI6ICJ1cy1lYXN0LWF3cyJ9.5wH8BHeMPTid8vpvameDP_6FuJF3npb2IcCtFVeaSGA"
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(tinybirdToken)", forHTTPHeaderField: "Authorization")
        
        print("🔐 Using Tinybird token for direct API request")
        
        let userId = "05cbe689-f7ec-487b-adb6-ad50c7dc767b"
        let minutes = durationInSeconds / 60
        let seconds = durationInSeconds % 60
        
        // Create ISO8601 formatter for timestamps
        let timeFormatter = ISO8601DateFormatter()
        timeFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let currentTimestamp = timeFormatter.string(from: Date())
        let currentDate = String(currentTimestamp.prefix(10)) // YYYY-MM-DD
        
        // Format data directly for Tinybird schema
        // Avoid null values by using empty strings and zeros
        let logData: [String: Any] = [
            "id": UUID().uuidString,
            "habit_id": habitId,
            "habit_name": currentHabit,
            "user_id": userId,
            "date": currentDate,
            "timestamp": currentTimestamp,
            "status": "completed",
            "duration": durationInSeconds,
            "amount": 0,
            "unit": "Minutes",
            "notes": "Logged from native timer widget",
            "source": "manual",
            "integration_id": "",
            "whoop_metric_type": "",
            "metadata": "{}",
            "created_at": currentTimestamp
        ]
        
        print("🔍 Sending direct to Tinybird: \(logData)")
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
                        print("🔍 Tinybird Response: \(responseString)")
                    }
                    
                    // Tinybird returns 202 Accepted for successful event ingestion
                    if httpResponse.statusCode == 202 {
                        print("✅ Successfully logged habit directly to Tinybird")
                        
                        // Notify the dashboard to refresh by writing a trigger file
                        self.notifyDashboardRefresh()
                        
                        // Clear metrics cache for immediate dashboard update
                        self.clearMetricsCache()
                        
                        completion(true)
                    } else {
                        print("❌ Tinybird error: \(httpResponse.statusCode)")
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
        // Call the API endpoint to clear metrics cache for immediate dashboard update
        guard let url = URL(string: "http://localhost:3000/api/clear-metrics-cache") else {
            print("❌ Invalid URL for clearing metrics cache")
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        let task = URLSession.shared.dataTask(with: request) { _, response, error in
            if let error = error {
                print("❌ Error clearing metrics cache: \(error.localizedDescription)")
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                print("✅ Metrics cache cleared successfully")
            } else {
                print("⚠️ Unexpected response when clearing metrics cache")
            }
        }
        
        task.resume()
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
        let timeString = String(format: "%02d:%02d:%02d", hours, minutes, secs)
        
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

// Custom button with hover effect for widget buttons
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
        self.alphaValue = 0.7
    }
    
    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        self.alphaValue = 1.0
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