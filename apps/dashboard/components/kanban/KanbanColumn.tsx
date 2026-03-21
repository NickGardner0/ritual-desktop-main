'use client';

import React, { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { KanbanCard } from './KanbanCard';
import { StatusIcon } from './kanban-icons';
import { cn } from '@/lib/utils';
import type { KanbanCard as KanbanCardType, KanbanColumn as KanbanColumnType, KanbanLabel } from '@/types/kanban';

interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCardType[];
  labels: KanbanLabel[];
  isDragOver: boolean;
  onDeleteColumn: (column: KanbanColumnType) => void;
  onRenameColumn: (columnId: string, title: string) => void;
  onDeleteCard: (card: KanbanCardType) => void;
  onAddCard: (columnId: string, data: { title: string }) => void;
  onUpdateCardTitle: (cardId: string, title: string) => void;
  onCardClick?: (card: KanbanCardType) => void;
}

export function KanbanColumn({
  column,
  cards,
  labels,
  isDragOver,
  onDeleteColumn,
  onRenameColumn,
  onDeleteCard,
  onAddCard,
  onUpdateCardTitle,
  onCardClick,
}: KanbanColumnProps) {
  const [draftTitle, setDraftTitle] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(column.title);

  const { setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const sortedCards = [...cards].sort((a, b) => a.order - b.order);

  const submit = () => {
    const t = draftTitle.trim();
    if (!t) return;
    onAddCard(column.id, { title: t });
    setDraftTitle('');
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn('group/col flex min-w-0 flex-col', isDragging && 'opacity-50')}
    >
      {/* Header */}
      <div className="flex items-center gap-2 pb-3">
        <StatusIcon columnId={column.id} size={15} />

        {editingTitle ? (
          <input
            autoFocus
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={() => { const v = titleValue.trim(); if (v) onRenameColumn(column.id, v); setEditingTitle(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); const v = titleValue.trim(); if (v) onRenameColumn(column.id, v); setEditingTitle(false); }
              if (e.key === 'Escape') { setTitleValue(column.title); setEditingTitle(false); }
            }}
            className="flex-1 bg-transparent text-[13px] font-medium text-[#1a1a1a] outline-none"
          />
        ) : (
          <span
            onDoubleClick={() => setEditingTitle(true)}
            className="text-[13px] font-medium text-[#1a1a1a] cursor-default select-none"
          >
            {column.title}
          </span>
        )}

        <span className="text-[12px] tabular-nums text-[#bbb]">{cards.length}</span>

        <div className="ml-auto flex items-center gap-0 opacity-0 transition-opacity group-hover/col:opacity-100">
          <button type="button" onClick={() => onDeleteColumn(column)}
            className="rounded p-1 text-[#ccc] hover:text-[#888]" aria-label="Options">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setShowInput(true)}
            className="rounded p-1 text-[#ccc] hover:text-[#888]" aria-label="Add">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className={cn('flex min-h-[32px] flex-1 flex-col gap-[5px]', isDragOver && 'rounded bg-[#fafafa]')}>
        <SortableContext items={sortedCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {sortedCards.map((card) => (
            <KanbanCard key={card.id} card={card} labels={labels}
              onDelete={onDeleteCard} onUpdateTitle={onUpdateCardTitle} onClick={onCardClick} />
          ))}
        </SortableContext>
      </div>

      {/* Add row */}
      {showInput ? (
        <div className="mt-1.5 rounded-lg border border-[#ebebeb] bg-white px-3 py-2">
          <input autoFocus value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); setShowInput(false); }
              if (e.key === 'Escape') { setDraftTitle(''); setShowInput(false); }
            }}
            onBlur={() => { if (draftTitle.trim()) submit(); setShowInput(false); }}
            placeholder="Task title"
            className="w-full text-[13px] text-[#1a1a1a] outline-none placeholder:text-[#ccc]"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setShowInput(true)}
          className="mt-1.5 flex w-full items-center justify-center rounded-lg border border-dashed border-[#e5e5e5] py-1.5 text-[#ccc] transition-colors hover:border-[#bbb] hover:text-[#999]">
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </section>
  );
}
