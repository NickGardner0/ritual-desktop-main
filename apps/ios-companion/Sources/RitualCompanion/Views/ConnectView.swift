import SwiftUI
import Clerk
import UIKit

/// Initial connect screen for authentication using Clerk
struct ConnectView: View {
    @EnvironmentObject var appState: AppState
    @State private var isConnecting = false
    @State private var showSignIn = false

    // Access Clerk user directly
    private var clerkUser: User? {
        Clerk.shared.user
    }

    private let backgroundColor = CompanionPalette.background
    private let surfaceColor = CompanionPalette.surface
    private let separatorColor = CompanionPalette.separator
    private let secondaryTextColor = CompanionPalette.secondaryText

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                hero

                onboardingChecklist

                if clerkUser != nil {
                    signedInView
                } else {
                    signedOutActions
                }

                if clerkUser == nil {
                    createAccountLink
                }

                termsText
                    .padding(.top, 4)
            }
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.top, 32)
            .padding(.bottom, 36)
        }
        .background(pageBackground)
        .sheet(isPresented: $showSignIn) {
            SignInOptionsView()
        }
    }

    private var hero: some View {
        VStack(spacing: 14) {
            RitualLogoMark()
                .frame(width: 30, height: 30)

            Text("Connect Ritual")
                .font(.system(size: 30, weight: .semibold))
                .kerning(-0.6)
                .foregroundColor(.black)
                .multilineTextAlignment(.center)

            Text("Sign in and turn on Apple Health.")
                .font(.system(size: 17))
                .foregroundColor(secondaryTextColor)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var onboardingChecklist: some View {
        ConnectSection(title: "Setup", surfaceColor: surfaceColor, separatorColor: separatorColor) {
            ConnectStepCard(
                number: "1",
                title: "Sign in",
                description: "Use your Ritual account.",
                isComplete: clerkUser != nil
            )

            Divider()
                .padding(.leading, 64)
                .overlay(separatorColor)

            ConnectStepCard(
                number: "2",
                title: "Connect iPhone",
                description: "Link this device.",
                isComplete: appState.connectionStatus == .connected
            )

            Divider()
                .padding(.leading, 64)
                .overlay(separatorColor)

            ConnectStepCard(
                number: "3",
                title: "Allow Apple Health",
                description: "Approve Health access.",
                isComplete: appState.healthAccessStatus == .authorized
            )
        }
    }

    private var signedOutActions: some View {
        VStack(spacing: 10) {
            CompanionPrimaryButton(title: "Sign in to connect") {
                showSignIn = true
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Signed In View

    private var signedInView: some View {
        VStack(spacing: 16) {
            if let email = clerkUser?.primaryEmailAddress?.emailAddress {
                Text(email)
                    .font(.system(size: 15))
                    .foregroundColor(secondaryTextColor)
                    .multilineTextAlignment(.center)
            }

            if let hint = AppConfig.localDeviceAPIHint {
                ConnectInfoCard(
                    title: "Check debug API URL",
                    message: hint,
                    surfaceColor: surfaceColor,
                    secondaryTextColor: secondaryTextColor
                )
            }

            VStack(spacing: 12) {
                if appState.connectionStatus != .connected {
                    CompanionPrimaryButton(
                        title: isConnecting ? "Connecting..." : "Connect",
                        isLoading: isConnecting,
                        isDisabled: isConnecting,
                        action: connectWithClerk
                    )
                }

                if appState.healthAccessStatus != .authorized {
                    CompanionSecondaryButton(title: "Allow Apple Health") {
                        requestHealthAccess()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var createAccountLink: some View {
        Link(destination: AppConfig.desktopSetupURL) {
            HStack(spacing: 6) {
                Text("Create account on desktop")
                    .font(.system(size: 14, weight: .medium))
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundColor(.black)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Terms Text

    private var termsText: some View {
        HStack(spacing: 4) {
            Link("Terms", destination: AppConfig.termsURL)
                .foregroundColor(.black.opacity(0.6))
            Text("·")
                .foregroundColor(secondaryTextColor)
            Link("Privacy", destination: AppConfig.privacyURL)
                .foregroundColor(.black.opacity(0.6))
        }
        .font(.system(size: 12))
        .frame(maxWidth: .infinity)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var pageBackground: some View {
        backgroundColor.ignoresSafeArea()
    }

    // MARK: - Methods

    private func connectWithClerk() {
        if let hint = AppConfig.localDeviceAPIHint {
            appState.errorMessage = hint
            appState.showError = true
            return
        }

        isConnecting = true
        
        Task {
            do {
                guard let session = Clerk.shared.session else {
                    appState.connectionStatus = .disconnected
                    isConnecting = false
                    return
                }
                
                let tokenResult = try await session.getToken()
                let token = tokenResult?.jwt ?? ""
                
                if token.isEmpty {
                    print("❌ Failed to get Clerk token")
                    appState.connectionStatus = .disconnected
                } else {
                    print("✅ Got Clerk token, connecting to backend...")
                    await appState.connect(authToken: token)
                }
            } catch {
                print("❌ Error getting Clerk token: \(error)")
                appState.connectionStatus = .disconnected
            }
            
            isConnecting = false
        }
    }
    
    private func requestHealthAccess() {
        Task {
            await appState.requestHealthAccess()
        }
    }
}

struct RitualLogoMark: View {
    var body: some View {
        Image("EclipseLogo")
            .resizable()
            .scaledToFit()
            .accessibilityLabel("Ritual")
    }
}

// MARK: - Status Row Component

struct StatusRow: View {
    let icon: String
    let title: String
    let status: String
    let color: Color
    
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(uiColor: .tertiarySystemFill))
                .frame(width: 38, height: 38)
                .overlay(
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.black.opacity(0.65))
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(Color(uiColor: .secondaryLabel))
                Text(status)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(.black)
            }
            
            Spacer()

            Circle()
                .fill(Color.black.opacity(0.25))
                .frame(width: 9, height: 9)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
    }
}

struct ConnectStepCard: View {
    let number: String
    let title: String
    let description: String
    let isComplete: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isComplete ? Color.black : Color(uiColor: .tertiarySystemFill))
                    .frame(width: 40, height: 40)

                if isComplete {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                } else {
                    Text(number)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.black)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.black)

                Text(description)
                    .font(.system(size: 16))
                    .foregroundColor(Color(uiColor: .secondaryLabel))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 20)
        .background(Color.white.opacity(0.9))
    }
}

struct ConnectSection<Content: View>: View {
    let title: String
    let surfaceColor: Color
    let separatorColor: Color
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .center, spacing: 12) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color(uiColor: .secondaryLabel))
                .textCase(.uppercase)
                .tracking(1.2)
                .frame(maxWidth: .infinity)

            VStack(spacing: 0) {
                content()
            }
            .background {
                CompanionGlassBackground(cornerRadius: 26)
            }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(separatorColor, lineWidth: 1)
            )
        }
    }
}

struct ConnectInfoCard: View {
    let title: String
    let message: String
    let surfaceColor: Color
    let secondaryTextColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.black)

            Text(message)
                .font(.system(size: 14))
                .foregroundColor(secondaryTextColor)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            CompanionGlassBackground(cornerRadius: 22)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.18), lineWidth: 1)
        )
    }
}

