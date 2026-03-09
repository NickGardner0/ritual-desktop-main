'use client';

import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { KanbanHeader } from './KanbanHeader';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCardDialog } from './KanbanCardDialog';
import { ReflectionForm } from './ReflectionForm';
import { LogPrompt } from './LogPrompt';
import { useKanbanBoard } from '@/hooks/useKanbanBoard';
import type {
  KanbanCard as KanbanCardType,
  KanbanColumn as KanbanColumnType,
} from '@/types/kanban';
import type { HabitOption } from './MetricLinker';
import { cn } from '@/lib/utils';
import { useUser } from '@clerk/nextjs';

const REFLECT_COLUMN_ID = 'in-review';

interface KanbanBoardProps {
  habits: HabitOption[];
  onLogMetric?: (habitId: string, value: number, date?: string) => Promise<void>;
  className?: string;
  fullPage?: boolean;
  showSearch?: boolean;
}

export function KanbanBoard({
  habits,
  onLogMetric,
  className,
  fullPage = true,
  showSearch = true,
}: KanbanBoardProps) {
  const { user } = useUser();
  const {
    columns,
    cards,
    addColumn,
    updateColumn,
    deleteColumn,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
  } = useKanbanBoard(user?.id);

  const [filterText, setFilterText] = useState('');
  const [draggedTask, setDraggedTask] = useState<KanbanCardType | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<KanbanCardType | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [renameColumn, setRenameColumn] = useState<KanbanColumnType | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [reflectCard, setReflectCard] = useState<KanbanCardType | null>(null);
  const [logPromptCard, setLogPromptCard] = useState<{
    card: KanbanCardType;
  } | null>(null);

  const habitMap = new Map(habits.map((h) => [h.id, h]));
  const completedCount = cards.filter((c) => c.columnId === 'complete').length;
  const filteredCards = filterText.trim()
    ? cards.filter(
        (c) =>
          c.title.toLowerCase().includes(filterText.toLowerCase()) ||
          c.tags?.some((t) =>
            t.toLowerCase().includes(filterText.toLowerCase())
          ) ||
          (c.linkedMetricId &&
            habitMap.get(c.linkedMetricId)?.name?.toLowerCase().includes(filterText.toLowerCase()))
      )
    : cards;

  const handleDragStart = useCallback((task: KanbanCardType) => {
    setDraggedTask(task);
  }, []);

  const handleDragOver = useCallback((columnId: string | null) => {
    setDragOverColumn(columnId);
  }, []);


  const handleDragEnd = useCallback(() => {
    setDraggedTask(null);
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (targetColumnId: string) => {
      if (!draggedTask) return;

      moveCard(draggedTask.id, targetColumnId);
      setDraggedTask(null);
      setDragOverColumn(null);

      if (targetColumnId === REFLECT_COLUMN_ID) {
        setReflectCard({ ...draggedTask, columnId: targetColumnId });
      } else if (targetColumnId === 'complete' && draggedTask.linkedMetricId) {
        setLogPromptCard({ card: draggedTask });
      }
    },
    [draggedTask, moveCard]
  );

  const handleColumnMenu = useCallback(
    (column: KanbanColumnType, action: 'rename' | 'delete') => {
      if (action === 'rename') {
        setRenameColumn(column);
        setRenameTitle(column.title);
      } else {
        deleteColumn(column.id);
      }
    },
    [deleteColumn]
  );

  const handleReflectionSubmit = useCallback(
    (reflection: {
      rating: number;
      energyAfter: 'low' | 'medium' | 'high';
      notes?: string;
    }) => {
      if (reflectCard) {
        updateCard(reflectCard.id, { reflection });
        setReflectCard(null);
      }
    },
    [reflectCard, updateCard]
  );

  const handleLogSubmit = useCallback(
    async (value: number) => {
      if (!logPromptCard?.card.linkedMetricId) return;
      if (onLogMetric) {
        const today = new Date().toISOString().split('T')[0];
        await onLogMetric(logPromptCard.card.linkedMetricId, value, today);
      }
      setLogPromptCard(null);
    },
    [logPromptCard, onLogMetric]
  );

  const handleAddColumn = () => {
    const t = newColumnTitle.trim();
    if (t) {
      addColumn(t);
      setNewColumnTitle('');
      setAddColumnOpen(false);
    }
  };

  return (
    <>
      <div className={cn('flex h-full flex-col bg-background', className)}>
        {fullPage && (
          <KanbanHeader
            totalTasks={cards.length}
            completedTasks={completedCount}
            filterText={filterText}
            onFilterChange={setFilterText}
            onAddSection={showSearch ? () => setAddColumnOpen(true) : undefined}
          />
        )}
        <div className="flex flex-1 gap-0 overflow-x-auto">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              cards={filteredCards.filter((c) => c.columnId === column.id)}
              habitMap={habitMap}
              isDragOver={dragOverColumn === column.id}
              isReflectColumn={column.id === REFLECT_COLUMN_ID}
              onEditCard={setEditingCard}
              onDeleteCard={(card) => deleteCard(card.id)}
              onAddCard={(colId, data) =>
                addCard(colId, {
                  title: data.title,
                  energyCost: 'medium',
                })
              }
              onColumnMenu={handleColumnMenu}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </div>

      <KanbanCardDialog
        open={!!editingCard}
        onOpenChange={(open) => !open && setEditingCard(null)}
        card={editingCard}
        habits={habits}
        onSave={(updates) => {
          if (editingCard) updateCard(editingCard.id, updates);
        }}
      />

      <ReflectionForm
        open={!!reflectCard}
        onOpenChange={(open) => !open && setReflectCard(null)}
        cardTitle={reflectCard?.title ?? ''}
        onSubmit={handleReflectionSubmit}
      />

      <LogPrompt
        open={!!logPromptCard}
        onOpenChange={(open) => !open && setLogPromptCard(null)}
        title="Log completion"
        metricName={
          logPromptCard
            ? habitMap.get(logPromptCard.card.linkedMetricId!)?.name ?? 'Metric'
            : ''
        }
        unit={
          logPromptCard
            ? habitMap.get(logPromptCard.card.linkedMetricId!)?.unit_type
            : undefined
        }
        onSubmit={handleLogSubmit}
      />

      <Dialog open={addColumnOpen} onOpenChange={setAddColumnOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Add column</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="new-col-title">Column name</Label>
            <Input
              id="new-col-title"
              value={newColumnTitle}
              onChange={(e) => setNewColumnTitle(e.target.value)}
              placeholder="e.g. Backlog"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddColumnOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddColumn} disabled={!newColumnTitle.trim()}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!renameColumn}
        onOpenChange={(open) => !open && setRenameColumn(null)}
      >
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Rename column</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="rename-col">Column name</Label>
            <Input
              id="rename-col"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Column name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameColumn(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renameColumn && renameTitle.trim()) {
                  updateColumn(renameColumn.id, { title: renameTitle.trim() });
                  setRenameColumn(null);
                }
              }}
              disabled={!renameTitle.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
