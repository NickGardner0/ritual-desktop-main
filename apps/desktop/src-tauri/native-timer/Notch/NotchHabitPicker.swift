import SwiftUI

struct NotchHabitPicker: View {
    let habits: [TimerSessionStore.Habit]
    let selectedHabitID: String?
    let onSelect: (String) -> Void
    let onReload: () -> Void

    @State private var isOpen = false

    private var selectedHabit: TimerSessionStore.Habit? {
        habits.first(where: { $0.id == selectedHabitID }) ?? habits.first
    }

    private var selectedHabitName: String {
        selectedHabit?.name ?? "Focus"
    }

    private var selectedIcon: String {
        selectedHabit?.iconSystemName ?? "circle.fill"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            triggerButton

            if isOpen {
                dropdownList
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.easeOut(duration: 0.15), value: isOpen)
        .frame(width: 170, alignment: .leading)
    }

    private var triggerButton: some View {
        Button {
            isOpen.toggle()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: selectedIcon)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))

                Text(selectedHabitName)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.9))

                Spacer(minLength: 2)

                Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(.white.opacity(0.4))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.white.opacity(0.08), in: Capsule(style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var dropdownList: some View {
        ScrollView {
            VStack(spacing: 1) {
                if habits.isEmpty {
                    HStack {
                        Text("No habits")
                            .font(.system(size: 11))
                            .foregroundStyle(.white.opacity(0.5))
                        Spacer()
                        Button("Retry") { onReload() }
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.7))
                            .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                } else {
                    ForEach(habits) { habit in
                        HabitRow(
                            habit: habit,
                            isSelected: habit.id == selectedHabitID,
                            onTap: {
                                onSelect(habit.id)
                                withAnimation(.easeOut(duration: 0.12)) {
                                    isOpen = false
                                }
                            }
                        )
                    }
                }
            }
            .padding(.vertical, 4)
        }
        .frame(maxHeight: min(CGFloat(max(1, habits.count)) * 26 + 8, 140))
    }
}

private struct HabitRow: View {
    let habit: TimerSessionStore.Habit
    let isSelected: Bool
    let onTap: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                Image(systemName: habit.iconSystemName)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(width: 14)

                Text(habit.name)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .font(.system(size: 11, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(.white.opacity(isSelected ? 0.95 : (isHovered ? 0.9 : 0.7)))

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(isSelected ? .white.opacity(0.1) : (isHovered ? .white.opacity(0.06) : .clear))
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovered = hovering
        }
    }
}
