'use client';

import React, { useState } from 'react';
import { Plus, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { KanbanCard } from './KanbanCard';
import { StatusIcon } from './StatusIcon';
import { cn } from '@/lib/utils';
import type {
  KanbanColumn as KanbanColumnType,
  KanbanCard as KanbanCardType,
} from '@/types/kanban';
import type { HabitOption } from './MetricLinker';

interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCardType[];
  habitMap: Map<string, HabitOption>;
  isDragOver: boolean;
  isReflectColumn: boolean;
  onEditCard: (card: KanbanCardType) => void;
  onDeleteCard: (card: KanbanCardType) => void;
  onAddCard: (columnId: string, data: { title: string }) => void;
  onColumnMenu: (column: KanbanColumnType, action: 'rename' | 'delete') => void;
  onDragStart: (card: KanbanCardType) => void;
  onDragOver: (columnId: string | null) => void;
  onDragEnd: () => void;
  onDrop: (columnId: string) => void;
}

export function KanbanColumn({
  column,
  cards,
  habitMap,
  isDragOver,
  isReflectColumn,
  onEditCard,
  onDeleteCard,
  onAddCard,
  onColumnMenu,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: KanbanColumnProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const sortedCards = [...cards].sort((a, b) => a.order - b.order);

  const handleSubmit = () => {
    const t = newTaskTitle.trim();
    if (t) {
      onAddCard(column.id, { title: t });
      setNewTaskTitle('');
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsAdding(false);
      setNewTaskTitle('');
    }
  };

  return (
    <div
      className={cn(
        'flex min-w-[280px] flex-1 flex-col border-r border-border last:border-r-0',
        isDragOver && 'bg-accent/50'
      )}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(column.id);
      }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(column.id);
      }}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusIcon columnId={column.id} className="h-4 w-4" />
          <span className="text-sm font-medium text-foreground">{column.title}</span>
          <span className="text-xs text-muted-foreground">{cards.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setIsAdding(true)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Add task to ${column.title}`}
          >
            <Plus className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={`${column.title} options`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onColumnMenu(column, 'rename')}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onColumnMenu(column, 'delete')}
                className="text-destructive"
              >
                Delete column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tasks */}
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
        <div className="flex flex-col gap-1.5">
          {/* Inline Add Task */}
          {isAdding && !isReflectColumn && (
            <div className="rounded-md border border-ring bg-card p-3 shadow-sm">
              <input
                type="text"
                placeholder="Task title"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  if (!newTaskTitle.trim()) setIsAdding(false);
                }}
                autoFocus
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={handleSubmit}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsAdding(false);
                    setNewTaskTitle('');
                  }}
                  className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {sortedCards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              linkedMetricName={card.linkedMetricId ? habitMap.get(card.linkedMetricId)?.name : undefined}
              onEdit={onEditCard}
              onDelete={onDeleteCard}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>

        {/* Add task button at the bottom */}
        {!isAdding && !isReflectColumn && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Add task
          </button>
        )}
      </div>
    </div>
  );
}
