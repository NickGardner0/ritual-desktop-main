import SwiftUI

// MARK: - Voice Mode Enum

enum VoiceMode: Equatable {
    case inactive
    case listening
    case processing
    case confirm(transcript: String, habitID: String?)
    case error(message: String)
    case permissionsRequired
}

// MARK: - Braille Spinner

private struct BrailleSpinner: View {
    @State private var index = 0
    private static let frames: [String] = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]

    var body: some View {
        Text(Self.frames[index])
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .foregroundStyle(.green.opacity(0.9))
            .onAppear {
                Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { _ in
                    index = (index + 1) % Self.frames.count
                }
            }
    }
}

// MARK: - Waveform View (Listening State)

struct NotchVoiceWaveformView: View {
    let audioLevels: [Float]
    let partialTranscript: String
    var onCancel: () -> Void

    private let maxBarHeight: CGFloat = 40

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 0) {
                BrailleSpinner()

                Text("Listening...")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.leading, 6)

                Spacer(minLength: 0)

                Button {
                    onCancel()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white.opacity(0.45))
                        .frame(width: 20, height: 20)
                        .background(.white.opacity(0.08), in: Circle())
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 3) {
                ForEach(0..<audioLevels.count, id: \.self) { i in
                    let level = CGFloat(audioLevels[i])
                    Capsule(style: .continuous)
                        .fill(Color.green.opacity(0.5 + 0.5 * level))
                        .frame(
                            width: 4,
                            height: max(3, maxBarHeight * level)
                        )
                }
            }
            .frame(height: maxBarHeight)
            .animation(.linear(duration: 0.04), value: audioLevels)

            if !partialTranscript.isEmpty {
                Text(partialTranscript)
                    .lineLimit(2)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(width: 380)
    }
}

// MARK: - Processing View

struct NotchVoiceProcessingView: View {
    let partialTranscript: String

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                ProgressView()
                    .scaleEffect(0.6)
                    .frame(width: 14, height: 14)

                Text("Processing...")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))

                Spacer(minLength: 0)
            }

            if !partialTranscript.isEmpty {
                Text(partialTranscript)
                    .lineLimit(2)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(.white.opacity(0.5))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(width: 380)
    }
}

// MARK: - Confirm View

struct NotchVoiceConfirmView: View {
    let transcript: String
    let habitName: String
    let habitIcon: String
    var onLog: () -> Void
    var onCancel: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: habitIcon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))

                Text(habitName)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.9))

                Spacer(minLength: 0)
            }

            Text("\"\(transcript)\"")
                .lineLimit(3)
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(.white.opacity(0.55))
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 6) {
                Spacer(minLength: 0)

                Button { onCancel() } label: {
                    Text("Cancel")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(VoicePillButtonStyle(variant: .secondary))

                Button { onLog() } label: {
                    Label("Log", systemImage: "checkmark")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(VoicePillButtonStyle(variant: .primary))
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(width: 380)
    }
}

// MARK: - Error View

struct NotchVoiceErrorView: View {
    let message: String
    var onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.orange.opacity(0.85))

                Text(message)
                    .lineLimit(2)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))

                Spacer(minLength: 0)

                Button { onDismiss() } label: {
                    Text("OK")
                        .font(.system(size: 10, weight: .semibold))
                }
                .buttonStyle(VoicePillButtonStyle(variant: .secondary))
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(width: 380)
    }
}

// MARK: - Permission Onboarding View

struct NotchPermissionOnboardingView: View {
    var onOpenAccessibility: () -> Void
    var onUseFallback: () -> Void
    var onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.cyan.opacity(0.85))

                Text("Enable Hold \u{2318} Voice Logging")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.9))

                Spacer(minLength: 0)
            }

            Text("System Settings \u{2192} Privacy & Security \u{2192} Accessibility \u{2192} enable Ritual Timer Widget")
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(.white.opacity(0.5))
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 6) {
                Button { onOpenAccessibility() } label: {
                    Label("Open Accessibility Settings", systemImage: "gear")
                        .font(.system(size: 10, weight: .semibold))
                }
                .buttonStyle(VoicePillButtonStyle(variant: .primary))

                Button { onUseFallback() } label: {
                    Text("Use \u{2318}\u{21E7}L Instead")
                        .font(.system(size: 10, weight: .semibold))
                }
                .buttonStyle(VoicePillButtonStyle(variant: .secondary))

                Spacer(minLength: 0)

                Button { onDismiss() } label: {
                    Text("Not Now")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.white.opacity(0.4))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(width: 380)
    }
}

// MARK: - Button Style

struct VoicePillButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    enum Variant { case primary, secondary }
    let variant: Variant

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(foreground(pressed: configuration.isPressed))
            .padding(.horizontal, 12)
            .frame(height: 24)
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
