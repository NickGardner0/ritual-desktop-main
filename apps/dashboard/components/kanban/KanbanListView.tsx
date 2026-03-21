'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusIcon, PriorityIcon, NoPriorityIcon } from './kanban-icons';
import type { KanbanCard, KanbanColumn, KanbanLabel } from '@/types/kanban';

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface KanbanListViewProps {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  labels: KanbanLabel[];
  onToggleComplete: (cardId: string) => void;
  onCardClick: (card: KanbanCard) => void;
  onAddCard: (columnId: string, data: { title: string }) => void;
  onOpenNewTask?: () => void;
}

export function KanbanListView({
  columns, cards, labels,
  onToggleComplete, onCardClick, onAddCard, onOpenNewTask,
}: KanbanListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const groups = useMemo(() =>
    columns.map((col) => ({
      column: col,
      cards: cards.filter((c) => c.columnId === col.id).sort((a, b) => a.order - b.order),
    })),
    [columns, cards]
  );

  const visible = useMemo(() => groups.filter((g) => g.cards.length > 0), [groups]);
  const hidden = useMemo(() => groups.filter((g) => g.cards.length === 0), [groups]);
  const [showHidden, setShowHidden] = useState(false);

  const toggle = (id: string) => setCollapsed((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const submitAdd = (colId: string) => {
    const t = newTitle.trim();
    if (!t) return;
    onAddCard(colId, { title: t });
    setNewTitle('');
    setAddingIn(null);
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        {visible.map(({ column, cards: colCards }) => {
          const isCollapsed = collapsed.has(column.id);
          return (
            <div key={column.id}>
              {/* Group header */}
              <div className="flex items-center border-b border-[#f0f0f0] bg-[#fafafa] px-5 group">
                <button type="button" onClick={() => toggle(column.id)}
                  className="flex flex-1 items-center gap-2 py-[7px] text-left">
                  {isCollapsed
                    ? <ChevronRight className="h-3.5 w-3.5 text-[#ccc]" />
                    : <ChevronDown className="h-3.5 w-3.5 text-[#ccc]" />}
                  <StatusIcon columnId={column.id} size={15} />
                  <span className="text-[13px] font-medium text-[#1a1a1a]">{column.title}</span>
                  <span className="text-[12px] tabular-nums text-[#bbb]">{colCards.length}</span>
                </button>
                <button type="button"
                  onClick={() => onOpenNewTask ? onOpenNewTask() : (() => { setAddingIn(column.id); setNewTitle(''); })()}
                  className="rounded p-1 text-[#ccc] opacity-0 transition-opacity hover:text-[#999] group-hover:opacity-100">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Rows */}
              {!isCollapsed && colCards.map((card) => (
                <button key={card.id} type="button"
                  onClick={() => onCardClick(card)}
                  className="group/row flex w-full items-center gap-3 border-b border-[#f5f5f5] px-5 py-[7px] text-left transition-colors hover:bg-[#fafafa]">
                  <NoPriorityIcon size={14} className="shrink-0" />
                  <StatusIcon columnId={card.columnId} size={14} className="shrink-0" />
                  <span className={cn(
                    'min-w-0 flex-1 truncate text-[13px] text-[#1a1a1a]',
                    card.columnId === 'complete' && 'text-[#bbb] line-through'
                  )}>
                    {card.title}
                  </span>
                  {formatDate(card.createdAt) && (
                    <span className="shrink-0 text-[11px] tabular-nums text-[#ccc]">
                      {formatDate(card.createdAt)}
                    </span>
                  )}
                </button>
              ))}

              {/* Inline add */}
              {!isCollapsed && addingIn === column.id && (
                <div className="flex items-center gap-3 border-b border-[#f5f5f5] px-5 py-[7px]">
                  <NoPriorityIcon size={14} />
                  <StatusIcon columnId={column.id} size={14} />
                  <input autoFocus value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); submitAdd(column.id); }
                      if (e.key === 'Escape') { setNewTitle(''); setAddingIn(null); }
                    }}
                    onBlur={() => { if (!newTitle.trim()) setAddingIn(null); }}
                    placeholder="Task title"
                    className="flex-1 text-[13px] text-[#1a1a1a] outline-none placeholder:text-[#ccc]"
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Hidden (empty) columns */}
        {hidden.length > 0 && (
          <div className="px-5 pt-4 pb-2">
            <button type="button" onClick={() => setShowHidden(!showHidden)}
              className="flex items-center gap-1.5 text-[13px] text-[#bbb] hover:text-[#999]">
              {showHidden ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Hidden columns
            </button>
            {showHidden && (
              <div className="mt-2 space-y-1">
                {hidden.map(({ column }) => (
                  <div key={column.id} className="flex items-center gap-2.5 rounded-md border border-[#f0f0f0] px-4 py-2">
                    <StatusIcon columnId={column.id} size={15} />
                    <span className="flex-1 text-[13px] font-medium text-[#1a1a1a]">{column.title}</span>
                    <span className="text-[12px] tabular-nums text-[#ccc]">0</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