// MARK: - Sign In Options View (with Google & Apple)

struct SignInOptionsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var showEmailSignIn = false
    @State private var isLoadingGoogle = false
    @State private var errorMessage: String?
    @State private var showError = false
    
    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 28) {
                    AuthHeroCard(
                        title: "Sign in",
                        subtitle: "Use the Ritual account you already use on desktop."
                    )

                    VStack(spacing: 12) {
                        AuthProviderButton(
                            title: "Continue with Google",
                            style: .outlined,
                            isLoading: isLoadingGoogle,
                            icon: {
                                GoogleIcon()
                                    .frame(width: 18, height: 18)
                            },
                            action: signInWithGoogle
                        )
                        .disabled(isLoadingGoogle)

                        AuthProviderButton(
                            title: "Continue with Email",
                            style: .outlined,
                            isLoading: false,
                            icon: {
                                Image(systemName: "envelope.fill")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.black)
                            },
                            action: { showEmailSignIn = true }
                        )
                    }
                    .frame(maxWidth: .infinity)

                    Link(destination: AppConfig.desktopSetupURL) {
                        HStack(spacing: 6) {
                            Text("Create your account on desktop")
                                .font(.system(size: 14, weight: .medium))
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundColor(.black)
                    }
                    .padding(.leading, 4)
                }
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
                .padding(.top, 28)
                .padding(.bottom, 36)
            }
            .background(AuthSheetBackground())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.black)
                            .frame(width: 32, height: 32)
                            .background(Color(uiColor: .secondarySystemGroupedBackground))
                            .clipShape(Circle())
                            .overlay(
                                Circle()
                                    .stroke(Color(uiColor: .separator).opacity(0.18), lineWidth: 1)
                            )
                    }
                }
            }
            .sheet(isPresented: $showEmailSignIn) {
                EmailSignInView()
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage ?? "An error occurred")
            }
        }
    }
    
    private func signInWithGoogle() {
        isLoadingGoogle = true
        
        Task {
            do {
                // Create sign-in with Google OAuth
                let signIn = try await SignIn.create(strategy: .oauth(provider: .google))
                
                // Start the external authentication - this opens the OAuth flow
                try await signIn.authenticateWithRedirect()
                
                // After successful OAuth, set the session active
                if let sessionId = signIn.createdSessionId {
                    try await Clerk.shared.setActive(sessionId: sessionId)
                }
                
                await MainActor.run {
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showError = true
                    isLoadingGoogle = false
                }
            }
        }
    }
}

