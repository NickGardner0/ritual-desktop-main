import SwiftUI
import Clerk
import AuthenticationServices

/// Initial connect screen for authentication using Clerk
struct ConnectView: View {
    @EnvironmentObject var appState: AppState
    @State private var isConnecting = false
    @State private var showSignIn = false
    
    // Access Clerk user directly
    private var clerkUser: User? {
        Clerk.shared.user
    }
    
    var body: some View {
        ZStack {
            // Clean white background
            Color.white
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                Spacer()
                
                // Main content - centered
                VStack(spacing: 32) {
                    // Ritual Sphere Logo
                    RitualLogoShape()
                        .fill(Color.black)
                        .frame(width: 52, height: 52)
                    
                    // Title
                    Text("Welcome to Ritual")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundColor(.black)
                    
                    // Get Started / Sign In button
                    if clerkUser != nil {
                        // User is signed in, show status and connect
                        signedInView
                    } else {
                        // Show Get Started button - SQUARE corners
                        Button(action: { showSignIn = true }) {
                            Text("Get Started")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.white)
                                .frame(width: 140, height: 48)
                                .background(Color.black)
                        }
                    }
                }
                
                Spacer()
                
                // Terms text at bottom
                termsText
                    .padding(.bottom, 40)
            }
        }
        .sheet(isPresented: $showSignIn) {
            SignInOptionsView()
        }
    }
    
    // MARK: - Signed In View
    
    private var signedInView: some View {
        VStack(spacing: 20) {
            // Status indicators
            VStack(spacing: 12) {
                StatusRow(
                    icon: appState.connectionStatus.icon,
                    title: "Connection",
                    status: appState.connectionStatus.displayText,
                    color: appState.connectionStatus.color
                )
                
                StatusRow(
                    icon: appState.healthAccessStatus.icon,
                    title: "Health Access",
                    status: appState.healthAccessStatus.displayText,
                    color: appState.healthAccessStatus.color
                )
            }
            .padding(.horizontal, 32)
            
            // User email
            if let email = clerkUser?.primaryEmailAddress?.emailAddress {
                Text("Signed in as \(email)")
                    .font(.system(size: 13))
                    .foregroundColor(.gray)
            }
            
            // Action buttons
            VStack(spacing: 12) {
                if appState.connectionStatus != .connected {
                    Button(action: connectWithClerk) {
                        HStack(spacing: 8) {
                            if isConnecting {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(0.7)
                            }
                            Text(isConnecting ? "Connecting..." : "Connect")
                                .font(.system(size: 16, weight: .medium))
                        }
                        .foregroundColor(.white)
                        .frame(width: 160, height: 48)
                        .background(Color.black)
                    }
                    .disabled(isConnecting)
                }
                
                if appState.healthAccessStatus != .authorized {
                    Button(action: requestHealthAccess) {
                        Text("Grant Health Access")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.black)
                            .frame(width: 180, height: 44)
                            .background(Color.white)
                            .overlay(
                                Rectangle()
                                    .stroke(Color.black.opacity(0.2), lineWidth: 1)
                            )
                    }
                }
            }
        }
    }
    
    // MARK: - Terms Text
    
    private var termsText: some View {
        HStack(spacing: 4) {
            Text("By signing in you agree to our")
                .foregroundColor(.gray)
            Text("Terms of service")
                .foregroundColor(.gray)
                .underline()
            Text("&")
                .foregroundColor(.gray)
            Text("Privacy policy")
                .foregroundColor(.gray)
                .underline()
        }
        .font(.system(size: 12))
    }
    
    // MARK: - Methods
    
    private func connectWithClerk() {
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

// MARK: - Ritual Logo Shape (Sphere Logo from new_logo3.svg)

struct RitualLogoShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        
        // Scale factor to fit the rect (original viewBox: 0 0 150 150)
        let scale = min(rect.width, rect.height) / 150
        let offsetX = (rect.width - 150 * scale) / 2
        let offsetY = (rect.height - 150 * scale) / 2
        
        // Helper to scale and offset points
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x * scale + offsetX, y: y * scale + offsetY)
        }
        
        // Main sphere path from new_logo3.svg
        // Outer boundary
        path.move(to: p(91.3043, 0))
        path.addCurve(to: p(47.5565, 19.5652), control1: p(73.92, 0), control2: p(58.3043, 7.56))
        path.addLine(to: p(0, 19.5652))
        path.addLine(to: p(0, 150))
        path.addLine(to: p(130.435, 150))
        path.addLine(to: p(130.435, 102.443))
        path.addCurve(to: p(150, 58.6957), control1: p(142.44, 91.6957), control2: p(150, 76.08))
        path.addCurve(to: p(91.3043, 0), control1: p(150, 26.28), control2: p(123.72, 0))
        path.closeSubpath()
        
        // Inner sphere detail (the curved stripes)
        path.move(to: p(86.7391, 117.59))
        path.addCurve(to: p(70.7322, 115.19), control1: p(81.167, 117.59), control2: p(75.793, 116.75))
        path.addCurve(to: p(129.814, 87.6939), control1: p(101.009, 81.7513), control2: p(127.153, 75.4383))
        path.addCurve(to: p(124.983, 64.2574), control1: p(132.402, 72.287), control2: p(129.689, 64.2574))
        path.addCurve(to: p(69.4957, 114.793), control1: p(116.812, 64.2574), control2: p(86.3009, 79.4556))
        path.addCurve(to: p(46.393, 99.6417), control1: p(60.5217, 111.793), control2: p(52.5913, 106.513))
        path.addCurve(to: p(126.61, 58.7739), control1: p(81.7409, 55.4817), control2: p(121.758, 49.753))
        path.addCurve(to: p(113.191, 40.033), control1: p(124.602, 49.0852), control2: p(116.718, 40.1843))
        path.addCurve(to: p(45.2661, 98.353), control1: p(103.56, 39.6156), control2: p(67.4504, 54.407))
        path.addCurve(to: p(33.4017, 73.6226), control1: p(39.3704, 91.393), control2: p(35.1965, 82.9304))
        path.addCurve(to: p(111.85, 36.5896), control1: p(62.6348, 38.7548), control2: p(103.148, 29.1652))
        path.addCurve(to: p(92.0765, 25.4452), control1: p(105.089, 29.4939), control2: p(96.48, 25.7322))
        path.addCurve(to: p(33.0783, 71.7652), control1: p(81.4017, 24.7409), control2: p(56.4209, 33.72))
        path.addCurve(to: p(32.4157, 63.2661), control1: p(32.6452, 68.9948), control2: p(32.4157, 66.1565))
        path.addCurve(to: p(37.1687, 41.0139), control1: p(32.4157, 55.3356), control2: p(34.1165, 47.807))
        path.addCurve(to: p(83.233, 22.4139), control1: p(57.5009, 21.9287), control2: p(83.233, 22.4139))
        path.addCurve(to: p(67.1426, 19.273), control1: p(80.2278, 20.7809), control2: p(74.327, 19.273))
        path.addCurve(to: p(50.5617, 22.7426), control1: p(60.4122, 19.273), control2: p(54.2348, 21.3026))
        path.addCurve(to: p(86.7444, 8.94261), control1: p(60.167, 14.16), control2: p(72.8452, 8.94261))
        path.addCurve(to: p(141.068, 63.2661), control1: p(116.75, 8.94261), control2: p(141.068, 33.2661))
        path.addCurve(to: p(86.7444, 117.59), control1: p(141.068, 93.2661), control2: p(116.744, 117.59))
        path.addLine(to: p(86.7391, 117.59))
        path.closeSubpath()
        
        return path
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
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(.black.opacity(0.6))
                .frame(width: 20)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
                Text(status)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.black)
            }
            
            Spacer()
            
            // Status indicator
            if color == .green {
                Circle()
                    .fill(Color.black)
                    .frame(width: 6, height: 6)
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 14)
        .background(Color.white)
        .overlay(
            Rectangle()
                .stroke(Color.black.opacity(0.1), lineWidth: 1)
        )
    }
}

