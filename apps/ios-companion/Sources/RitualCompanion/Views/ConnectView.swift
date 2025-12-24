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
                    // Ritual Logo - actual logo from logo_fix1.svg
                    RitualLogoShape()
                        .fill(Color.black)
                        .frame(width: 50, height: 52)
                    
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

// MARK: - Ritual Logo Shape (from logo_fix1.svg)

struct RitualLogoShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        
        // Scale factor to fit the rect (original viewBox: 0 0 137 142)
        let scaleX = rect.width / 137
        let scaleY = rect.height / 142
        
        // Helper to scale points
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x * scaleX, y: y * scaleY)
        }
        
        // Path 1 - Bottom center piece
        path.move(to: p(69.8105, 73.7231))
        path.addLine(to: p(72.6255, 74.7838))
        path.addLine(to: p(81.6333, 79.5573))
        path.addLine(to: p(92.8931, 85.9219))
        path.addLine(to: p(92.8931, 121.988))
        path.addLine(to: p(90.6411, 128.352))
        path.addLine(to: p(86.7002, 133.656))
        path.addLine(to: p(82.1963, 137.369))
        path.addLine(to: p(76.5664, 140.021))
        path.addLine(to: p(72.6255, 141.082))
        path.addLine(to: p(63.6177, 141.082))
        path.addLine(to: p(56.8618, 138.96))
        path.addLine(to: p(51.2319, 135.247))
        path.addLine(to: p(46.728, 130.474))
        path.addLine(to: p(43.9131, 124.64))
        path.addLine(to: p(42.7871, 118.275))
        path.addLine(to: p(42.7871, 115.093))
        path.addLine(to: p(57.4248, 107.137))
        path.addLine(to: p(64.7437, 102.894))
        path.addLine(to: p(66.4326, 102.894))
        path.addLine(to: p(66.9956, 118.806))
        path.addLine(to: p(69.2476, 118.806))
        path.addLine(to: p(69.8105, 73.7231))
        path.closeSubpath()
        
        // Path 2 - Top center piece
        path.move(to: p(63.0547, 0))
        path.addLine(to: p(73.1885, 0))
        path.addLine(to: p(79.3813, 2.12153))
        path.addLine(to: p(84.4482, 5.30382))
        path.addLine(to: p(89.5151, 10.6076))
        path.addLine(to: p(92.3301, 16.4418))
        path.addLine(to: p(92.8931, 18.5634))
        path.addLine(to: p(92.8931, 25.9887))
        path.addLine(to: p(85.5742, 30.2318))
        path.addLine(to: p(71.4995, 38.1875))
        path.addLine(to: p(69.8105, 38.1875))
        path.addLine(to: p(69.2476, 22.276))
        path.addLine(to: p(66.9956, 22.276))
        path.addLine(to: p(66.4326, 25.9887))
        path.addLine(to: p(66.4326, 58.342))
        path.addLine(to: p(65.8696, 66.8281))
        path.addLine(to: p(63.0547, 65.7674))
        path.addLine(to: p(48.98, 58.342))
        path.addLine(to: p(42.7871, 54.6293))
        path.addLine(to: p(42.7871, 25.4583))
        path.addLine(to: p(43.3501, 18.5634))
        path.addLine(to: p(45.6021, 12.7292))
        path.addLine(to: p(48.98, 7.95573))
        path.addLine(to: p(52.9209, 4.24306))
        path.addLine(to: p(60.8027, 0.530382))
        path.addLine(to: p(63.0547, 0))
        path.closeSubpath()
        
        // Path 3 - Top right piece
        path.move(to: p(108.094, 23.3368))
        path.addLine(to: p(114.85, 23.3368))
        path.addLine(to: p(122.168, 25.4584))
        path.addLine(to: p(128.361, 29.171))
        path.addLine(to: p(132.302, 33.4141))
        path.addLine(to: p(135.117, 38.7179))
        path.addLine(to: p(136.243, 42.961))
        path.addLine(to: p(136.243, 50.9167))
        path.addLine(to: p(133.991, 57.8116))
        path.addLine(to: p(129.487, 63.6458))
        path.addLine(to: p(123.294, 67.8889))
        path.addLine(to: p(121.042, 68.4193))
        path.addLine(to: p(111.472, 63.1155))
        path.addLine(to: p(99.0859, 56.2205))
        path.addLine(to: p(99.0859, 55.1597))
        path.addLine(to: p(107.531, 50.9167))
        path.addLine(to: p(112.598, 47.7344))
        path.addLine(to: p(112.035, 45.6129))
        path.addLine(to: p(109.783, 46.1432))
        path.addLine(to: p(99.6489, 51.4471))
        path.addLine(to: p(86.1372, 58.8724))
        path.addLine(to: p(71.4995, 66.8281))
        path.addLine(to: p(69.8105, 67.3585))
        path.addLine(to: p(69.8105, 42.4306))
        path.addLine(to: p(74.8774, 39.2483))
        path.addLine(to: p(85.0112, 33.9445))
        path.addLine(to: p(98.5229, 26.5191))
        path.addLine(to: p(104.716, 23.8672))
        path.addLine(to: p(108.094, 23.3368))
        path.closeSubpath()
        
        // Path 4 - Bottom right piece
        path.move(to: p(94.582, 57.8116))
        path.addLine(to: p(101.338, 60.9939))
        path.addLine(to: p(110.909, 66.2978))
        path.addLine(to: p(125.546, 74.2535))
        path.addLine(to: p(130.613, 78.4965))
        path.addLine(to: p(134.554, 84.3307))
        path.addLine(to: p(136.243, 90.1649))
        path.addLine(to: p(136.243, 98.1207))
        path.addLine(to: p(133.991, 105.016))
        path.addLine(to: p(130.613, 109.259))
        path.addLine(to: p(127.798, 111.911))
        path.addLine(to: p(124.983, 114.032))
        path.addLine(to: p(119.354, 116.684))
        path.addLine(to: p(114.287, 117.745))
        path.addLine(to: p(109.22, 117.745))
        path.addLine(to: p(101.901, 116.154))
        path.addLine(to: p(96.834, 113.502))
        path.addLine(to: p(96.834, 88.0434))
        path.addLine(to: p(103.027, 91.2257))
        path.addLine(to: p(110.909, 95.4688))
        path.addLine(to: p(112.598, 94.9384))
        path.addLine(to: p(113.161, 92.8169))
        path.addLine(to: p(110.346, 91.7561))
        path.addLine(to: p(81.0703, 75.8446))
        path.addLine(to: p(72.0625, 71.0712))
        path.addLine(to: p(72.0625, 70.0104))
        path.addLine(to: p(87.8262, 61.5243))
        path.addLine(to: p(94.582, 57.8116))
        path.closeSubpath()
        
        // Path 5 - Top left piece
        path.move(to: p(21.3936, 23.3368))
        path.addLine(to: p(28.1494, 23.3368))
        path.addLine(to: p(35.4683, 25.4584))
        path.addLine(to: p(39.4092, 27.5799))
        path.addLine(to: p(39.4092, 52.5078))
        path.addLine(to: p(36.5942, 51.4471))
        path.addLine(to: p(25.3345, 45.6129))
        path.addLine(to: p(23.6455, 45.0825))
        path.addLine(to: p(23.0825, 47.204))
        path.addLine(to: p(28.7124, 50.9167))
        path.addLine(to: p(41.6611, 57.8116))
        path.addLine(to: p(55.1729, 65.237))
        path.addLine(to: p(64.1807, 70.0104))
        path.addLine(to: p(62.4917, 71.6016))
        path.addLine(to: p(48.98, 79.0269))
        path.addLine(to: p(41.0981, 83.27))
        path.addLine(to: p(32.0903, 78.4966))
        path.addLine(to: p(18.5786, 71.0712))
        path.addLine(to: p(8.44482, 65.237))
        path.addLine(to: p(3.94092, 60.4636))
        path.addLine(to: p(1.12598, 55.1597))
        path.addLine(to: p(0, 51.4471))
        path.addLine(to: p(0, 42.4306))
        path.addLine(to: p(2.25195, 36.066))
        path.addLine(to: p(6.19287, 30.7622))
        path.addLine(to: p(11.8228, 26.5191))
        path.addLine(to: p(18.5786, 23.8672))
        path.addLine(to: p(21.3936, 23.3368))
        path.closeSubpath()
        
        // Path 6 - Bottom left piece
        path.move(to: p(13.5117, 72.6623))
        path.addLine(to: p(15.7637, 73.1927))
        path.addLine(to: p(29.8384, 80.6181))
        path.addLine(to: p(37.1572, 84.8611))
        path.addLine(to: p(35.4683, 86.4523))
        path.addLine(to: p(23.6455, 92.8168))
        path.addLine(to: p(23.6455, 95.9991))
        path.addLine(to: p(31.5273, 92.2865))
        path.addLine(to: p(65.3066, 73.7231))
        path.addLine(to: p(66.4326, 73.7231))
        path.addLine(to: p(66.4326, 90.6953))
        path.addLine(to: p(65.8696, 99.1814))
        path.addLine(to: p(52.9209, 106.076))
        path.addLine(to: p(39.4092, 113.502))
        path.addLine(to: p(32.6533, 116.684))
        path.addLine(to: p(27.0234, 117.745))
        path.addLine(to: p(22.5195, 117.745))
        path.addLine(to: p(15.7637, 116.154))
        path.addLine(to: p(10.1338, 113.502))
        path.addLine(to: p(5.62988, 109.789))
        path.addLine(to: p(1.68896, 103.955))
        path.addLine(to: p(0, 98.651))
        path.addLine(to: p(0, 89.6345))
        path.addLine(to: p(2.25195, 83.27))
        path.addLine(to: p(6.19287, 77.9661))
        path.addLine(to: p(10.6968, 74.2535))
        path.addLine(to: p(13.5117, 72.6623))
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
                        .frame(width: 40, height: 42)
                    
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
                        .frame(width: 40, height: 42)
                    
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