// MARK: - Google Icon (Actual Google "G" Logo)

struct GoogleIcon: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color(uiColor: .tertiarySystemFill))
            Text("G")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.black)
        }
    }
}

// MARK: - Email Sign-In View

struct EmailSignInView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showError = false
    @State private var step: SignInStep = .enterEmail
    @State private var signIn: SignIn?
    
    enum SignInStep {
        case enterEmail
        case enterCode
    }
    
    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 28) {
                    AuthHeroCard(
                        title: step == .enterEmail ? "Email sign in" : "Enter code",
                        subtitle: step == .enterEmail ? "We’ll send a one-time code to your Ritual email." : "Enter the latest code sent to \(email)."
                    )

                    AuthCard {
                        if step == .enterEmail {
                            emailInputView
                        } else {
                            codeInputView
                        }
                    }
                }
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
                .padding(.top, 28)
                .padding(.bottom, 36)
            }
            .background(AuthSheetBackground())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.black)
                            .frame(width: 32, height: 32)
                            .background(Color(uiColor: .secondarySystemGroupedBackground))
                            .clipShape(Circle())
                            .overlay(
                                Circle()
                                    .stroke(Color(uiColor: .separator).opacity(0.18), lineWidth: 1)
                            )
                    }
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage ?? "An error occurred")
            }
        }
    }
    
    private var emailInputView: some View {
        VStack(spacing: 16) {
            AuthInputField(
                prompt: "you@example.com",
                text: $email,
                keyboardType: .emailAddress,
                textContentType: .emailAddress
            )

            AuthPrimaryActionButton(
                title: "Send verification code",
                isLoading: isLoading,
                isEnabled: !email.isEmpty,
                action: sendCode
            )
            .disabled(email.isEmpty || isLoading)
        }
    }
    
    private var codeInputView: some View {
        VStack(spacing: 16) {
            Text(email)
                .font(.system(size: 14))
                .foregroundColor(Color(uiColor: .secondaryLabel))
                .frame(maxWidth: .infinity, alignment: .leading)

            AuthInputField(
                prompt: "123456",
                text: $code,
                keyboardType: .numberPad,
                textContentType: nil,
                centered: true
            )

            AuthPrimaryActionButton(
                title: "Verify and continue",
                isLoading: isLoading,
                isEnabled: !code.isEmpty,
                action: verifyCode
            )
            .disabled(code.isEmpty || isLoading)
            
            Button("Use different email") {
                step = .enterEmail
                code = ""
                signIn = nil
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(Color(uiColor: .secondaryLabel))
        }
    }
    
    private func sendCode() {
        isLoading = true
        
        Task {
            do {
                signIn = try await SignIn.create(strategy: .identifier(email, password: nil))
                
                if let currentSignIn = signIn,
                   let factors = currentSignIn.supportedFirstFactors {
                    for factor in factors {
                        if factor.strategy == "email_code",
                           let emailId = factor.safeIdentifier {
                            try await currentSignIn.prepareFirstFactor(strategy: .emailCode(emailAddressId: emailId))
                            await MainActor.run {
                                step = .enterCode
                            }
                            break
                        }
                    }
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showError = true
                }
            }
            await MainActor.run {
                isLoading = false
            }
        }
    }
    
    private func verifyCode() {
        isLoading = true
        
        Task {
            do {
                if let currentSignIn = signIn {
                    let result = try await currentSignIn.attemptFirstFactor(strategy: .emailCode(code: code))
                    
                    if let sessionId = result.createdSessionId {
                        try await Clerk.shared.setActive(sessionId: sessionId)
                    }
                    
                    await MainActor.run {
                        dismiss()
                    }
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showError = true
                }
            }
            await MainActor.run {
                isLoading = false
            }
        }
    }
}

