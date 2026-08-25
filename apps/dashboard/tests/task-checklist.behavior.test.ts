import { describe, expect, it } from 'vitest';

import {
  createChecklistItem,
  joinTaskNotes,
  checklistProgress,
  parseChecklistMarkdown,
  splitTaskNotes,
  TASK_CHECKLIST_MARKER,
} from '../lib/tasks/checklist';

describe('task checklist notes encoding', () => {
  it('keeps description separate from checklist items', () => {
    const items = [
      createChecklistItem('Buy stamps', false, 'a'),
      createChecklistItem('Mail letter', true, 'b'),
    ];
    const notes = joinTaskNotes('Ship the packet', items);
    expect(notes?.includes(TASK_CHECKLIST_MARKER)).toBe(true);
    const parsed = splitTaskNotes(notes);
    expect(parsed.description).toBe('Ship the packet');
    expect(parsed.items.map((item) => [item.title, item.done])).toEqual([
      ['Buy stamps', false],
      ['Mail letter', true],
    ]);
  });

  it('serializes empty checklist and description to null', () => {
    expect(joinTaskNotes('  ', [createChecklistItem('   ')])).toBeNull();
  });

  it('leaves unmarked notes as description', () => {
    const parsed = splitTaskNotes('Just a note\n- not a checklist');
    expect(parsed.description).toBe('Just a note\n- not a checklist');
    expect(parsed.items).toEqual([]);
  });

  it('parses mixed checkbox markdown', () => {
    const items = parseChecklistMarkdown('- [ ] one\n* [x] two\n- [X] three');
    expect(items.map((item) => [item.title, item.done])).toEqual([
      ['one', false],
      ['two', true],
      ['three', true],
    ]);
  });

  it('ignores blank items in progress', () => {
    expect(checklistProgress([
      createChecklistItem('Done', true),
      createChecklistItem('Open', false),
      createChecklistItem('  '),
    ])).toEqual({ done: 1, total: 2 });
  });
});
