import SwiftUI

/// Reusable status card component - clean minimal design
struct StatusCard: View {
    let title: String
    let status: String
    let icon: String
    let iconColor: Color
    
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(iconColor)
                .frame(width: 28, height: 28)
            
            // Text
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13))
                    .foregroundColor(.gray)
                
                Text(status)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.black)
            }
            
            Spacer()
            
            Circle()
                .fill(iconColor.opacity(0.95))
                .frame(width: 8, height: 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.white)
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.black.opacity(0.08), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}

#Preview {
    VStack(spacing: 0) {
        StatusCard(
            title: "Connection",
            status: "Connected to Ritual",
            icon: "checkmark.circle.fill",
            iconColor: .green
        )
        
        StatusCard(
            title: "Health Access",
            status: "Granted",
            icon: "checkmark.circle.fill",
            iconColor: .green
        )
        
        StatusCard(
            title: "Last Sync",
            status: "2 minutes ago",
            icon: "clock.arrow.circlepath",
            iconColor: .green
        )
    }
    .padding()
    .background(Color(.systemGray6))
}
