export type TaskChecklistItem = {
  id: string;
  title: string;
  done: boolean;
};

export const TASK_CHECKLIST_MARKER = '<!--ritual:checklist-->';

const CHECKBOX_LINE = /^\s*[-*]\s+\[(x|X| )\]\s+(.*)$/;

export function createChecklistItem(title = '', done = false, id?: string): TaskChecklistItem {
  return {
    id: id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    title,
    done,
  };
}

export function parseChecklistMarkdown(markdown: string): TaskChecklistItem[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(CHECKBOX_LINE))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match, index) => createChecklistItem(match[2] ?? '', match[1] !== ' ', `parsed-${index}`));
}

export function splitTaskNotes(notes: string | null | undefined): {
  description: string;
  items: TaskChecklistItem[];
} {
  if (!notes) return { description: '', items: [] };
  const markerIndex = notes.indexOf(TASK_CHECKLIST_MARKER);
  if (markerIndex === -1) {
    return { description: notes, items: [] };
  }
  return {
    description: notes.slice(0, markerIndex).replace(/\s+$/, ''),
    items: parseChecklistMarkdown(notes.slice(markerIndex + TASK_CHECKLIST_MARKER.length)),
  };
}

export function meaningfulChecklistItems(items: TaskChecklistItem[]): TaskChecklistItem[] {
  return items.filter((item) => item.title.trim().length > 0);
}

export function joinTaskNotes(description: string, items: TaskChecklistItem[]): string | null {
  const desc = description.trim();
  const checklist = meaningfulChecklistItems(items);
  if (!desc && checklist.length === 0) return null;
  if (checklist.length === 0) return desc || null;
  const markdown = checklist
    .map((item) => `- [${item.done ? 'x' : ' '}] ${item.title.trim()}`)
    .join('\n');
  return `${desc}${desc ? '\n\n' : ''}${TASK_CHECKLIST_MARKER}\n${markdown}`;
}

export function checklistProgress(items: TaskChecklistItem[]): { done: number; total: number } {
  const checklist = meaningfulChecklistItems(items);
  return {
    done: checklist.filter((item) => item.done).length,
    total: checklist.length,
  };
}
