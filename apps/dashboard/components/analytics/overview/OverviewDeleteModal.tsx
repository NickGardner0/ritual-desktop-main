'use client';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/kibo-ui/spinner';

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
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-sm max-w-md w-full mx-4 shadow-lg border border-gray-300">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Habit</h3>
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete this habit? This action cannot be undone.
        </p>
        <div className="flex justify-end space-x-3">
          <Button
            variant="outline"
            onClick={onCancel}
            className="rounded-sm px-3 py-1.5 text-sm hover:bg-white focus:bg-white"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(habitToDelete)}
            disabled={deletingHabit === habitToDelete}
            className="rounded-sm bg-black text-white px-3 py-1.5 text-sm"
          >
            {deletingHabit === habitToDelete ? (
              <Spinner className="w-4 h-4" />
            ) : (
              'Delete'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
