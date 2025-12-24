import Foundation

/// App configuration - Simple hardcoded values for your Ritual instance
enum AppConfig {
    
    // MARK: - Clerk Configuration
    
    /// Your Clerk publishable key
    static let clerkPublishableKey = "pk_test_cmF0aW9uYWwtcmF0dGxlci03Ny5jbGVyay5hY2NvdW50cy5kZXYk"
    
    /// Your Clerk frontend API domain (used for associated domains)
    static let clerkFrontendAPI = "rational-rattler-77.clerk.accounts.dev"
    
    // MARK: - API Configuration
    
    /// Backend API base URL
    /// For local development: Use your Mac's IP address (run `ifconfig | grep "inet "` to find it)
    /// For production: Use your deployed API URL
    static var apiBaseURL: String {
        #if DEBUG
        // Local development - update this IP if your network changes
        return "http://192.168.1.237:8000"
        #else
        // Production
        return "https://api.ritual.app"
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

