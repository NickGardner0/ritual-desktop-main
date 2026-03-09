import ProjectDescription

let project = Project(
    name: "RitualCompanion",
    organizationName: "Ritual",
    options: .options(
        automaticSchemesOptions: .enabled(),
        developmentRegion: "en"
    ),
    packages: [
        .remote(
            url: "https://github.com/clerk/clerk-ios",
            requirement: .upToNextMajor(from: "0.50.0")
        )
    ],
    targets: [
        .target(
            name: "RitualCompanion",
            destinations: .iOS,
            product: .app,
            bundleId: "com.ritual.companion",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .extendingDefault(with: [
                "CFBundleDisplayName": "Ritual",
                "UILaunchScreen": [:],
                "NSHealthShareUsageDescription": "Ritual needs access to read your health data to sync steps, active energy, and other metrics with your desktop app.",
                "NSHealthUpdateUsageDescription": "Ritual needs access to write health data to record your tracked habits.",
                "ITSAppUsesNonExemptEncryption": false,
                // Background task registration - required for BGTaskScheduler
                "BGTaskSchedulerPermittedIdentifiers": [
                    "com.ritual.companion.healthsync",
                    "com.ritual.companion.healthsync.v2"
                ],
                // Enable background modes for fetch and processing
                "UIBackgroundModes": [
                    "fetch",
                    "processing"
                ],
                // Runtime configuration values injected via build settings.
                "RitualClerkPublishableKey": "$(CLERK_PUBLISHABLE_KEY)",
                "RitualClerkFrontendAPI": "$(CLERK_FRONTEND_API)",
                "RitualAPIBaseURLDebug": "$(API_BASE_URL_DEBUG)",
                "RitualAPIBaseURL": "$(API_BASE_URL)"
            ]),
            sources: ["Sources/**"],
            resources: ["Resources/**"],
            entitlements: .dictionary([
                "com.apple.developer.healthkit": true,
                "com.apple.developer.healthkit.access": [
                    "health-records"
                ],
                "com.apple.developer.healthkit.background-delivery": true,
                "com.apple.developer.associated-domains": [
                    "webcredentials:rational-rattler-77.clerk.accounts.dev"
                ],
            ]),
            dependencies: [
                .package(product: "Clerk")
            ]
        ),
        .target(
            name: "RitualCompanionTests",
            destinations: .iOS,
            product: .unitTests,
            bundleId: "com.ritual.companion.tests",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .default,
            sources: ["Tests/**"],
            dependencies: [
                .target(name: "RitualCompanion")
            ]
        ),
    ]
)
