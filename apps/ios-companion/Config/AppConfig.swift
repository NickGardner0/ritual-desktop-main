import Foundation

/// App configuration loaded from build settings / Info.plist.
enum AppConfig {
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
    
    // MARK: - App Info
    
    static var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Ritual"
    }
    
    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
}