// MARK: - Sign In Options View (with Google & Apple)

struct SignInOptionsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var showEmailSignIn = false
    @State private var isLoadingGoogle = false
    @State private var isLoadingApple = false
    @State private var errorMessage: String?
    @State private var showError = false
    
    var body: some View {
        NavigationStack {
            ZStack {
                Color.white.ignoresSafeArea()
                
                VStack(spacing: 32) {
                    Spacer()
                    
                    // Logo
                    RitualLogoShape()
                        .fill(Color.black)
                        .frame(width: 42, height: 42)
                    
                    // Title
                    VStack(spacing: 8) {
                        Text("Sign In to Ritual")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundColor(.black)
                        
                        Text("Choose how you want to sign in")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                    }
                    
                    // Sign in options
                    VStack(spacing: 12) {
                        // Apple Sign In Button
                        Button(action: signInWithApple) {
                            HStack(spacing: 12) {
                                if isLoadingApple {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                        .scaleEffect(0.7)
                                } else {
                                    Image(systemName: "apple.logo")
                                        .font(.system(size: 20))
                                }
                                Text("Continue with Apple")
                                    .font(.system(size: 16, weight: .medium))
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(Color.black)
                        }
                        .disabled(isLoadingApple)
                        
                        // Google Sign In Button
                        Button(action: signInWithGoogle) {
                            HStack(spacing: 12) {
                                if isLoadingGoogle {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .black))
                                        .scaleEffect(0.7)
                                } else {
                                    // Google "G" icon
                                    GoogleIcon()
                                        .frame(width: 20, height: 20)
                                }
                                Text("Continue with Google")
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(.black)
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(Color.white)
                            .overlay(
                                Rectangle()
                                    .stroke(Color.black.opacity(0.2), lineWidth: 1)
                            )
                        }
                        .disabled(isLoadingGoogle)
                        
                        // Divider with "or"
                        HStack {
                            Rectangle()
                                .fill(Color.gray.opacity(0.3))
                                .frame(height: 1)
                            Text("or")
                                .font(.system(size: 13))
                                .foregroundColor(.gray)
                                .padding(.horizontal, 16)
                            Rectangle()
                                .fill(Color.gray.opacity(0.3))
                                .frame(height: 1)
                        }
                        .padding(.vertical, 8)
                        
                        // Email Sign In Button
                        Button(action: { showEmailSignIn = true }) {
                            HStack(spacing: 12) {
                                Image(systemName: "envelope.fill")
                                    .font(.system(size: 18))
                                Text("Continue with Email")
                                    .font(.system(size: 16, weight: .medium))
                            }
                            .foregroundColor(.black)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(Color.white)
                            .overlay(
                                Rectangle()
                                    .stroke(Color.black.opacity(0.2), lineWidth: 1)
                            )
                        }
                    }
                    .padding(.horizontal, 32)
                    
                    Spacer()
                    Spacer()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.black)
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
    
    private func signInWithApple() {
        isLoadingApple = true
        
        Task {
            do {
                // Create sign-in with Apple OAuth
                let signIn = try await SignIn.create(strategy: .oauth(provider: .apple))
                
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
                    isLoadingApple = false
                }
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
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)
            
            Canvas { context, canvasSize in
                let center = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
                let radius = size * 0.45
                let strokeWidth = size * 0.18
                
                // Blue section (bottom right, 0° to 90°)
                var bluePath = Path()
                bluePath.addArc(center: center, radius: radius, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
                context.stroke(bluePath, with: .color(Color(red: 66/255, green: 133/255, blue: 244/255)), style: StrokeStyle(lineWidth: strokeWidth, lineCap: .butt))
                
                // Green section (bottom left, 90° to 180°)
                var greenPath = Path()
                greenPath.addArc(center: center, radius: radius, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
                context.stroke(greenPath, with: .color(Color(red: 52/255, green: 168/255, blue: 83/255)), style: StrokeStyle(lineWidth: strokeWidth, lineCap: .butt))
                
                // Yellow section (top left, 180° to 270°)
                var yellowPath = Path()
                yellowPath.addArc(center: center, radius: radius, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
                context.stroke(yellowPath, with: .color(Color(red: 251/255, green: 188/255, blue: 5/255)), style: StrokeStyle(lineWidth: strokeWidth, lineCap: .butt))
                
                // Red section (top right, 270° to 360°/0°) - but only partial
                var redPath = Path()
                redPath.addArc(center: center, radius: radius, startAngle: .degrees(270), endAngle: .degrees(330), clockwise: false)
                context.stroke(redPath, with: .color(Color(red: 234/255, green: 67/255, blue: 53/255)), style: StrokeStyle(lineWidth: strokeWidth, lineCap: .butt))
                
                // Horizontal bar of the G (blue)
                let barWidth = size * 0.45
                let barHeight = strokeWidth
                let barRect = CGRect(
                    x: center.x - barWidth * 0.05,
                    y: center.y - barHeight / 2,
                    width: barWidth,
                    height: barHeight
                )
                context.fill(Path(barRect), with: .color(Color(red: 66/255, green: 133/255, blue: 244/255)))
            }
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
            ZStack {
                Color.white.ignoresSafeArea()
                
                VStack(spacing: 32) {
                    Spacer()
                    
                    // Logo
                    RitualLogoShape()
                        .fill(Color.black)
                        .frame(width: 42, height: 42)
                    
                    // Title
                    VStack(spacing: 8) {
                        Text("Sign In with Email")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundColor(.black)
                        
                        Text(step == .enterEmail ? "Enter your email to continue" : "Enter the code sent to your email")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                    }
                    
                    // Input fields
                    if step == .enterEmail {
                        emailInputView
                    } else {
                        codeInputView
                    }
                    
                    Spacer()
                    Spacer()
                }
                .padding(.horizontal, 32)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.black)
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
            TextField("Email address", text: $email)
                .font(.system(size: 16))
                .padding()
                .background(Color.white)
                .overlay(
                    Rectangle()
                        .stroke(Color.black.opacity(0.15), lineWidth: 1)
                )
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .autocorrectionDisabled()
            
            Button(action: sendCode) {
                HStack {
                    if isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(0.7)
                    } else {
                        Text("Continue")
                            .font(.system(size: 16, weight: .medium))
                    }
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(email.isEmpty ? Color.gray.opacity(0.4) : Color.black)
            }
            .disabled(email.isEmpty || isLoading)
        }
    }
    
    private var codeInputView: some View {
        VStack(spacing: 16) {
            Text(email)
                .font(.system(size: 14))
                .foregroundColor(.gray)
            
            TextField("Verification code", text: $code)
                .font(.system(size: 20, weight: .medium))
                .multilineTextAlignment(.center)
                .padding()
                .background(Color.white)
                .overlay(
                    Rectangle()
                        .stroke(Color.black.opacity(0.15), lineWidth: 1)
                )
                .keyboardType(.numberPad)
            
            Button(action: verifyCode) {
                HStack {
                    if isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(0.7)
                    } else {
                        Text("Verify")
                            .font(.system(size: 16, weight: .medium))
                    }
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(code.isEmpty ? Color.gray.opacity(0.4) : Color.black)
            }
            .disabled(code.isEmpty || isLoading)
            
            Button("Use different email") {
                step = .enterEmail
                code = ""
                signIn = nil
            }
            .font(.system(size: 14))
            .foregroundColor(.gray)
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

#Preview {
    ConnectView()
        .environmentObject(AppState())
}
