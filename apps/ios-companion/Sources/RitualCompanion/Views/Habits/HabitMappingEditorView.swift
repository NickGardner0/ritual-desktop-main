import SwiftUI

/// Editor sheet for creating or updating a HealthKit → habit mapping.
///
/// The habit picker is populated from `AppState.trackedHabits`, which the
/// companion app already fetches from `/api/wearables/apple/tracked_metrics`.
/// The metric-type picker is restricted to metrics Ritual actually knows how
/// to read (`MetricType` enum cases) to prevent users from binding to types
/// we can't fetch.
struct HabitMappingEditorView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    let existing: HabitMapping?

    @State private var selectedHabitId: String = ""
    @State private var selectedMetric: MetricType = .steps
    @State private var aggregation: HabitMapping.Aggregation = .sum
    @State private var hasTarget: Bool = false
    @State private var targetValue: String = ""
    @State private var isEnabled: Bool = true

    var body: some View {
        NavigationStack {
            Form {
                Section("Habit") {
                    if appState.trackedHabits.isEmpty {
                        Text("Create a habit in the Ritual desktop app first, then return here to bind it.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Ritual habit", selection: $selectedHabitId) {
                            Text("Select…").tag("")
                            ForEach(appState.trackedHabits, id: \.id) { habit in
                                Text(habit.name).tag(habit.id)
                            }
                        }
                    }
                }

                Section("Source metric") {
                    Picker("Apple Health metric", selection: $selectedMetric) {
                        ForEach(bindableMetricTypes, id: \.self) { metric in
                            Text(MarkdownExporter.displayName(for: metric)).tag(metric)
                        }
                    }
                    .onChange(of: selectedMetric) { _, newValue in
                        aggregation = HabitMapping.Aggregation.recommended(for: newValue)
                    }

                    Picker("Aggregate", selection: $aggregation) {
                        ForEach(HabitMapping.Aggregation.allCases, id: \.self) { agg in
                            Text(agg.displayName).tag(agg)
                        }
                    }
                }

                Section {
                    Toggle("Set daily goal", isOn: $hasTarget)
                    if hasTarget {
                        TextField("Goal value", text: $targetValue)
                            .keyboardType(.decimalPad)
                    }
                    Toggle("Enabled", isOn: $isEnabled)
                } header: {
                    Text("Goal")
                } footer: {
                    Text("When a daily goal is set, Ritual marks the habit complete when today's aggregated value meets or exceeds the goal. Without a goal, every sync records the current value as completed.")
                        .font(.footnote)
                }
            }
            .navigationTitle(existing == nil ? "New Mapping" : "Edit Mapping")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(!canSave)
                }
            }
            .onAppear(perform: hydrateFromExisting)
        }
    }

    private var bindableMetricTypes: [MetricType] {
        // Restrict to the metrics HealthKitManagerV2 can actually fetch.
        // Screen-time metrics are excluded — they flow through a separate pipeline.
        MetricType.allCases.filter { metric in
            switch metric {
            case .screenTimeTotal, .screenTimeAppUsage, .screenTimeWebDomainUsage:
                return false
            default:
                return true
            }
        }
    }

    private var canSave: Bool {
        guard !selectedHabitId.isEmpty else { return false }
        if hasTarget {
            return Double(targetValue.replacingOccurrences(of: ",", with: ".")) != nil
        }
        return true
    }

    private func hydrateFromExisting() {
        guard let existing else {
            // Default aggregation for freshly picked metric.
            aggregation = HabitMapping.Aggregation.recommended(for: selectedMetric)
            return
        }
        selectedHabitId = existing.habitId
        selectedMetric = existing.metricType
        aggregation = existing.aggregation
        isEnabled = existing.isEnabled
        if let target = existing.target {
            hasTarget = true
            targetValue = target.rounded() == target ? String(Int64(target)) : String(target)
        }
    }

    private func save() {
        guard let habit = appState.trackedHabits.first(where: { $0.id == selectedHabitId }) else { return }

        let target: Double? = hasTarget
            ? Double(targetValue.replacingOccurrences(of: ",", with: "."))
            : nil

        let mapping = HabitMapping(
            id: existing?.id ?? UUID().uuidString,
            habitId: habit.id,
            habitName: habit.name,
            metricType: selectedMetric,
            aggregation: aggregation,
            window: .today,
            target: target,
            isEnabled: isEnabled,
            createdAt: existing?.createdAt ?? Date()
        )

        appState.upsertHabitMapping(mapping)
        dismiss()
    }
}
