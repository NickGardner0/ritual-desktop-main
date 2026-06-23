'use client';

import React, { startTransition, useEffect, useRef, useState } from 'react';
import { Calendar, Tag, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusIcon, PriorityIcon, NoPriorityIcon } from './kanban-icons';
import type { KanbanColumn, KanbanLabel, Priority } from '@/types/kanban';

interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
  columns: KanbanColumn[];
  labels: KanbanLabel[];
  defaultColumnId?: string;
  onSubmit: (data: {
    title: string;
    description: string;
    columnId: string;
    priority: Priority;
    dueDate?: string;
    labelIds: string[];
  }) => void;
}

export function NewTaskDialog({ open, onClose, columns, labels, defaultColumnId, onSubmit }: NewTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(defaultColumnId ?? columns[0]?.id ?? 'todo');
  const [priority, setPriority] = useState<Priority>(4);
  const [dueDate, setDueDate] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      startTransition(() => {
        setTitle('');
        setDescription('');
        setColumnId(defaultColumnId ?? columns[0]?.id ?? 'todo');
        setPriority(4);
        setDueDate('');
        setSelectedLabelIds([]);
        setActiveDropdown(null);
      });
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [open, defaultColumnId, columns]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { activeDropdown ? setActiveDropdown(null) : onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, activeDropdown, onClose]);

  useEffect(() => {
    if (!activeDropdown) return;
    const h = (e: MouseEvent) => { if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) setActiveDropdown(null); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [activeDropdown]);

  if (!open) return null;

  const handleSubmit = () => {
    const t = title.trim(); if (!t) return;
    onSubmit({ title: t, description: description.trim(), columnId, priority, dueDate: dueDate || undefined, labelIds: selectedLabelIds });
    onClose();
  };

  const currentColumn = columns.find((c) => c.id === columnId);
  const toggleLabel = (id: string) => setSelectedLabelIds((p) => p.includes(id) ? p.filter((l) => l !== id) : [...p, id]);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/15" onClick={() => { setActiveDropdown(null); onClose(); }} />

      <div ref={dialogRef}
        className="fixed left-1/2 top-[18%] z-50 w-full max-w-[600px] -translate-x-1/2 overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-2.5">
          <span className="text-[13px] font-medium text-[#1a1a1a]">New task</span>
          <button type="button" onClick={onClose} className="rounded p-1 text-[#ccc] hover:text-[#888]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 pt-4 pb-3">
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder="Issue title"
            className="w-full text-[15px] font-medium text-[#1a1a1a] outline-none placeholder:text-[#d5d5d5]" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description..." rows={3}
            className="mt-2 w-full resize-none text-[13px] leading-relaxed text-[#555] outline-none placeholder:text-[#d5d5d5]" />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between border-t border-[#f0f0f0] px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Status */}
            <div className="relative">
              <button type="button" onClick={() => setActiveDropdown(activeDropdown === 'status' ? null : 'status')}
                className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-[4px] text-[12px]',
                  activeDropdown === 'status' ? 'border-[#d5d5d5] bg-[#f5f5f5] text-[#1a1a1a]' : 'border-[#e5e5e5] text-[#999] hover:text-[#666]')}>
                <StatusIcon columnId={columnId} size={13} />
                {currentColumn?.title ?? 'Status'}
              </button>
              {activeDropdown === 'status' && (
                <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[150px] rounded-lg border border-[#e5e5e5] bg-white py-1 shadow-md">
                  {columns.map((col) => (
                    <button key={col.id} type="button"
                      onClick={() => { setColumnId(col.id); setActiveDropdown(null); }}
                      className={cn('ritual-snappy-row flex w-full items-center gap-2 px-3 py-1.5 text-[13px]',
                        columnId === col.id ? 'font-medium text-[#1a1a1a]' : 'text-[#888]')}>
                      <StatusIcon columnId={col.id} size={13} />
                      {col.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Priority */}
            <div className="relative">
              <button type="button" onClick={() => setActiveDropdown(activeDropdown === 'priority' ? null : 'priority')}
                className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-[4px] text-[12px]',
                  activeDropdown === 'priority' ? 'border-[#d5d5d5] bg-[#f5f5f5] text-[#1a1a1a]' : 'border-[#e5e5e5] text-[#999] hover:text-[#666]')}>
                {priority < 4 ? <PriorityIcon priority={priority} size={13} /> : <NoPriorityIcon size={13} />}
                Priority
              </button>
              {activeDropdown === 'priority' && (
                <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[140px] rounded-lg border border-[#e5e5e5] bg-white py-1 shadow-md">
                  {([1, 2, 3, 4] as Priority[]).map((p) => (
                    <button key={p} type="button"
                      onClick={() => { setPriority(p); setActiveDropdown(null); }}
                      className={cn('ritual-snappy-row flex w-full items-center gap-2 px-3 py-1.5 text-[13px]',
                        priority === p ? 'font-medium text-[#1a1a1a]' : 'text-[#888]')}>
                      {p < 4 ? <PriorityIcon priority={p} size={13} /> : <NoPriorityIcon size={13} />}
                      {p === 1 ? 'Urgent' : p === 2 ? 'High' : p === 3 ? 'Medium' : 'No priority'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Due date */}
            <label className={cn('flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-[4px] text-[12px]',
              dueDate ? 'border-[#d5d5d5] bg-[#f5f5f5] text-[#1a1a1a]' : 'border-[#e5e5e5] text-[#999] hover:text-[#666]')}>
              <Calendar className="h-3 w-3" />
              {dueDate ? new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Due date'}
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="invisible absolute h-0 w-0" />
            </label>

            {/* Labels */}
            {labels.length > 0 && (
              <div className="relative">
                <button type="button" onClick={() => setActiveDropdown(activeDropdown === 'labels' ? null : 'labels')}
                  className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-[4px] text-[12px]',
                    selectedLabelIds.length > 0 ? 'border-[#d5d5d5] bg-[#f5f5f5] text-[#1a1a1a]' : 'border-[#e5e5e5] text-[#999] hover:text-[#666]')}>
                  <Tag className="h-3 w-3" />
                  Labels
                </button>
                {activeDropdown === 'labels' && (
                  <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[170px] rounded-lg border border-[#e5e5e5] bg-white py-1 shadow-md">
                    {labels.map((label) => (
                      <button key={label.id} type="button" onClick={() => toggleLabel(label.id)}
                        className={cn('ritual-snappy-row flex w-full items-center gap-2 px-3 py-1.5 text-[13px]',
                          selectedLabelIds.includes(label.id) ? 'font-medium text-[#1a1a1a]' : 'text-[#888]')}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} />
                        {label.name}
                        {selectedLabelIds.includes(label.id) && <span className="ml-auto text-[#1a1a1a]">&#10003;</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button type="button" onClick={handleSubmit} disabled={!title.trim()}
            className="rounded-md bg-[#1a1a1a] px-3 py-[5px] text-[12px] font-medium text-white hover:bg-[#333] disabled:opacity-30">
            Create task
          </button>
        </div>
      </div>
    </>
  );
}
