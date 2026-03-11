'use client';

import React, { useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { format, isAfter, isBefore, startOfDay } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { KanbanHeader } from './KanbanHeader';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { KanbanCardDialog } from './KanbanCardDialog';
import { ReflectionForm } from './ReflectionForm';
import { LogPrompt } from './LogPrompt';
import { useKanbanBoard } from '@/hooks/useKanbanBoard';
import type {
  DueDateFilter,
  EnergyCost,
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

function matchesDueDateFilter(card: KanbanCardType, filters: DueDateFilter[]) {
  if (filters.length === 0) return true;
  const today = startOfDay(new Date());
  const dueDate = card.dueDate ? startOfDay(new Date(card.dueDate)) : null;

  return filters.some((filter) => {
    if (!dueDate) {
      return filter === 'no-date';
    }

    switch (filter) {
      case 'overdue':
        return isBefore(dueDate, today);
      case 'today':
        return format(dueDate, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
      case 'upcoming':
        return isAfter(dueDate, today);
      case 'no-date':
        return false;
      default:
        return true;
    }
  });
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
    meta,
    columns,
    cards,
    updateMeta,
    addBoardLabel,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
    addComment,
    deleteComment,
    addChecklist,
    updateChecklistTitle,
    deleteChecklist,
    addChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
  } = useKanbanBoard(user?.id);

  const [searchText, setSearchText] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>([]);
  const [selectedEnergy, setSelectedEnergy] = useState<EnergyCost[]>([]);
  const [selectedDueDateFilters, setSelectedDueDateFilters] = useState<DueDateFilter[]>([]);
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [renameColumn, setRenameColumn] = useState<KanbanColumnType | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [reflectCard, setReflectCard] = useState<KanbanCardType | null>(null);
  const [logPromptCard, setLogPromptCard] = useState<KanbanCardType | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const habitMap = useMemo(() => new Map(habits.map((habit) => [habit.id, habit])), [habits]);
  const labelMap = useMemo(() => new Map(meta.labels.map((label) => [label.id, label])), [meta.labels]);

  const completedCount = cards.filter((card) => card.columnId === 'complete').length;
  const editingCard = editingCardId ? cards.find((card) => card.id === editingCardId) ?? null : null;

  const filteredCards = useMemo(() => {
    const needle = searchText.trim().toLowerCase();

    return cards.filter((card) => {
      const activeLabels = card.labelIds.map((labelId) => labelMap.get(labelId)?.name?.toLowerCase()).filter(Boolean);
      const linkedMetricName = card.linkedMetricId ? habitMap.get(card.linkedMetricId)?.name?.toLowerCase() : undefined;
      const matchesSearch =
        !needle ||
        card.title.toLowerCase().includes(needle) ||
        card.description?.toLowerCase().includes(needle) ||
        activeLabels.some((label) => label?.includes(needle)) ||
        linkedMetricName?.includes(needle);

      const matchesLabels =
        selectedLabelIds.length === 0 ||
        selectedLabelIds.some((labelId) => card.labelIds.includes(labelId));

      const matchesColumns =
        selectedColumnIds.length === 0 || selectedColumnIds.includes(card.columnId);

      const matchesEnergy =
        selectedEnergy.length === 0 || selectedEnergy.includes(card.energyCost);

      const matchesRecurring = !recurringOnly || card.isRecurring;

      return (
        matchesSearch &&
        matchesLabels &&
        matchesColumns &&
        matchesEnergy &&
        matchesRecurring &&
        matchesDueDateFilter(card, selectedDueDateFilters)
      );
    });
  }, [
    cards,
    habitMap,
    labelMap,
    recurringOnly,
    searchText,
    selectedColumnIds,
    selectedDueDateFilters,
    selectedEnergy,
    selectedLabelIds,
  ]);

  const filteredCardsByColumn = useMemo(
    () =>
      columns.reduce<Record<string, KanbanCardType[]>>((acc, column) => {
        acc[column.id] = filteredCards.filter((card) => card.columnId === column.id);
        return acc;
      }, {}),
    [columns, filteredCards]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (_event: DragStartEvent) => {};

  const handleDragOver = ({ over }: DragOverEvent) => {
    if (!over) {
      setDragOverColumn(null);
      return;
    }

    const overType = over.data.current?.type as 'card' | 'column' | undefined;

    if (overType === 'column') {
      setDragOverColumn(String(over.id));
      return;
    }

    const overCard = cards.find((card) => card.id === over.id);
    setDragOverColumn(overCard?.columnId ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    setDragOverColumn(null);

    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type as 'card' | 'column' | undefined;
    const overType = over.data.current?.type as 'card' | 'column' | undefined;

    if (activeType === 'column' && overType === 'column') {
      const oldIndex = columns.findIndex((column) => column.id === active.id);
      const newIndex = columns.findIndex((column) => column.id === over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      reorderColumns(arrayMove(columns.map((column) => column.id), oldIndex, newIndex));
      return;
    }

    if (activeType !== 'card') return;

    const activeCard = cards.find((card) => card.id === active.id);
    if (!activeCard) return;

    if (overType === 'column') {
      moveCard(activeCard.id, String(over.id));
    } else {
      const overCard = cards.find((card) => card.id === over.id);
      if (!overCard) return;
      moveCard(activeCard.id, overCard.columnId, overCard.order);
    }

    const targetColumnId =
      overType === 'column'
        ? String(over.id)
        : cards.find((card) => card.id === over.id)?.columnId;

    if (!targetColumnId) return;

    if (targetColumnId === REFLECT_COLUMN_ID) {
      setReflectCard({ ...activeCard, columnId: targetColumnId });
    } else if (targetColumnId === 'complete' && activeCard.linkedMetricId) {
      setLogPromptCard({ ...activeCard, columnId: targetColumnId });
    }
  };

  const clearFilters = () => {
    setSelectedLabelIds([]);
    setSelectedColumnIds([]);
    setSelectedEnergy([]);
    setSelectedDueDateFilters([]);
    setRecurringOnly(false);
  };

  const toggleArrayValue = <T,>(list: T[], value: T, setList: (value: T[]) => void) => {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const handleColumnMenu = (column: KanbanColumnType, action: 'rename' | 'delete') => {
    if (action === 'rename') {
      setRenameColumn(column);
      setRenameTitle(column.title);
      return;
    }
    deleteColumn(column.id);
  };

  return (
    <>
      <div className={cn('flex h-full flex-col bg-[#FBFBF8]', className)}>
        {fullPage ? (
          <KanbanHeader
            boardTitle={meta.title}
            boardSlug={meta.slug}
            totalTasks={cards.length}
            completedTasks={completedCount}
            visibility={meta.visibility}
            searchText={showSearch ? searchText : ''}
            onSearchChange={setSearchText}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onVisibilityChange={(value) => updateMeta({ visibility: value })}
            onAddSection={() => setAddColumnOpen(true)}
            labels={meta.labels}
            columns={columns}
            selectedLabelIds={selectedLabelIds}
            selectedColumnIds={selectedColumnIds}
            selectedEnergy={selectedEnergy}
            selectedDueDateFilters={selectedDueDateFilters}
            recurringOnly={recurringOnly}
            onToggleLabel={(labelId) => toggleArrayValue(selectedLabelIds, labelId, setSelectedLabelIds)}
            onToggleColumn={(columnId) => toggleArrayValue(selectedColumnIds, columnId, setSelectedColumnIds)}
            onToggleEnergy={(energy) => toggleArrayValue(selectedEnergy, energy, setSelectedEnergy)}
            onToggleDueDateFilter={(filter) =>
              toggleArrayValue(selectedDueDateFilters, filter, setSelectedDueDateFilters)
            }
            onToggleRecurringOnly={() => setRecurringOnly((current) => !current)}
            onClearFilters={clearFilters}
          />
        ) : null}

        <div
          className="flex-1 overflow-auto"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(39,37,30,0.09) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {viewMode === 'board' ? (
              <div className="h-full overflow-x-auto px-6 py-6">
                <SortableContext
                  items={columns.map((column) => column.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className="flex min-h-full items-start gap-5">
                    {columns.map((column) => (
                      <KanbanColumn
                        key={column.id}
                        column={column}
                        cards={filteredCardsByColumn[column.id] ?? []}
                        labels={meta.labels}
                        habitMap={habitMap}
                        isDragOver={dragOverColumn === column.id}
                        onOpenCard={(card) => setEditingCardId(card.id)}
                        onDeleteCard={(card) => deleteCard(card.id)}
                        onAddCard={(columnId, data) => addCard(columnId, data)}
                        onColumnMenu={handleColumnMenu}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            ) : (
              <div className="space-y-5 px-6 py-6">
                {columns.map((column) => {
                  const columnCards = filteredCardsByColumn[column.id] ?? [];
                  return (
                    <section
                      key={column.id}
                      className="rounded-sm border border-border bg-[rgba(255,255,255,0.92)] shadow-[0_1px_0_rgba(39,37,30,0.04)]"
                    >
                      <div className="flex items-center justify-between border-b border-border px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-medium text-[#111827]">{column.title}</span>
                          <span className="text-[13px] text-[rgba(39,37,30,0.42)]">{columnCards.length}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => addCard(column.id, { title: 'Untitled task' })}
                          className="rounded-sm border border-border px-2.5 py-1.5 text-xs text-[rgba(39,37,30,0.58)] transition-colors hover:bg-[#F5F5F2] hover:text-[#111827]"
                        >
                          Quick add
                        </button>
                      </div>
                      <SortableContext
                        items={columnCards.map((card) => card.id)}
                        strategy={rectSortingStrategy}
                      >
                        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                          {columnCards.map((card) => (
                            <KanbanCard
                              key={card.id}
                              card={card}
                              labels={meta.labels}
                              linkedMetricName={
                                card.linkedMetricId ? habitMap.get(card.linkedMetricId)?.name : undefined
                              }
                              onOpen={(nextCard) => setEditingCardId(nextCard.id)}
                              onDelete={(nextCard) => deleteCard(nextCard.id)}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </section>
                  );
                })}
              </div>
            )}

          </DndContext>
        </div>
      </div>

      <KanbanCardDialog
        open={Boolean(editingCard)}
        onOpenChange={(open) => {
          if (!open) setEditingCardId(null);
        }}
        card={editingCard}
        habits={habits}
        labels={meta.labels}
        columns={columns}
        onSave={(updates, activityMessage) => {
          if (!editingCard) return;
          const { columnId, ...rest } = updates;

          if (columnId && columnId !== editingCard.columnId) {
            moveCard(editingCard.id, columnId);

            if (columnId === REFLECT_COLUMN_ID) {
              setReflectCard({ ...editingCard, columnId });
            } else if (columnId === 'complete' && editingCard.linkedMetricId) {
              setLogPromptCard({ ...editingCard, columnId });
            }
          }

          if (Object.keys(rest).length > 0) {
            updateCard(editingCard.id, rest, activityMessage);
          }
        }}
        onDelete={() => {
          if (!editingCard) return;
          deleteCard(editingCard.id);
          setEditingCardId(null);
        }}
        onCreateLabel={(name, color) => addBoardLabel(name, color)}
        onAddComment={(body) => {
          if (!editingCard) return;
          addComment(editingCard.id, body);
        }}
        onDeleteComment={(commentId) => {
          if (!editingCard) return;
          deleteComment(editingCard.id, commentId);
        }}
        onAddChecklist={(title) => {
          if (!editingCard) return null;
          return addChecklist(editingCard.id, title);
        }}
        onUpdateChecklistTitle={(checklistId, title) => {
          if (!editingCard) return;
          updateChecklistTitle(editingCard.id, checklistId, title);
        }}
        onDeleteChecklist={(checklistId) => {
          if (!editingCard) return;
          deleteChecklist(editingCard.id, checklistId);
        }}
        onAddChecklistItem={(checklistId, title) => {
          if (!editingCard) return null;
          return addChecklistItem(editingCard.id, checklistId, title);
        }}
        onToggleChecklistItem={(checklistId, itemId) => {
          if (!editingCard) return;
          toggleChecklistItem(editingCard.id, checklistId, itemId);
        }}
        onDeleteChecklistItem={(checklistId, itemId) => {
          if (!editingCard) return;
          deleteChecklistItem(editingCard.id, checklistId, itemId);
        }}
      />

      <ReflectionForm
        open={Boolean(reflectCard)}
        onOpenChange={(open) => !open && setReflectCard(null)}
        cardTitle={reflectCard?.title ?? ''}
        onSubmit={(reflection) => {
          if (!reflectCard) return;
          updateCard(reflectCard.id, { reflection }, 'Saved reflection');
          setReflectCard(null);
        }}
      />

      <LogPrompt
        open={Boolean(logPromptCard)}
        onOpenChange={(open) => !open && setLogPromptCard(null)}
        title="Log completion"
        metricName={
          logPromptCard?.linkedMetricId
            ? habitMap.get(logPromptCard.linkedMetricId)?.name ?? 'Metric'
            : 'Metric'
        }
        unit={
          logPromptCard?.linkedMetricId
            ? habitMap.get(logPromptCard.linkedMetricId)?.unit_type
            : undefined
        }
        onSubmit={async (value) => {
          if (!logPromptCard?.linkedMetricId || !onLogMetric) return;
          const today = new Date().toISOString().split('T')[0];
          await onLogMetric(logPromptCard.linkedMetricId, value, today);
          setLogPromptCard(null);
        }}
      />

      <Dialog open={addColumnOpen} onOpenChange={setAddColumnOpen}>
        <DialogContent className="sm:max-w-[360px] rounded-sm border-border">
          <DialogHeader>
            <DialogTitle>New list</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="new-column-title">List name</Label>
            <Input
              id="new-column-title"
              value={newColumnTitle}
              onChange={(event) => setNewColumnTitle(event.target.value)}
              placeholder="e.g. Planned"
              className="rounded-sm border-border"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddColumnOpen(false)} className="rounded-sm border-border">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!newColumnTitle.trim()) return;
                addColumn(newColumnTitle);
                setNewColumnTitle('');
                setAddColumnOpen(false);
              }}
              disabled={!newColumnTitle.trim()}
              className="rounded-sm"
            >
              Create list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameColumn)} onOpenChange={(open) => !open && setRenameColumn(null)}>
        <DialogContent className="sm:max-w-[360px] rounded-sm border-border">
          <DialogHeader>
            <DialogTitle>Rename list</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="rename-column-title">List name</Label>
            <Input
              id="rename-column-title"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              placeholder="List name"
              className="rounded-sm border-border"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameColumn(null)} className="rounded-sm border-border">
              Cancel
            </Button>
            <Button
              className="rounded-sm"
              disabled={!renameTitle.trim()}
              onClick={() => {
                if (!renameColumn || !renameTitle.trim()) return;
                updateColumn(renameColumn.id, { title: renameTitle.trim() });
                setRenameColumn(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
