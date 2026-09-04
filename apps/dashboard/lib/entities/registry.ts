import type { EntityType } from "@ritual/shared-contracts";

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  habit: "Habit",
  habit_log: "Log",
  task: "Task",
  routine: "Routine",
  artifact: "Report",
  conversation: "Chat",
  experiment: "Experiment",
  calendar_event: "Calendar event",
  calendar_occurrence: "Calendar occurrence",
  day: "Day",
  time_window: "Date range",
};
