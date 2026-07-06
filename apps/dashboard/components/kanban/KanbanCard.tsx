'use client';

import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { StatusIcon, NoPriorityIcon, PriorityIcon } from './kanban-icons';
import type { KanbanCard as KanbanCardType, KanbanLabel } from '@/types/kanban';

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface KanbanCardProps {
  card: KanbanCardType;
  labels?: KanbanLabel[];
  onDelete: (card: KanbanCardType) => void;
  onUpdateTitle: (cardId: string, title: string) => void;
  onClick?: (card: KanbanCardType) => void;
}

export function KanbanCard({
  card,
  labels = [],
  onDelete,
  onUpdateTitle,
  onClick,
}: KanbanCardProps) {
  const [editing, setEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(card.title);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card', cardId: card.id, columnId: card.columnId },
  });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const createdDate = formatDate(card.createdAt);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-lg border border-[#ebebeb] bg-white px-3 py-2.5 cursor-pointer',
        'transition-shadow hover:shadow-[0_1px_4px_rgba(0,0,0,0.04)]',
        isDragging && 'opacity-40'
      )}
      onClick={() => { if (!editing) onClick?.(card); }}
      {...attributes}
      {...listeners}
    >
      {/* Title row */}
      <div className="flex items-start gap-2">
        <StatusIcon columnId={card.columnId} size={14} className="mt-[3px] shrink-0" />

        {editing ? (
          <input
            autoFocus
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={() => {
              const v = titleValue.trim();
              if (v) onUpdateTitle(card.id, v);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); const v = titleValue.trim(); if (v) onUpdateTitle(card.id, v); setEditing(false); }
              if (e.key === 'Escape') { setTitleValue(card.title); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-[13px] text-[#1a1a1a] outline-none"
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
            className="flex-1 text-[13px] leading-[1.45] text-[#1a1a1a]"
          >
            {card.title}
          </span>
        )}
      </div>

      {/* Bottom meta */}
      {createdDate && (
        <div className="flex items-center pl-[22px]">
          <span className="text-[11px] text-[#bbb]">{createdDate}</span>
        </div>
      )}
    </div>
  );
}
