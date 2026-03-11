export type EnergyCost = 'low' | 'medium' | 'high';
export type KanbanVisibility = 'private' | 'shared';
export type DueDateFilter = 'overdue' | 'today' | 'upcoming' | 'no-date';

export interface KanbanCardReflection {
  rating: number;
  energyAfter: EnergyCost;
  notes?: string;
}

export interface KanbanLabel {
  id: string;
  name: string;
  color: string;
}

export interface KanbanChecklistItem {
  id: string;
  title: string;
  completed: boolean;
  order: number;
}

export interface KanbanChecklist {
  id: string;
  title: string;
  items: KanbanChecklistItem[];
}

export interface KanbanComment {
  id: string;
  body: string;
  createdAt: string;
}

export type KanbanActivityType =
  | 'created'
  | 'updated'
  | 'moved'
  | 'comment'
  | 'checklist'
  | 'completed';

export interface KanbanActivity {
  id: string;
  type: KanbanActivityType;
  message: string;
  createdAt: string;
}

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  columnId: string;
  order: number;
  linkedMetricId?: string;
  linkedMetricTarget?: number;
  energyCost: EnergyCost;
  streak: number;
  isRecurring: boolean;
  recurrenceRule?: string;
  scheduledTime?: string;
  dueDate?: string;
  tags?: string[];
  labelIds: string[];
  checklists: KanbanChecklist[];
  comments: KanbanComment[];
  activity: KanbanActivity[];
  reflection?: KanbanCardReflection;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  order: number;
}

export interface KanbanBoardMeta {
  title: string;
  slug: string;
  visibility: KanbanVisibility;
  description?: string;
  labels: KanbanLabel[];
}

export interface KanbanBoard {
  meta: KanbanBoardMeta;
  columns: KanbanColumn[];
  cards: KanbanCard[];
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'todo', title: 'Todo', order: 0 },
  { id: 'in-progress', title: 'In Progress', order: 1 },
  { id: 'in-review', title: 'In Review', order: 2 },
  { id: 'complete', title: 'Done', order: 3 },
];

export const DEFAULT_KANBAN_LABELS: KanbanLabel[] = [
  { id: 'label-ritual', name: 'Ritual', color: '#0f766e' },
  { id: 'label-work', name: 'Work', color: '#1d4ed8' },
  { id: 'label-health', name: 'Health', color: '#15803d' },
  { id: 'label-focus', name: 'Focus', color: '#7c3aed' },
];

export const DEFAULT_KANBAN_META: KanbanBoardMeta = {
  title: 'Daily Tracker',
  slug: 'daily-tracker',
  visibility: 'private',
  description: 'Simple, visual task management for your rituals and priorities.',
  labels: DEFAULT_KANBAN_LABELS,
};

/** Map legacy column IDs to current column IDs for migration */
export const LEGACY_COLUMN_MIGRATION: Record<string, string> = {
  'todays-rituals': 'todo',
  'in-flow': 'in-progress',
  reflect: 'in-review',
};

export const ENERGY_COST_POINTS: Record<EnergyCost, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const DEFAULT_ENERGY_BUDGET = 10;
