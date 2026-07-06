'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Filter, LayoutGrid, List, Plus, SlidersHorizontal } from 'lucide-react';
import { KanbanColumn } from './KanbanColumn';
import { KanbanListView } from './KanbanListView';
import { KanbanCardDialog } from './KanbanCardDialog';
import { NewTaskDialog } from './NewTaskDialog';
import { ReflectionForm } from './ReflectionForm';
import { LogPrompt } from './LogPrompt';
import { useKanbanBoard } from '@/hooks/useKanbanBoard';
import type { KanbanCard as KanbanCardType } from '@/types/kanban';
import type { HabitOption } from './MetricLinker';
import { cn } from '@/lib/utils';
import { useUser } from '@clerk/nextjs';

const REFLECT_COLUMN_ID = 'in-review';

type ViewMode = 'board' | 'list';
type FilterTab = 'all' | 'active' | 'backlog';

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
    meta,
    columns,
    cards,
    resetBoard,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
    addBoardLabel,
    addComment,
    deleteComment,
    addChecklist,
    updateChecklistTitle,
    deleteChecklist,
    addChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
  } = useKanbanBoard(user?.id);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [searchText, setSearchText] = useState('');
  const [reflectCard, setReflectCard] = useState<KanbanCardType | null>(null);
  const [logPromptCard, setLogPromptCard] = useState<KanbanCardType | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<KanbanCardType | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskDefaultColumn, setNewTaskDefaultColumn] = useState<string | undefined>();

  // Keyboard shortcut: C to create new task (like Linear)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setNewTaskDefaultColumn(undefined);
        setNewTaskOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const habitMap = useMemo(() => new Map(habits.map((habit) => [habit.id, habit])), [habits]);

  const filteredCards = useMemo(() => {
    const needle = searchText.trim().toLowerCase();

    return cards.filter((card) => {
      if (!needle) return true;

      const linkedMetricName = card.linkedMetricId
        ? habitMap.get(card.linkedMetricId)?.name?.toLowerCase()
        : undefined;

      return (
        card.title.toLowerCase().includes(needle) ||
        card.description?.toLowerCase().includes(needle) ||
        linkedMetricName?.includes(needle)
      );
    });
  }, [cards, habitMap, searchText]);

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
      const oldIndex = columns.findIndex((c) => c.id === active.id);
      const newIndex = columns.findIndex((c) => c.id === over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      reorderColumns(arrayMove(columns.map((c) => c.id), oldIndex, newIndex));
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

  const handleCardClick = (card: KanbanCardType) => {
    const fresh = cards.find((c) => c.id === card.id) ?? card;
    setSelectedCard(fresh);
  };

  const handleToggleComplete = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    if (card.columnId === 'complete') {
      moveCard(cardId, 'todo');
    } else {
      moveCard(cardId, 'complete');
      if (card.linkedMetricId) {
        setLogPromptCard({ ...card, columnId: 'complete' });
      }
    }
  };

  const liveSelectedCard = selectedCard
    ? cards.find((c) => c.id === selectedCard.id) ?? null
    : null;

  const FILTER_TABS: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All issues' },
    { id: 'active', label: 'Active' },
    { id: 'backlog', label: 'Backlog' },
  ];

  return (
    <>
      <div className={cn('flex h-full flex-col bg-white', className)}>
        {fullPage && (
          <>
            {/* Top header */}
            <div className="flex items-center justify-between border-b border-[#f0f0f0] px-5 py-2.5">
              <h1 className="text-[14px] font-semibold text-[#1a1a1a]">{meta.title}</h1>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center rounded-md border border-[#e5e5e5]">
                  <button type="button" onClick={() => setViewMode('list')}
                    className={cn('flex items-center gap-1 rounded-l-md px-2.5 py-[5px] text-[12px] font-medium',
                      viewMode === 'list' ? 'bg-[#f5f5f5] text-[#1a1a1a]' : 'text-[#bbb] hover:text-[#888]')}>
                    <List className="h-3.5 w-3.5" /> List
                  </button>
                  <button type="button" onClick={() => setViewMode('board')}
                    className={cn('flex items-center gap-1 rounded-r-md px-2.5 py-[5px] text-[12px] font-medium',
                      viewMode === 'board' ? 'bg-[#f5f5f5] text-[#1a1a1a]' : 'text-[#bbb] hover:text-[#888]')}>
                    <LayoutGrid className="h-3.5 w-3.5" /> Board
                  </button>
                </div>
                <div className="mx-1 h-4 w-px bg-[#eee]" />
                <button type="button"
                  onClick={() => { setNewTaskDefaultColumn(undefined); setNewTaskOpen(true); }}
                  className="flex items-center gap-1.5 rounded-md bg-[#1a1a1a] px-3 py-[5px] text-[12px] font-medium text-white hover:bg-[#333]">
                  <Plus className="h-3.5 w-3.5" /> New task
                </button>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center border-b border-[#f0f0f0] px-5">
              {FILTER_TABS.map((tab) => (
                <button key={tab.id} type="button" onClick={() => setFilterTab(tab.id)}
                  className={cn('relative px-3 py-2 text-[13px]',
                    filterTab === tab.id ? 'font-medium text-[#1a1a1a]' : 'text-[#bbb] hover:text-[#888]')}>
                  {tab.label}
                  {filterTab === tab.id && <span className="absolute bottom-0 left-1 right-1 h-[1.5px] rounded-full bg-[#1a1a1a]" />}
                </button>
              ))}
              <button type="button"
                onClick={() => { const t = window.prompt('Column name:'); if (t?.trim()) addColumn(t); }}
                className="ml-0.5 rounded p-1.5 text-[#ccc] hover:text-[#999]" aria-label="Add">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <div className="flex-1" />
              <div className="flex items-center gap-0.5">
                <button type="button" className="rounded p-1.5 text-[#ccc] hover:text-[#999]" aria-label="Filter">
                  <Filter className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="rounded p-1.5 text-[#ccc] hover:text-[#999]" aria-label="Settings">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}

        {viewMode === 'board' ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className="px-6 py-5">
                <SortableContext
                  items={columns.map((c) => c.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
                    {columns.map((column) => (
                      <KanbanColumn
                        key={column.id}
                        column={column}
                        cards={filteredCardsByColumn[column.id] ?? []}
                        labels={meta.labels}
                        isDragOver={dragOverColumn === column.id}
                        onDeleteColumn={(targetColumn) => deleteColumn(targetColumn.id)}
                        onRenameColumn={(columnId, title) => updateColumn(columnId, { title })}
                        onDeleteCard={(card) => deleteCard(card.id)}
                        onAddCard={(columnId, data) => addCard(columnId, data)}
                        onUpdateCardTitle={(cardId, title) =>
                          updateCard(cardId, { title }, 'Updated card title')
                        }
                        onCardClick={handleCardClick}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            </DndContext>
          </div>
        ) : (
          <KanbanListView
            columns={columns}
            cards={filteredCards}
            labels={meta.labels}
            onToggleComplete={handleToggleComplete}
            onCardClick={handleCardClick}
            onAddCard={(columnId, data) => addCard(columnId, data)}
            onOpenNewTask={() => {
              setNewTaskDefaultColumn(undefined);
              setNewTaskOpen(true);
            }}
          />
        )}
      </div>

      {/* Card detail dialog */}
      <KanbanCardDialog
        open={Boolean(liveSelectedCard)}
        onOpenChange={(open) => !open && setSelectedCard(null)}
        card={liveSelectedCard}
        habits={habits}
        labels={meta.labels}
        columns={columns}
        onSave={(updates, activityMessage) => {
          if (!liveSelectedCard) return;
          updateCard(liveSelectedCard.id, updates, activityMessage);
          if (updates.columnId && updates.columnId !== liveSelectedCard.columnId) {
            moveCard(liveSelectedCard.id, updates.columnId);
          }
        }}
        onDelete={() => {
          if (!liveSelectedCard) return;
          deleteCard(liveSelectedCard.id);
          setSelectedCard(null);
        }}
        onCreateLabel={(name, color) => addBoardLabel(name, color)}
        onAddComment={(body) => {
          if (!liveSelectedCard) return;
          addComment(liveSelectedCard.id, body);
        }}
        onDeleteComment={(commentId) => {
          if (!liveSelectedCard) return;
          deleteComment(liveSelectedCard.id, commentId);
        }}
        onAddChecklist={(title) => {
          if (!liveSelectedCard) return null;
          return addChecklist(liveSelectedCard.id, title);
        }}
        onUpdateChecklistTitle={(checklistId, title) => {
          if (!liveSelectedCard) return;
          updateChecklistTitle(liveSelectedCard.id, checklistId, title);
        }}
        onDeleteChecklist={(checklistId) => {
          if (!liveSelectedCard) return;
          deleteChecklist(liveSelectedCard.id, checklistId);
        }}
        onAddChecklistItem={(checklistId, title) => {
          if (!liveSelectedCard) return null;
          return addChecklistItem(liveSelectedCard.id, checklistId, title);
        }}
        onToggleChecklistItem={(checklistId, itemId) => {
          if (!liveSelectedCard) return;
          toggleChecklistItem(liveSelectedCard.id, checklistId, itemId);
        }}
        onDeleteChecklistItem={(checklistId, itemId) => {
          if (!liveSelectedCard) return;
          deleteChecklistItem(liveSelectedCard.id, checklistId, itemId);
        }}
      />

      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        columns={columns}
        labels={meta.labels}
        defaultColumnId={newTaskDefaultColumn}
        onSubmit={(data) => {
          addCard(data.columnId, {
            title: data.title,
            description: data.description,
            priority: data.priority,
            dueDate: data.dueDate,
            labelIds: data.labelIds,
          });
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
    </>
  );
}
