import SwiftUI
import AppKit

// MARK: - Compact Views

struct NotchCompactLeadingView: View {
    @ObservedObject var store: TimerSessionStore

    var body: some View {
        Group {
            if store.hasActiveSession {
                HStack(spacing: 5) {
                    Image(systemName: store.selectedHabit?.iconSystemName ?? "circle.fill")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.white.opacity(0.85))

                    Text(store.selectedHabitShortName)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))
                }
            } else {
                RitualLogoMark()
            }
        }
        .frame(maxWidth: 108, alignment: .leading)
    }
}

struct NotchCompactTrailingView: View {
    @ObservedObject var store: TimerSessionStore

    var body: some View {
        Group {
            if store.hasActiveSession {
                HStack(spacing: 5) {
                    Text(store.elapsedText)
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundStyle(store.isRunning ? Color.green : .white.opacity(0.8))

                    Circle()
                        .fill(store.isRunning ? Color.green : Color.white.opacity(0.3))
                        .frame(width: 5, height: 5)
                }
                .frame(maxWidth: 92, alignment: .trailing)
            } else {
                EmptyView()
            }
        }
    }
}

// MARK: - Expanded View

struct NotchExpandedView: View {
    @ObservedObject var store: TimerSessionStore
    @ObservedObject var speechEngine: SpeechEngine
    var onVoiceLog: ((String, String) -> Void)?
    var onVoiceCancel: (() -> Void)?
    var onOpenAccessibility: (() -> Void)?
    var onUseFallbackHotkey: (() -> Void)?
    var onDismissPermissions: (() -> Void)?

    var body: some View {
        Group {
            switch store.voiceMode {
            case .inactive:
                timerContent
            case .listening:
                NotchVoiceWaveformView(
                    audioLevels: speechEngine.audioLevels,
                    partialTranscript: speechEngine.partialTranscript,
                    onCancel: { onVoiceCancel?() }
                )
            case .processing:
                NotchVoiceProcessingView(
                    partialTranscript: speechEngine.partialTranscript
                )
            case .confirm(let transcript, let habitID):
                voiceConfirmContent(transcript: transcript, habitID: habitID)
            case .error(let message):
                NotchVoiceErrorView(
                    message: message,
                    onDismiss: { onVoiceCancel?() }
                )
            case .permissionsRequired:
                NotchPermissionOnboardingView(
                    onOpenAccessibility: { onOpenAccessibility?() },
                    onUseFallback: { onUseFallbackHotkey?() },
                    onDismiss: { onDismissPermissions?() }
                )
            }
        }
        .animation(.easeInOut(duration: 0.15), value: store.voiceMode != .inactive)
    }

    // MARK: - Timer Content (original expanded view)

    private var timerContent: some View {
        VStack(spacing: 0) {
            topRow
                .padding(.bottom, 6)

            TimerProgressBar(progress: store.progressInHour)
                .padding(.bottom, 8)

            bottomRow
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(width: 380)
    }

    private var topRow: some View {
        HStack(spacing: 0) {
            NotchHabitPicker(
                habits: store.habits,
                selectedHabitID: store.activeHabitID,
                onSelect: { store.selectHabit($0) },
                onReload: { Task { await store.loadHabits(force: true) } }
            )

            Spacer(minLength: 12)

            Text(store.elapsedText)
                .font(.system(size: 28, weight: .light, design: .monospaced))
                .foregroundStyle(.white)
                .contentTransition(.numericText(countsDown: false))
                .animation(.linear(duration: 0.15), value: store.elapsedText)

            Spacer(minLength: 12)

            if store.canDiscard {
                Button {
                    store.discard()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white.opacity(0.45))
                        .frame(width: 20, height: 20)
                        .background(.white.opacity(0.08), in: Circle())
                }
                .buttonStyle(.plain)
                .help("Discard session")
            }
        }
    }

    private var bottomRow: some View {
        HStack(spacing: 6) {
            if let status = store.statusOverride {
                Text(status)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))
                    .transition(.opacity)
            }

            Spacer(minLength: 0)

            Button {
                store.toggleRunning()
            } label: {
                Label(
                    store.isRunning ? "Pause" : "Start",
                    systemImage: store.isRunning ? "pause.fill" : "play.fill"
                )
                .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(NotchPillButtonStyle(variant: .primary))

            if store.canStopAndLog {
                Button {
                    Task { await store.stopAndLog() }
                } label: {
                    Label("Log", systemImage: "checkmark")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(NotchPillButtonStyle(variant: .secondary))
            }
        }
    }

    // MARK: - Voice Confirm Content

    private func voiceConfirmContent(transcript: String, habitID: String?) -> some View {
        let habit = habitID.flatMap { id in store.habits.first(where: { $0.id == id }) }
            ?? store.selectedHabit
        let name = habit?.name ?? "Focus"
        let icon = habit?.iconSystemName ?? "circle.fill"
        let resolvedID = habit?.id ?? store.activeHabitID ?? ""

        return NotchVoiceConfirmView(
            transcript: transcript,
            habitName: name,
            habitIcon: icon,
            onLog: { onVoiceLog?(resolvedID, transcript) },
            onCancel: { onVoiceCancel?() }
        )
    }
}

// MARK: - Shared Components

private struct RitualLogoMark: View {
    private var logoImage: NSImage? {
        let candidates = [
            Bundle.module.url(forResource: "eclipse_white", withExtension: "svg"),
            Bundle.module.url(forResource: "eclipse", withExtension: "svg")
        ]

        for candidate in candidates {
            guard let url = candidate, let image = NSImage(contentsOf: url) else {
                continue
            }

            image.isTemplate = true
            return image
        }
        return nil
    }

    var body: some View {
        Group {
            if let logoImage {
                Image(nsImage: logoImage)
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .foregroundStyle(.white.opacity(0.9))
            } else {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.9))
            }
        }
        .frame(width: 18, height: 18)
    }
}

private struct TimerProgressBar: View {
    let progress: CGFloat

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(.white.opacity(0.1))

                Capsule(style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [.blue.opacity(0.9), .cyan.opacity(0.7)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(3, geo.size.width * min(max(progress, 0), 1)))
            }
        }
        .frame(height: 3)
    }
}

// MARK: - Button Style

private struct NotchPillButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    enum Variant { case primary, secondary }
    let variant: Variant

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(foreground(pressed: configuration.isPressed))
            .padding(.horizontal, 14)
            .frame(height: 26)
            .background(background(pressed: configuration.isPressed), in: Capsule(style: .continuous))
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(borderColor(pressed: configuration.isPressed), lineWidth: 0.5)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }

    private func foreground(pressed: Bool) -> Color {
        guard isEnabled else { return .white.opacity(0.35) }
        return .white.opacity(pressed ? 0.8 : 0.95)
    }

    private func background(pressed: Bool) -> Color {
        guard isEnabled else { return .white.opacity(0.04) }
        switch variant {
        case .primary:
            return .white.opacity(pressed ? 0.2 : 0.14)
        case .secondary:
            return .white.opacity(pressed ? 0.1 : 0.06)
        }
    }

    private func borderColor(pressed: Bool) -> Color {
        guard isEnabled else { return .white.opacity(0.06) }
        return .white.opacity(pressed ? 0.2 : 0.12)
    }
}
