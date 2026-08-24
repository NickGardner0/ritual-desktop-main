'use client';

import { useState } from 'react';

import { EntityLinkPicker } from '@/components/entities/entity-link-picker';
import { EntityNoteField } from '@/components/entities/entity-note-field';
import { EntityRelatedPanel } from '@/components/entities/entity-related-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { entityProtocolEnabled } from '@/lib/entities/feature-flag';
import { dateInputValue } from '@/lib/tasks/date-format';
import { CATEGORY_FILTERS, PRIORITIES, TASK_STATUS_OPTIONS } from '@/lib/tasks/task-constants';
import {
  DetailCard,
  DetailFieldRow,
  InlineFieldInput,
  PillSelect,
} from '@/lib/tasks/task-ui-shell';
import type {
  Task,
  TaskPriority,
  TaskUpdateInput,
} from '@/lib/tasks/types';

const PRIORITY_OPTIONS = PRIORITIES.map((priority) => ({
  value: priority,
  label: priority === 'none' ? 'No priority' : `${priority[0].toUpperCase()}${priority.slice(1)}`,
}));

const CATEGORY_OPTIONS = CATEGORY_FILTERS
  .filter((category) => category !== 'All')
  .map((category) => ({ value: category, label: category }));

function inputDateToIso(value: string): string | null {
  return value ? new Date(`${value}T09:00:00`).toISOString() : null;
}

function TaskDetailEditor({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
}) {
  const [relatedRefreshKey, setRelatedRefreshKey] = useState(0);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [notesDraft, setNotesDraft] = useState(task.notes || '');
  const [projectDraft, setProjectDraft] = useState(task.project || '');
  const [tagsDraft, setTagsDraft] = useState(task.tags.join(', '));

  const commitTitle = () => {
    const title = titleDraft.trim();
    if (!title || title === task.title) return;
    onUpdate(task.id, { title });
  };

  const commitProject = () => {
    const project = projectDraft.trim() || null;
    if (project === task.project) return;
    onUpdate(task.id, { project });
  };

  const commitTags = () => {
    const tags = Array.from(new Set(
      tagsDraft
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ));
    if (tags.join('|') === task.tags.join('|')) return;
    onUpdate(task.id, { tags });
  };

  return (
    <>
      <SheetHeader className="px-6 pb-4 pt-6 pr-12">
        <SheetTitle className="sr-only">{task.title}</SheetTitle>
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Task · {task.source}
        </div>
        <input
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          aria-label="Task title"
          className="w-full bg-transparent text-[22px] font-medium leading-7 tracking-[-0.02em] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </SheetHeader>

      <div className="space-y-5 px-6">
        <EntityNoteField
          value={notesDraft}
          onChange={setNotesDraft}
          onBlur={(notes) => {
            const next = notes.trim() || null;
            if (next === task.notes) return;
            onUpdate(task.id, { notes: next });
          }}
          placeholder="Add a description or @mention related Ritual data…"
          rows={4}
          className="min-h-[92px] w-full resize-none rounded-[var(--radius-row)] border border-[var(--border-subtle)] bg-[var(--surface-recessed)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
        />

        <DetailCard className="bg-[var(--surface-panel)]">
          <DetailFieldRow label="Status" inCard>
            <PillSelect
              value={task.status}
              options={TASK_STATUS_OPTIONS}
              onChange={(status) => onUpdate(task.id, { status })}
            />
          </DetailFieldRow>
          <DetailFieldRow label="Priority" inCard>
            <PillSelect
              value={task.priority}
              options={PRIORITY_OPTIONS}
              onChange={(priority: TaskPriority) => onUpdate(task.id, { priority })}
            />
          </DetailFieldRow>
          <DetailFieldRow label="Category" inCard>
            <PillSelect
              value={task.category || 'Productivity'}
              options={CATEGORY_OPTIONS}
              onChange={(category) => onUpdate(task.id, { category })}
            />
          </DetailFieldRow>
          <DetailFieldRow label="Schedule" inCard>
            <InlineFieldInput
              type="date"
              value={dateInputValue(task.scheduled_for)}
              onChange={(event) => onUpdate(task.id, {
                scheduled_for: inputDateToIso(event.target.value),
              })}
              className="w-[150px]"
            />
          </DetailFieldRow>
          <DetailFieldRow label="Deadline" inCard>
            <InlineFieldInput
              type="date"
              value={dateInputValue(task.due_at)}
              onChange={(event) => onUpdate(task.id, {
                due_at: inputDateToIso(event.target.value),
              })}
              className="w-[150px]"
            />
          </DetailFieldRow>
          <DetailFieldRow label="Project" inCard>
            <InlineFieldInput
              value={projectDraft}
              onChange={(event) => setProjectDraft(event.target.value)}
              onBlur={commitProject}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              placeholder="Inbox"
              aria-label="Project"
              className="w-[180px]"
            />
          </DetailFieldRow>
          <DetailFieldRow label="Tags" inCard>
            <InlineFieldInput
              value={tagsDraft}
              onChange={(event) => setTagsDraft(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              placeholder="health, planning"
              aria-label="Tags separated by commas"
              className="w-[220px]"
            />
          </DetailFieldRow>
        </DetailCard>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span>Created {task.created_at ? new Date(task.created_at).toLocaleDateString() : 'locally'}</span>
          {task.routine_id ? <span>· Generated by a routine</span> : null}
          {task.linked_habit_id ? <span>· Linked to a habit</span> : null}
        </div>

        {entityProtocolEnabled() ? (
          <>
            <EntityRelatedPanel
              entityRef={{ type: 'task', id: task.id }}
              refreshKey={relatedRefreshKey}
            />
            <EntityLinkPicker
              source={{ type: 'task', id: task.id }}
              onLinked={() => setRelatedRefreshKey((value) => value + 1)}
            />
          </>
        ) : null}
      </div>
    </>
  );
}

export function TaskDetailSheet({
  taskId,
  task,
  onClose,
  onUpdate,
}: {
  taskId: string | null;
  task: Task | null;
  onClose: () => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
}) {
  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-[var(--surface-content)] px-0 pb-8 sm:max-w-[520px]"
      >
        {task ? (
          <TaskDetailEditor key={task.id} task={task} onUpdate={onUpdate} />
        ) : taskId ? (
          <div className="px-6 pt-8 text-[13px] text-[var(--text-secondary)]">
            This task is unavailable.
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
