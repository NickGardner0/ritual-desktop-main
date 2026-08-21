'use client';

import { Download, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type { HabitLog } from '@/components/habit-logs/types';

type LogsSelectionBarProps = {
  selectedCount: number;
  selectedLogs: HabitLog[];
  deletableSelectedLogs: HabitLog[];
  deletePending: boolean;
  onDeselect: () => void;
  onExport: (logs: HabitLog[]) => void;
  onDelete: () => void;
};

export function LogsSelectionBar({
  selectedCount,
  selectedLogs,
  deletableSelectedLogs,
  deletePending,
  onDeselect,
  onExport,
  onDelete,
}: LogsSelectionBarProps) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className="border border-black/10 bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.2)] rounded-lg h-11 px-4 flex items-center gap-3">
            <span className="text-[13px] font-medium text-gray-900 tabular-nums">
              {selectedCount} selected
            </span>
            <div className="w-px h-5 bg-gray-200" />
            <button
              type="button"
              onClick={onDeselect}
              className="h-7 px-2.5 rounded-md text-[13px] text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Deselect
            </button>
            <button
              type="button"
              onClick={() => onExport(selectedLogs)}
              className="h-7 px-2.5 rounded-md text-[13px] text-gray-600 hover:bg-gray-100 transition-colors inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <div className="w-px h-5 bg-gray-200" />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-md text-[13px] text-red-600 hover:bg-red-50 transition-colors inline-flex items-center gap-1.5"
                  disabled={deletePending || deletableSelectedLogs.length === 0}
                >
                  {deletePending ? <BrailleSpinner className="text-sm text-red-600" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete selected logs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete {deletableSelectedLogs.length} editable log{deletableSelectedLogs.length === 1 ? '' : 's'}.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-none">Cancel</AlertDialogCancel>
                  <AlertDialogAction className="rounded-none" onClick={onDelete}>
                    Confirm delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