struct AuthSheetBackground: View {
    var body: some View {
        LinearGradient(
            colors: [
                Color.white,
                Color(red: 0.97, green: 0.97, blue: 0.99)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

struct AuthHeroCard: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 14) {
            RitualLogoMark()
                .frame(width: 30, height: 30)

            Text(title)
                .font(.system(size: 30, weight: .semibold))
                .kerning(-0.6)
                .foregroundColor(.black)
                .multilineTextAlignment(.center)

            Text(subtitle)
                .font(.system(size: 17))
                .foregroundColor(Color(uiColor: .secondaryLabel))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }
}

struct AuthCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 12) {
            content()
        }
        .padding(0)
        .background {
            CompanionGlassBackground(cornerRadius: 26)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.18), lineWidth: 1)
        )
    }
}

struct AuthProviderButton<Icon: View>: View {
    enum Style {
        case filled
        case outlined
    }

    let title: String
    let style: Style
    let isLoading: Bool
    @ViewBuilder let icon: () -> Icon
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: foregroundColor))
                        .scaleEffect(0.72)
                        .frame(width: 20, height: 20)
                } else {
                    icon()
                        .frame(width: 20, height: 20)
                }

                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(foregroundColor.opacity(0.38))
            }
            .foregroundColor(foregroundColor)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .background(backgroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(borderColor, lineWidth: style == .filled ? 0 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var foregroundColor: Color {
        style == .filled ? .white : .black
    }

    private var backgroundColor: Color {
        style == .filled ? .black : Color.white
    }

    private var borderColor: Color {
        style == .filled ? .clear : Color(uiColor: .separator).opacity(0.18)
    }
}

struct AuthInputField: View {
    let prompt: String
    @Binding var text: String
    let keyboardType: UIKeyboardType
    let textContentType: UITextContentType?
    var centered: Bool = false

    var body: some View {
        TextField(prompt, text: $text)
            .font(.system(size: centered ? 22 : 16, weight: centered ? .semibold : .regular))
            .multilineTextAlignment(centered ? .center : .leading)
            .padding(.horizontal, 18)
            .frame(height: 56)
            .background(Color.white.opacity(0.92))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(uiColor: .separator).opacity(0.18), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .keyboardType(keyboardType)
            .textContentType(textContentType)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
    }
}

struct AuthPrimaryActionButton: View {
    let title: String
    let isLoading: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(0.72)
                }

                Text(title)
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(isEnabled ? Color.black : Color.black.opacity(0.28))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ConnectView()
        .environmentObject(AppState())
}
