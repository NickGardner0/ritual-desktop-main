import Foundation
import ProjectDescription

let screenTimeEnabled = ProcessInfo.processInfo.environment["RITUAL_ENABLE_SCREEN_TIME"] == "1"

var appInfoPlist: [String: Plist.Value] = [
    "CFBundleDisplayName": "Ritual",
    "UILaunchScreen": [:],
    "NSBluetoothAlwaysUsageDescription": "Ritual uses Bluetooth to connect to your wearable heart-rate broadcast so it can power your personal metrics and biometrics features.",
    "NSHealthShareUsageDescription": "Ritual needs access to read your health data to sync steps, active energy, and other metrics with your desktop app.",
    "NSHealthUpdateUsageDescription": "Ritual needs access to write health data to record your tracked habits.",
    "ITSAppUsesNonExemptEncryption": false,
    "BGTaskSchedulerPermittedIdentifiers": [
        "com.ritual.companion.healthsync",
        "com.ritual.companion.healthsync.v2"
    ],
    "UIBackgroundModes": [
        "fetch",
        "processing",
        "bluetooth-central"
    ],
    "RitualClerkPublishableKey": "$(CLERK_PUBLISHABLE_KEY)",
    "RitualClerkFrontendAPI": "$(CLERK_FRONTEND_API)",
    "RitualAPIBaseURLDebug": "$(API_BASE_URL_DEBUG)",
    "RitualAPIBaseURL": "$(API_BASE_URL)",
    "RitualScreenTimeEnabled": .boolean(screenTimeEnabled),
]

var appEntitlements: [String: Plist.Value] = [
    "com.apple.developer.healthkit": true,
    "com.apple.developer.healthkit.access": [
        "health-records"
    ],
    "com.apple.developer.healthkit.background-delivery": true,
    "com.apple.developer.associated-domains": [
        "webcredentials:rational-rattler-77.clerk.accounts.dev"
    ],
]

if screenTimeEnabled {
    appEntitlements["com.apple.developer.family-controls"] = true
    appEntitlements["com.apple.security.application-groups"] = [
        "group.com.ritual.companion"
    ]
}

var companionDependencies: [TargetDependency] = [
    .package(product: "Clerk"),
    .target(name: "RitualScreenTimeShared"),
]

let projectTargets: [Target] = {
    var targets: [Target] = [
        .target(
            name: "RitualCompanion",
            destinations: .iOS,
            product: .app,
            bundleId: "com.ritual.companion",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .extendingDefault(with: appInfoPlist),
            sources: ["Sources/RitualCompanion/**"],
            resources: ["Resources/**"],
            entitlements: .dictionary(appEntitlements),
            dependencies: companionDependencies
        ),
        .target(
            name: "RitualScreenTimeShared",
            destinations: .iOS,
            product: .framework,
            bundleId: "com.ritual.companion.screentime-shared",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .default,
            sources: ["Sources/RitualScreenTimeShared/**"]
        ),
    ]

    if screenTimeEnabled {
        targets.append(
            .target(
                name: "RitualScreenTimeReportExtension",
                destinations: .iOS,
                product: .appExtension,
                bundleId: "com.ritual.companion.screentime-report",
                deploymentTargets: .iOS("17.0"),
                infoPlist: .extendingDefault(with: [
                    "NSExtension": [
                        "NSExtensionPointIdentifier": "com.apple.deviceactivity-report-extension",
                        "NSExtensionPrincipalClass": "$(PRODUCT_MODULE_NAME).ScreenTimeReportExtension"
                    ]
                ]),
                sources: ["Sources/RitualScreenTimeReportExtension/**"],
                entitlements: .dictionary([
                    "com.apple.developer.family-controls": true,
                    "com.apple.security.application-groups": [
                        "group.com.ritual.companion"
                    ]
                ]),
                dependencies: [
                    .target(name: "RitualScreenTimeShared")
                ]
            )
        )
    }

    targets.append(
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
        )
    )

    return targets
}()

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
    targets: projectTargets
)
