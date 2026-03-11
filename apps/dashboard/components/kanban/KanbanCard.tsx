'use client';

import React from 'react';
import {
  Calendar,
  CheckSquare,
  MessageSquare,
  MoreHorizontal,
  Repeat2,
  Target,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { KanbanCard as KanbanCardType, KanbanLabel } from '@/types/kanban';

interface KanbanCardProps {
  card: KanbanCardType;
  labels: KanbanLabel[];
  linkedMetricName?: string;
  onOpen: (card: KanbanCardType) => void;
  onDelete: (card: KanbanCardType) => void;
}

function checklistSummary(card: KanbanCardType) {
  const items = card.checklists.flatMap((checklist) => checklist.items);
  const completed = items.filter((item) => item.completed).length;
  return {
    total: items.length,
    completed,
  };
}

function isOverdue(value?: string) {
  if (!value) return false;
  const dueDate = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate < today;
}

export function KanbanCard({
  card,
  labels,
  linkedMetricName,
  onOpen,
  onDelete,
}: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: {
      type: 'card',
      cardId: card.id,
      columnId: card.columnId,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const activeLabels = labels.filter((label) => card.labelIds.includes(label.id));
  const checklist = checklistSummary(card);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group rounded-sm border border-border bg-white shadow-[0_1px_0_rgba(39,37,30,0.03)] transition-all',
        'hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]',
        isDragging && 'rotate-[0.8deg] opacity-60 shadow-[0_12px_24px_rgba(15,23,42,0.14)]'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(card)}
        className="block w-full cursor-pointer px-4 py-3 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div
            className="min-w-0 flex-1"
            {...attributes}
            {...listeners}
          >
            <h3 className="text-[15px] font-medium leading-[1.35] text-[#111827]">
              {card.title}
            </h3>
            {card.description ? (
              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[rgba(39,37,30,0.56)]">
                {card.description}
              </p>
            ) : null}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="rounded-sm p-1 text-[rgba(39,37,30,0.36)] opacity-0 transition-colors hover:bg-[#F5F5F2] hover:text-[#111827] group-hover:opacity-100"
                aria-label={`Open menu for ${card.title}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-sm border-border">
              <DropdownMenuItem onClick={() => onOpen(card)}>Open details</DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600"
                onClick={() => onDelete(card)}
              >
                Delete card
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {activeLabels.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {activeLabels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-[rgba(39,37,30,0.66)]"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[rgba(39,37,30,0.54)]">
            {linkedMetricName ? (
              <span className="inline-flex items-center gap-1">
                <Target className="h-3.5 w-3.5" />
                {linkedMetricName}
              </span>
            ) : null}

            {card.isRecurring ? (
              <span className="inline-flex items-center gap-1">
                <Repeat2 className="h-3.5 w-3.5" />
                Recurring
              </span>
            ) : null}

            {card.dueDate ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  isOverdue(card.dueDate) && 'text-[#b42318]'
                )}
              >
                <Calendar className="h-3.5 w-3.5" />
                {new Date(card.dueDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[rgba(39,37,30,0.52)]">
            {checklist.total > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
                <CheckSquare className="h-3.5 w-3.5" />
                {checklist.completed}/{checklist.total}
              </span>
            ) : null}
            {card.comments.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                {card.comments.length}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    </div>
  );
}
