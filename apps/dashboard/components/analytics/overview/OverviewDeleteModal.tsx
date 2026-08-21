'use client';

import { createPortal } from 'react-dom';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

interface OverviewDeleteModalProps {
  habitToDelete: string;
  deletingHabit: string | null;
  onCancel: () => void;
  onConfirm: (habitId: string) => void;
}

export function OverviewDeleteModal({
  habitToDelete,
  deletingHabit,
  onCancel,
  onConfirm,
}: OverviewDeleteModalProps) {
  const isDeleting = deletingHabit === habitToDelete;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex h-[100dvh] w-screen items-center justify-center overflow-hidden p-4">
      <div
        className="absolute inset-0 bg-[rgba(232,229,223,0.28)] backdrop-blur-[8px]"
        onClick={onCancel}
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-habit-title"
        aria-describedby="delete-habit-description"
        className="relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-[rgba(39,37,30,0.08)] bg-[rgba(255,255,255,0.92)] p-5 shadow-[0_24px_64px_rgba(28,25,18,0.16),0_4px_16px_rgba(28,25,18,0.06)] supports-[backdrop-filter]:bg-[rgba(255,255,255,0.86)] supports-[backdrop-filter]:backdrop-blur-xl"
      >
        <h3
          id="delete-habit-title"
          className="text-[17px] font-medium tracking-[-0.015em] text-[#27251E]"
        >
          Delete Habit
        </h3>
        <p
          id="delete-habit-description"
          className="mt-2 text-[13.5px] leading-[1.45] text-[rgba(39,37,30,0.55)]"
        >
          Are you sure you want to delete this habit? This action cannot be undone.
        </p>
        <div className="mt-5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md px-2.5 text-[12.5px] font-normal text-[rgba(39,37,30,0.55)] transition-none hover:bg-[#F3F3F3] hover:text-[#27251E]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(habitToDelete)}
            disabled={isDeleting}
            className="inline-flex h-8 items-center justify-center rounded-md border border-black bg-black px-3 text-[12.5px] font-normal text-white transition-none hover:bg-[#3D3C38] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isDeleting ? <BrailleSpinner className="h-4 w-4" /> : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
