'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  createChecklistItem,
  type TaskChecklistItem,
} from '@/lib/tasks/checklist';

function SortableChecklistRow({
  item,
  onToggle,
  onTitleChange,
  onKeyDown,
  onFocus,
  inputRef,
}: {
  item: TaskChecklistItem;
  onToggle: () => void;
  onTitleChange: (title: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  inputRef: (node: HTMLInputElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const [focused, setFocused] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? 'none',
      }}
      className={cn(
        'ritual-snappy-row group/check relative flex items-center gap-2 border-b border-[var(--border-subtle)] px-1 last:border-b-0',
        (focused || isDragging) && 'rounded-[var(--radius-row)] bg-[var(--row-hover)]',
        isDragging && 'z-10 shadow-[0_4px_14px_rgba(15,23,42,0.08)]',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-none',
          item.done
            ? 'border-[var(--ritual-focus-ring)] bg-[var(--ritual-focus-ring)] text-white'
            : 'border-[rgba(39,37,30,0.28)] bg-transparent text-transparent hover:border-[var(--ritual-focus-ring)]',
        )}
        aria-label={item.done ? `Mark “${item.title || 'item'}” incomplete` : `Complete “${item.title || 'item'}”`}
        aria-pressed={item.done}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </button>
      <input
        ref={inputRef}
        value={item.title}
        onChange={(event) => onTitleChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => setFocused(false)}
        placeholder="To-do"
        aria-label="Checklist item"
        className={cn(
          'h-8 min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]',
          item.done && 'text-[var(--text-muted)] line-through',
        )}
      />
      <button
        type="button"
        className={cn(
          'flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-row)] text-[var(--icon-muted)] opacity-0 hover:text-[var(--text-primary)] focus:opacity-100 active:cursor-grabbing group-hover/check:opacity-100 group-focus-within/check:opacity-100',
          (focused || isDragging) && 'opacity-100',
        )}
        aria-label="Reorder checklist item"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function TaskChecklistEditor({
  items,
  onChange,
  className,
}: {
  items: TaskChecklistItem[];
  onChange: (items: TaskChecklistItem[]) => void;
  className?: string;
}) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusIdRef = useRef<string | null>(null);
  const didMountFocus = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    const id = focusIdRef.current;
    if (id) {
      inputRefs.current[id]?.focus();
      focusIdRef.current = null;
      return;
    }
    if (!didMountFocus.current && items.length === 1 && items[0].title === '') {
      didMountFocus.current = true;
      inputRefs.current[items[0].id]?.focus();
    }
  }, [items]);

  const updateItem = (id: string, patch: Partial<TaskChecklistItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleKeyDown = (item: TaskChecklistItem, index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      if (!item.title.trim() && index === items.length - 1) return;
      const next = createChecklistItem();
      const copy = [...items];
      copy.splice(index + 1, 0, next);
      focusIdRef.current = next.id;
      onChange(copy);
      return;
    }

    if (event.key === 'Backspace' && item.title === '') {
      event.preventDefault();
      if (items.length === 1) return;
      const previous = items[index - 1] ?? items[index + 1];
      focusIdRef.current = previous?.id ?? null;
      onChange(items.filter((entry) => entry.id !== item.id));
      return;
    }

    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      inputRefs.current[items[index - 1].id]?.focus();
      return;
    }

    if (event.key === 'ArrowDown' && index < items.length - 1) {
      event.preventDefault();
      inputRefs.current[items[index + 1].id]?.focus();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(items, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className={cn('mt-1', className)}>
          {items.map((item, index) => (
            <SortableChecklistRow
              key={item.id}
              item={item}
              onToggle={() => updateItem(item.id, { done: !item.done })}
              onTitleChange={(title) => updateItem(item.id, { title })}
              onKeyDown={(event) => handleKeyDown(item, index, event)}
              onFocus={() => undefined}
              inputRef={(node) => {
                inputRefs.current[item.id] = node;
              }}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
