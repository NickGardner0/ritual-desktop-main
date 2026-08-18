'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';
import { EntityLinkPicker } from '@/components/entities/entity-link-picker';
import { EntityRelatedPanel } from '@/components/entities/entity-related-panel';
import { EntityNoteField } from '@/components/entities/entity-note-field';
import { entityProtocolEnabled } from '@/lib/entities/feature-flag';
import { formatMinutesDisplay, formatMinutesInput, parseMinutes } from './calendar-client.helpers';

export type TaskComposerState = {
  id: string | null;
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
  title: string;
  notes: string;
};

export type TaskComposerModalProps = {
  taskComposer: TaskComposerState;
  taskComposerError: string | null;
  isSavingTaskComposer: boolean;
  setTaskComposer: React.Dispatch<React.SetStateAction<TaskComposerState | null>>;
  setTaskComposerError: React.Dispatch<React.SetStateAction<string | null>>;
  closeTaskComposer: () => void;
  saveTaskComposer: () => void;
  deleteTaskComposer: () => void;
};

export function TaskComposerModal({
  taskComposer,
  taskComposerError,
  isSavingTaskComposer,
  setTaskComposer,
  closeTaskComposer,
  saveTaskComposer,
  deleteTaskComposer,
}: TaskComposerModalProps) {
  const [relatedRefreshKey, setRelatedRefreshKey] = useState(0);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Close block editor"
        onClick={closeTaskComposer}
        className="absolute inset-0 rounded-sm"
      />

      <div className="relative w-full max-w-[500px] rounded-sm border border-gray-300 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.14)] selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]">
        <div className="border-b border-gray-200 px-3 py-2.5">
          <p className="text-sm font-medium text-gray-900">
            {taskComposer.id ? 'Edit block' : 'New block'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {format(new Date(taskComposer.dayKey), 'EEE, MMM d')} · {formatMinutesDisplay(taskComposer.startMinutes)} - {formatMinutesDisplay(taskComposer.endMinutes)}
          </p>
        </div>

        <div className="space-y-2.5 px-3 py-2.5">
          <div className="space-y-0.5">
            <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
              Title
            </label>
            <input
              value={taskComposer.title}
              onChange={(event) => {
                const value = event.target.value;
                setTaskComposer((prev) => (prev ? { ...prev, title: value } : prev));
              }}
              placeholder="What do you want to do?"
              className="h-8 w-full border border-gray-300 px-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
                Start
              </label>
              <input
                type="time"
                step={900}
                value={formatMinutesInput(taskComposer.startMinutes)}
                onChange={(event) => {
                  const nextMinutes = parseMinutes(event.target.value);
                  if (nextMinutes === null) return;

                  setTaskComposer((prev) => {
                    if (!prev) return prev;
                    const nextEnd = Math.max(prev.endMinutes, nextMinutes + 30);
                    return {
                      ...prev,
                      startMinutes: nextMinutes,
                      endMinutes: Math.min(nextEnd, 24 * 60),
                    };
                  });
                }}
                className="minimal-time-input h-8 w-full border border-gray-300 px-2 text-sm text-gray-900 outline-none focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
              />
            </div>
            <div className="space-y-0.5">
              <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
                End
              </label>
              <input
                type="time"
                step={900}
                value={formatMinutesInput(taskComposer.endMinutes)}
                onChange={(event) => {
                  const nextMinutes = parseMinutes(event.target.value);
                  if (nextMinutes === null) return;

                  setTaskComposer((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      endMinutes: Math.max(nextMinutes, prev.startMinutes + 30),
                    };
                  });
                }}
                className="minimal-time-input h-8 w-full border border-gray-300 px-2 text-sm text-gray-900 outline-none focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
              />
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
              Notes
            </label>
            <EntityNoteField
              value={taskComposer.notes}
              onChange={(value) => {
                setTaskComposer((prev) => (prev ? { ...prev, notes: value } : prev));
              }}
              rows={2}
              placeholder="Optional details..."
              className="w-full resize-none border border-gray-300 px-2.5 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
            />
          </div>

          {entityProtocolEnabled() && taskComposer.id ? (
            <div className="space-y-2">
              <EntityRelatedPanel
                entityRef={{ type: 'calendar_block', id: taskComposer.id }}
                refreshKey={relatedRefreshKey}
              />
              <EntityLinkPicker
                source={{ type: 'calendar_block', id: taskComposer.id }}
                onLinked={() => setRelatedRefreshKey((value) => value + 1)}
              />
            </div>
          ) : null}

          {taskComposerError && (
            <p className="text-xs text-red-600">{taskComposerError}</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2.5">
          {taskComposer.id ? (
            <button
              type="button"
              onClick={deleteTaskComposer}
              disabled={isSavingTaskComposer}
              className="h-8 rounded-sm border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeTaskComposer}
              disabled={isSavingTaskComposer}
              className="h-8 rounded-sm border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveTaskComposer}
              disabled={isSavingTaskComposer}
              className="h-8 border border-black bg-black px-3 text-sm text-white rounded-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingTaskComposer
                ? 'Saving...'
                : taskComposer.id
                  ? 'Update block'
                  : 'Save block'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
