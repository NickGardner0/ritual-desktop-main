import SwiftUI

struct WhoopConnectView: View {
    @EnvironmentObject private var service: WhoopBroadcastService

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                header
                actionCard

                if service.connectedDevice != nil || service.liveBPM != nil {
                    liveStatusCard
                }

                if !service.devices.isEmpty {
                    devicesSection
                }

                if service.connectedDevice != nil {
                    disconnectButton
                }
            }
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            .padding(20)
        }
        .background(CompanionPalette.background.ignoresSafeArea())
        .navigationTitle("WHOOP")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            service.handleAppDidBecomeActive()
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Text("WHOOP")
                .font(.system(size: 42, weight: .bold))
                .kerning(-1.0)
                .foregroundColor(.black)
                .multilineTextAlignment(.center)

            Text("Enable Heart Rate Broadcast in WHOOP, then scan here.")
                .font(.system(size: 19))
                .foregroundColor(CompanionPalette.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var actionCard: some View {
        CompanionCard {
            VStack(spacing: 16) {
                Text(service.permissionState.statusText)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(CompanionPalette.secondaryText)
                    .multilineTextAlignment(.center)

                CompanionPrimaryButton(
                    title: service.permissionState == .scanning || service.permissionState == .connecting ? "Stop scan" : "Scan for WHOOP",
                    systemImage: "dot.radiowaves.left.and.right",
                    isDisabled: false
                ) {
                    if service.permissionState == .scanning || service.permissionState == .connecting {
                        service.stopScan()
                    } else {
                        service.startScan()
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var liveStatusCard: some View {
        CompanionCard {
            VStack(spacing: 18) {
                HStack(spacing: 20) {
                    CompanionInlineMetric(
                        value: service.liveBPM.map(String.init) ?? "--",
                        label: "Live bpm"
                    )

                    CompanionInlineMetric(
                        value: service.connectedDevice?.name ?? "Waiting",
                        label: "Source"
                    )
                }

                if let lastSampleAt = service.lastSampleAt {
                    Text("Last sample \(lastSampleAt.formatted(date: .omitted, time: .standard))")
                        .font(.system(size: 12))
                        .foregroundColor(CompanionPalette.secondaryText)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var devicesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            CompanionSectionTitle("Devices")

            CompanionGroupedCard {
                ForEach(Array(service.devices.enumerated()), id: \.element.id) { index, device in
                    Button {
                        service.connect(to: device)
                    } label: {
                        CompanionSourceRow(
                            icon: "bolt.heart.fill",
                            tint: .black,
                            title: device.name,
                            detail: "RSSI \(device.rssi)",
                            badgeText: nil
                        )
                    }
                    .buttonStyle(.plain)

                    if index < service.devices.count - 1 {
                        Divider().padding(.leading, 74)
                    }
                }
            }
        }
    }

    private var disconnectButton: some View {
        CompanionSecondaryButton(title: "Disconnect") {
            service.disconnect()
        }
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity)
    }
}
