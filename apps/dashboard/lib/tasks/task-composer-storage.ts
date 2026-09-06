import type { TaskChecklistItem } from './checklist';
import type { TaskPriority } from './types';

export type TaskComposerDraft = {
  title: string;
  notes: string;
  checklist: TaskChecklistItem[];
  priority: TaskPriority;
  category: string;
  dueDate: string;
  deadlineDate: string;
  schedule: 'today' | 'upcoming' | 'anytime' | 'custom';
  savedAt: number;
};

const STORAGE_KEY = 'ritual-task-composer-draft';
const TTL_MS = 2 * 60 * 1000;

export function loadTaskComposerDraft(): TaskComposerDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as TaskComposerDraft;
    if (!draft.savedAt || Date.now() - draft.savedAt > TTL_MS) {
      clearTaskComposerDraft();
      return null;
    }
    return {
      ...draft,
      checklist: Array.isArray(draft.checklist) ? draft.checklist : [],
      dueDate: typeof draft.dueDate === 'string' ? draft.dueDate : '',
      deadlineDate: typeof draft.deadlineDate === 'string' ? draft.deadlineDate : '',
    };
  } catch {
    return null;
  }
}

export function saveTaskComposerDraft(draft: Omit<TaskComposerDraft, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...draft,
        savedAt: Date.now(),
      } satisfies TaskComposerDraft),
    );
  } catch {
    // ignore quota errors
  }
}

export function touchTaskComposerDraft(): void {
  const draft = loadTaskComposerDraft();
  if (!draft) return;
  saveTaskComposerDraft({
    title: draft.title,
    notes: draft.notes,
    checklist: draft.checklist || [],
    priority: draft.priority,
    category: draft.category,
    dueDate: draft.dueDate,
    deadlineDate: draft.deadlineDate,
    schedule: draft.schedule,
  });
}

export function clearTaskComposerDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
