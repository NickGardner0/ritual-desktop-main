// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "NativeTimerWidget",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "NativeTimerWidget", targets: ["NativeTimerWidget"])
    ],
    dependencies: [
        .package(url: "https://github.com/MrKai77/DynamicNotchKit", from: "1.0.0")
    ],
    targets: [
        .executableTarget(
            name: "NativeTimerWidget",
            dependencies: [
                .product(name: "DynamicNotchKit", package: "DynamicNotchKit")
            ],
            path: ".",
            exclude: [
                "build_widget.sh",
                "Resources/Info.plist"
            ],
            sources: [
                "TimerWidgetApp.swift",
                "MicrophonePermission.swift",
                "SpeechRecognition.swift",
                "Notch/NotchController.swift",
                "Notch/NotchTimerView.swift",
                "Notch/NotchHabitPicker.swift",
                "Notch/NotchVoiceViews.swift",
                "Stores/TimerSessionStore.swift",
                "Hotkeys/ModifierEventTap.swift",
                "Hotkeys/GlobalHotkey.swift",
                "Permissions/AccessibilityPermission.swift",
                "Speech/SpeechEngine.swift",
                "Speech/VoicePermissions.swift"
            ],
            resources: [
                .copy("Resources/eclipse.svg"),
                .copy("Resources/eclipse_white.svg")
            ]
        )
    ]
)
