import Foundation
import ProjectDescription

// Tuist 4 sandboxes manifests from the ambient shell env unless the var is
// prefixed with `TUIST_`. Accept both the legacy `RITUAL_ENABLE_SCREEN_TIME=1`
// form (useful outside Tuist) and the Tuist-forwarded
// `TUIST_RITUAL_ENABLE_SCREEN_TIME=1` form so `tuist generate` can opt in.
let screenTimeEnabled = ["RITUAL_ENABLE_SCREEN_TIME", "TUIST_RITUAL_ENABLE_SCREEN_TIME"]
    .contains { ProcessInfo.processInfo.environment[$0] == "1" }

var appInfoPlist: [String: Plist.Value] = [
    "CFBundleDisplayName": "Ritual",
    "UILaunchScreen": [:],
    "NSBluetoothAlwaysUsageDescription": "Ritual uses Bluetooth to connect to your wearable heart-rate broadcast so it can power your personal metrics and biometrics features.",
    "NSHealthShareUsageDescription": "Ritual needs access to read your health data to sync steps, active energy, and other metrics with your desktop app.",
    "NSHealthUpdateUsageDescription": "Ritual needs access to write health data to record your tracked habits.",
    "NSLocationWhenInUseUsageDescription": "Ritual tags your habit logs with where you were, so you can see patterns like \"I meditate more at home than the office.\"",
    "NSLocationAlwaysAndWhenInUseUsageDescription": "Ritual tags every habit log — including logs you create from your Mac or via text message — with where you were when you logged it. This runs in the background using Apple's Significant-Change Location Service, which uses virtually no battery.",
    "NSLocationAlwaysUsageDescription": "Ritual tags your habit logs with where you were, even when the app isn't open.",
    "ITSAppUsesNonExemptEncryption": false,
    "BGTaskSchedulerPermittedIdentifiers": [
        "com.ritual.companion.healthsync",
        "com.ritual.companion.healthsync.v2"
    ],
    "UIBackgroundModes": [
        "fetch",
        "processing",
        "bluetooth-central",
        "location"
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
        "webcredentials:clerk.ritualdb.com"
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

if screenTimeEnabled {
    // The app has to depend on the extension target so Tuist emits an
    // "Embed Foundation Extensions" build phase and ships the .appex inside
    // RitualCompanion.app/PlugIns/. Without this, DeviceActivityReport
    // renders an empty view because iOS can't find an extension for the
    // `dailyTotal` context.
    companionDependencies.append(.target(name: "RitualScreenTimeReportExtension"))
}

// Developer-local secrets (Clerk keys, backend URLs) live in Config/Local.xcconfig
// which is gitignored. If the file is missing we fall back to nil so `tuist generate`
// still succeeds — the build will then fail loudly at runtime via AppConfig's
// `Missing required iOS config value` fatal, which is the intended signal to copy
// Config/Local.xcconfig.example → Config/Local.xcconfig.
let localXcconfigPath: Path? = {
    let relative = "Config/Local.xcconfig"
    let absolute = "\(ProcessInfo.processInfo.environment["PWD"] ?? ".")/\(relative)"
    return FileManager.default.fileExists(atPath: absolute) ? .relativeToManifest(relative) : nil
}()

let companionSettings: Settings = .settings(
    configurations: [
        .debug(name: "Debug", xcconfig: localXcconfigPath),
        .release(name: "Release", xcconfig: localXcconfigPath),
    ]
)

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
            dependencies: companionDependencies,
            settings: companionSettings
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
                        // Apple's extension point identifier uses a dot between
                        // `deviceactivity` and `report-extension`. The hyphen-only
                        // form (`com.apple.deviceactivity-report-extension`) is
                        // silently ignored by iOS, which is why the hosted
                        // DeviceActivityReport view renders as a blank card.
                        "NSExtensionPointIdentifier": "com.apple.deviceactivity.report-extension",
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
                ],
                settings: companionSettings
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
