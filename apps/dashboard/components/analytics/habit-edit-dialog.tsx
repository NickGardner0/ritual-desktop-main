'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import type { Habit } from '@/contexts/HabitsContext';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

interface HabitEditDialogProps {
  open: boolean;
  habit: Habit;
  nameDraft: string;
  unitDraft: string;
  onNameChange: (value: string) => void;
  onUnitChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
}

export function HabitEditDialog({
  open,
  habit,
  nameDraft,
  unitDraft,
  onNameChange,
  onUnitChange,
  onClose,
  onSave,
  isSaving,
}: HabitEditDialogProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/10" onClick={onClose} />
      <div
        className="relative w-full max-w-[540px] rounded-sm border border-gray-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.14)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-7 py-5">
          <h3 className="text-[17px] font-medium text-gray-900">Edit Habit</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Close edit habit dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-7 py-6">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-6 gap-y-4">
            <label htmlFor={`habit-name-${habit.id || 'unknown'}`} className="text-sm text-gray-500">
              Title
            </label>
            <input
              id={`habit-name-${habit.id || 'unknown'}`}
              value={nameDraft}
              onChange={(event) => onNameChange(event.target.value)}
              className="h-11 rounded-sm border border-gray-200 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-400"
              maxLength={72}
            />

            <label htmlFor={`habit-unit-${habit.id || 'unknown'}`} className="text-sm text-gray-500">
              Unit
            </label>
            <input
              id={`habit-unit-${habit.id || 'unknown'}`}
              value={unitDraft}
              onChange={(event) => onUnitChange(event.target.value)}
              className="h-11 rounded-sm border border-gray-200 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-400"
              maxLength={24}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-7 py-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-sm bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#27251E] disabled:opacity-50"
          >
            {isSaving ? (
              <BrailleSpinner className="text-[10px] text-white" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default HabitEditDialog;
