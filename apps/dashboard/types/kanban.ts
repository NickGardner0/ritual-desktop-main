export type EnergyCost = 'low' | 'medium' | 'high';

export interface KanbanCardReflection {
  rating: number;
  energyAfter: EnergyCost;
  notes?: string;
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
  tags?: string[];
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

export interface KanbanBoard {
  columns: KanbanColumn[];
  cards: KanbanCard[];
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'todo', title: 'Todo', order: 0 },
  { id: 'in-progress', title: 'In Progress', order: 1 },
  { id: 'in-review', title: 'In Review', order: 2 },
  { id: 'complete', title: 'Complete', order: 3 },
];

/** Map legacy column IDs to v0 column IDs for migration */
export const LEGACY_COLUMN_MIGRATION: Record<string, string> = {
  'todays-rituals': 'todo',
  'in-flow': 'in-progress',
  'reflect': 'in-review',
};

export const ENERGY_COST_POINTS: Record<EnergyCost, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const DEFAULT_ENERGY_BUDGET = 10;
