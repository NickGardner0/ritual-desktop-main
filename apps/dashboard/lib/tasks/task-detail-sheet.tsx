'use client';

import { useState } from 'react';

import { EntityLinkPicker } from '@/components/entities/entity-link-picker';
import { EntityNoteField } from '@/components/entities/entity-note-field';
import { EntityRelatedPanel } from '@/components/entities/entity-related-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { entityProtocolEnabled } from '@/lib/entities/feature-flag';
import type { Task, TaskUpdateInput } from '@/lib/tasks/types';

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
  const [relatedRefreshKey, setRelatedRefreshKey] = useState(0);

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{task?.title || 'Task'}</SheetTitle>
        </SheetHeader>
        {task ? (
          <div className="mt-4 space-y-5">
            <EntityNoteField
              value={task.notes || ''}
              onChange={() => undefined}
              onBlur={(notes) => {
                if (notes === (task.notes || '')) return;
                onUpdate(task.id, { notes: notes.trim() || null });
              }}
              placeholder="Add description..."
              rows={4}
              className="min-h-[72px] w-full resize-none bg-transparent text-[13px] leading-6 text-[var(--ritual-text-secondary)] outline-none"
            />
            <div className="text-[12px] text-[var(--ritual-text-muted)]">
              {[task.category, task.status].filter(Boolean).join(' · ')}
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
        ) : taskId ? (
          <div className="mt-4 text-[13px] text-[var(--ritual-text-secondary)]">This task is unavailable.</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
