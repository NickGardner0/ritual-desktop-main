import SwiftUI

/// Lists every HealthKit → habit mapping the user has configured, plus an
/// entry point for adding a new one. Mappings can be toggled on/off inline
/// without opening the editor, and the bar at the top offers a manual
/// "Sync now" button so users can push fresh values to the backend without
/// waiting for the next background sync cycle.
struct HabitMappingListView: View {
    @EnvironmentObject var appState: AppState
    @State private var showingEditor = false
    @State private var editingMapping: HabitMapping?
    @State private var isSyncing = false

    var body: some View {
        List {
            Section {
                if let status = appState.habitMappingStatus {
                    Label(status, systemImage: "arrow.triangle.2.circlepath")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button {
                    Task {
                        isSyncing = true
                        await appState.runHabitMappingResolver()
                        isSyncing = false
                    }
                } label: {
                    HStack {
                        Image(systemName: "arrow.up.circle")
                        Text(isSyncing ? "Syncing habits…" : "Sync habits now")
                        Spacer()
                    }
                }
                .disabled(isSyncing || appState.habitMappings.isEmpty || !appState.isConnected)
            } header: {
                Text("Status")
            }

            Section {
                if appState.habitMappings.isEmpty {
                    Text("No mappings yet. Add one to link an Apple Health metric to a Ritual habit.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(appState.habitMappings) { mapping in
                        Button {
                            editingMapping = mapping
                        } label: {
                            HabitMappingRow(mapping: mapping)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            let mapping = appState.habitMappings[index]
                            appState.deleteHabitMapping(id: mapping.id)
                        }
                    }
                }
            } header: {
                Text("Mappings")
            } footer: {
                Text("Values sync to the Ritual backend whenever HealthKit data updates, or when you tap Sync habits now.")
                    .font(.footnote)
            }
        }
        .navigationTitle("Habits")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    editingMapping = nil
                    showingEditor = true
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(appState.trackedHabits.isEmpty)
            }
        }
        .sheet(isPresented: $showingEditor) {
            HabitMappingEditorView(existing: nil)
        }
        .sheet(item: $editingMapping) { mapping in
            HabitMappingEditorView(existing: mapping)
        }
    }
}

private struct HabitMappingRow: View {
    let mapping: HabitMapping

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(mapping.habitName)
                    .font(.headline)
                Spacer()
                if !mapping.isEnabled {
                    Text("Off")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Text("\(MarkdownExporter.displayName(for: mapping.metricType)) • \(mapping.aggregation.displayName)\(targetSuffix)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var targetSuffix: String {
        guard let target = mapping.target else { return "" }
        let formatted = target.rounded() == target ? String(Int64(target)) : String(format: "%.2f", target)
        return " • goal \(formatted)"
    }
}
