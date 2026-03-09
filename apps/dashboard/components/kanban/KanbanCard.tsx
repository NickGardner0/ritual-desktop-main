'use client';

import React, { useState } from 'react';
import { Calendar, Trash2, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanCard as KanbanCardType } from '@/types/kanban';

function getCardIdentifier(card: KanbanCardType): string {
  const hash = Math.abs(
    card.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  );
  return `TRK-${String((hash % 100) + 1).padStart(2, '0')}`;
}

interface KanbanCardProps {
  card: KanbanCardType;
  onEdit: (card: KanbanCardType) => void;
  onDelete: (card: KanbanCardType) => void;
  linkedMetricName?: string;
  onDragStart: (card: KanbanCardType) => void;
  onDragEnd: () => void;
}

export function KanbanCard({
  card,
  onEdit,
  onDelete,
  linkedMetricName,
  onDragStart,
  onDragEnd,
}: KanbanCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const identifier = getCardIdentifier(card);
  const category = linkedMetricName ?? card.tags?.[0];
  const dueDate = card.scheduledTime ?? (card.isRecurring ? 'Today' : undefined);

  return (
    <div
      draggable
      onDragStart={(e) => {
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(card);
      }}
      onDragEnd={() => {
        setIsDragging(false);
        onDragEnd();
      }}
      className={cn(
        'group relative border border-border bg-card p-3 transition-all duration-150',
        'hover:border-foreground/15 hover:shadow-sm',
        'cursor-grab active:cursor-grabbing',
        isDragging && 'rotate-1 scale-[1.02] shadow-lg opacity-50 border-foreground/20'
      )}
    >
      {/* Top row: identifier + category + delete */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground/60 tracking-wide">
            {identifier}
          </span>
          {category && (
            <>
              <span className="text-[10px] text-muted-foreground/30">/</span>
              <span className="text-[11px] text-muted-foreground/50">{category}</span>
            </>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(card);
          }}
          className="p-0.5 text-muted-foreground/30 opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
          aria-label={`Delete ${card.title}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Title */}
      <h3
        className="mt-1.5 text-[13px] font-medium leading-snug text-foreground text-pretty"
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEdit(card);
        }}
      >
        {card.title}
      </h3>

      {/* Bottom meta row */}
      {(dueDate || card.streak > 0) && (
        <div className="mt-2.5 flex items-center gap-3">
          {dueDate && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Calendar className="h-2.5 w-2.5" />
              <span>{dueDate}</span>
            </div>
          )}

          {card.streak > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Flame className="h-2.5 w-2.5" />
              <span>{card.streak}d</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
