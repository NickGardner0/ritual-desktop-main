'use client';

import React, { useState } from 'react';
import { Plus, MoreHorizontal } from 'lucide-react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusIcon } from './StatusIcon';
import { KanbanCard } from './KanbanCard';
import { cn } from '@/lib/utils';
import type {
  KanbanCard as KanbanCardType,
  KanbanColumn as KanbanColumnType,
  KanbanLabel,
} from '@/types/kanban';
import type { HabitOption } from './MetricLinker';

interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCardType[];
  labels: KanbanLabel[];
  habitMap: Map<string, HabitOption>;
  isDragOver: boolean;
  onOpenCard: (card: KanbanCardType) => void;
  onDeleteCard: (card: KanbanCardType) => void;
  onAddCard: (columnId: string, data: { title: string }) => void;
  onColumnMenu: (column: KanbanColumnType, action: 'rename' | 'delete') => void;
}

export function KanbanColumn({
  column,
  cards,
  labels,
  habitMap,
  isDragOver,
  onOpenCard,
  onDeleteCard,
  onAddCard,
  onColumnMenu,
}: KanbanColumnProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: {
      type: 'column',
      columnId: column.id,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const sortedCards = [...cards].sort((a, b) => a.order - b.order);

  const submit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onAddCard(column.id, { title: trimmedTitle });
    setTitle('');
    setIsAdding(false);
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex h-full min-w-[320px] max-w-[320px] flex-col rounded-sm border border-border bg-[rgba(255,255,255,0.9)] shadow-[0_1px_0_rgba(39,37,30,0.04)]',
        isDragOver && 'border-[#27251E] bg-[rgba(255,255,255,0.98)]',
        isDragging && 'opacity-60'
      )}
    >
      <div
        className="flex items-center justify-between border-b border-border px-4 py-3"
        {...attributes}
        {...listeners}
      >
        <div className="flex items-center gap-2">
          <StatusIcon columnId={column.id} className="h-4 w-4 text-[rgba(39,37,30,0.56)]" />
          <span className="text-[15px] font-medium text-[#111827]">{column.title}</span>
          <span className="text-[13px] text-[rgba(39,37,30,0.42)]">{cards.length}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="rounded-sm p-1.5 text-[rgba(39,37,30,0.42)] transition-colors hover:bg-[#F5F5F2] hover:text-[#111827]"
            aria-label={`Add card to ${column.title}`}
          >
            <Plus className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-sm p-1.5 text-[rgba(39,37,30,0.42)] transition-colors hover:bg-[#F5F5F2] hover:text-[#111827]"
                aria-label={`${column.title} options`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-sm border-border">
              <DropdownMenuItem onClick={() => onColumnMenu(column, 'rename')}>
                Rename list
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600"
                onClick={() => onColumnMenu(column, 'delete')}
              >
                Delete list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {isAdding ? (
          <div className="rounded-sm border border-border bg-white p-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
                if (event.key === 'Escape') {
                  setIsAdding(false);
                  setTitle('');
                }
              }}
              onBlur={() => {
                if (!title.trim()) {
                  setIsAdding(false);
                }
              }}
              placeholder="Card title"
              autoFocus
              className="w-full bg-transparent text-[14px] text-[#111827] placeholder:text-[rgba(39,37,30,0.34)] focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={submit}
                className="rounded-sm bg-[#111827] px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#27251E]"
              >
                Add card
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setTitle('');
                }}
                className="rounded-sm px-2.5 py-1.5 text-[12px] text-[rgba(39,37,30,0.58)] transition-colors hover:bg-[#F5F5F2] hover:text-[#111827]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 rounded-sm border border-dashed border-border px-3 py-2 text-[13px] text-[rgba(39,37,30,0.46)] transition-colors hover:border-[rgba(39,37,30,0.24)] hover:bg-[#F8F8F5] hover:text-[#111827]"
          >
            <Plus className="h-4 w-4" />
            Add card
          </button>
        )}

        <SortableContext items={sortedCards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-3">
            {sortedCards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                labels={labels}
                linkedMetricName={
                  card.linkedMetricId ? habitMap.get(card.linkedMetricId)?.name : undefined
                }
                onOpen={onOpenCard}
                onDelete={onDeleteCard}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </section>
  );
}
