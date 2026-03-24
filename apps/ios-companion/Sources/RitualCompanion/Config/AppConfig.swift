import Foundation

/// App configuration loaded from build settings / Info.plist.
enum AppConfig {
    private static func configuredBool(
        infoPlistKey: String,
        environmentKey: String
    ) -> Bool? {
        if let envValue = ProcessInfo.processInfo.environment[environmentKey]?.lowercased(), !envValue.isEmpty {
            if ["1", "true", "yes"].contains(envValue) {
                return true
            }
            if ["0", "false", "no"].contains(envValue) {
                return false
            }
        }

        if let value = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? Bool {
            return value
        }

        if let value = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String {
            let lowered = value.lowercased()
            if ["1", "true", "yes"].contains(lowered) {
                return true
            }
            if ["0", "false", "no"].contains(lowered) {
                return false
            }
        }

        return nil
    }

    private static func configuredValue(
        infoPlistKey: String,
        environmentKey: String
    ) -> String? {
        if let envValue = ProcessInfo.processInfo.environment[environmentKey], !envValue.isEmpty {
            return envValue
        }

        guard let value = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String else {
            return nil
        }

        // Ignore unresolved build setting placeholders like "$(CLERK_PUBLISHABLE_KEY)".
        if value.isEmpty || value.contains("$(") {
            return nil
        }

        return value
    }

    private static func requireConfiguredValue(
        infoPlistKey: String,
        environmentKey: String
    ) -> String {
        guard let value = configuredValue(infoPlistKey: infoPlistKey, environmentKey: environmentKey) else {
            fatalError("Missing required iOS config value: \(environmentKey)")
        }
        return value
    }

    private static func configuredURL(
        infoPlistKey: String,
        environmentKey: String
    ) -> URL? {
        guard let value = configuredValue(infoPlistKey: infoPlistKey, environmentKey: environmentKey) else {
            return nil
        }
        return URL(string: value)
    }
    
    // MARK: - Clerk Configuration
    
    static let clerkPublishableKey = requireConfiguredValue(
        infoPlistKey: "RitualClerkPublishableKey",
        environmentKey: "CLERK_PUBLISHABLE_KEY"
    )
    
    static let clerkFrontendAPI = requireConfiguredValue(
        infoPlistKey: "RitualClerkFrontendAPI",
        environmentKey: "CLERK_FRONTEND_API"
    )
    
    // MARK: - API Configuration
    
    static var apiBaseURL: String {
        #if DEBUG
        // Local development default keeps simulator usage simple.
        return configuredValue(
            infoPlistKey: "RitualAPIBaseURLDebug",
            environmentKey: "API_BASE_URL_DEBUG"
        ) ?? "http://127.0.0.1:8000"
        #else
        return requireConfiguredValue(
            infoPlistKey: "RitualAPIBaseURL",
            environmentKey: "API_BASE_URL"
        )
        #endif
    }

    static var localDeviceAPIHint: String? {
        #if DEBUG
        #if targetEnvironment(simulator)
        return nil
        #else
        guard let url = URL(string: apiBaseURL),
              let host = url.host?.lowercased(),
              host == "127.0.0.1" || host == "localhost" else {
            return nil
        }

        return "This build is still pointing to \(host). On iPhone, set API_BASE_URL_DEBUG in Xcode to your Mac's local IP, for example http://192.168.1.20:8000."
        #endif
        #else
        return nil
        #endif
    }

    // MARK: - Web URLs

    static var appWebURL: URL {
        configuredURL(
            infoPlistKey: "RitualAppWebURL",
            environmentKey: "APP_WEB_URL"
        ) ?? URL(string: "https://app.ritual.app")!
    }

    static var desktopSetupURL: URL {
        appWebURL
    }

    static var termsURL: URL {
        appWebURL.appendingPathComponent("terms")
    }

    static var privacyURL: URL {
        appWebURL.appendingPathComponent("privacy")
    }

    static var screenTimeEnabled: Bool {
        configuredBool(
            infoPlistKey: "RitualScreenTimeEnabled",
            environmentKey: "RITUAL_ENABLE_SCREEN_TIME"
        ) ?? false
    }
    
    // MARK: - App Info
    
    static var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Ritual"
    }
    
    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
}
