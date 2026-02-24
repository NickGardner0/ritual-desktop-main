'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { format, isToday, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatHour } from './utils';

const HOUR_HEIGHT = 28;
const TIME_COLUMN_WIDTH = 64;
const TOTAL_DAY_MINUTES = 24 * 60;
const MINUTES_PER_SLOT = 15;
const SLOT_HEIGHT = HOUR_HEIGHT / 4;
const MIN_BLOCK_MINUTES = 30;

function formatClockMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, TOTAL_DAY_MINUTES));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export type WeekScheduledItem = {
  id: string;
  title: string;
  notes?: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
};

export type WeekSelectionPayload = {
  day: Date;
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
};

export type WeekScheduledItemUpdate = {
  day: string;
  startMinutes: number;
  endMinutes: number;
};

type CalendarWeekViewProps = {
  weekDays: Date[];
  currentDate: Date;
  scheduledItems?: WeekScheduledItem[];
  onCreateSelection?: (selection: WeekSelectionPayload) => void;
  onItemClick?: (item: WeekScheduledItem) => void;
  onItemUpdate?: (item: WeekScheduledItem, update: WeekScheduledItemUpdate) => void;
};

// Static hours array (0-23)
const hours = Array.from({ length: 24 }, (_, i) => i);

type DaySelection = {
  startMinutes: number;
  endMinutes: number;
};

type DragSelection = {
  day: Date;
  dayKey: string;
  anchorHour: number;
  currentHour: number;
};

type ItemInteractionMode = 'move' | 'resize-start' | 'resize-end';

type ItemInteractionState = {
  itemId: string;
  mode: ItemInteractionMode;
  originDayIndex: number;
  originStartMinutes: number;
  originEndMinutes: number;
  pointerStartX: number;
  pointerStartY: number;
  previewDayIndex: number;
  previewDayKey: string;
  previewStartMinutes: number;
  previewEndMinutes: number;
  hasDragged: boolean;
};

// Day column component for performance
const DayColumn = memo(function DayColumn({
  day,
  dayIndex,
  isDayToday,
  isLastColumn,
  items,
  selection,
  columnRef,
  onHourMouseDown,
  onHourMouseEnter,
  onItemMouseDown,
  onItemResizeMouseDown,
  onItemClick,
}: {
  day: Date;
  dayIndex: number;
  isDayToday: boolean;
  isLastColumn: boolean;
  items: WeekScheduledItem[];
  selection: DaySelection | null;
  columnRef: (node: HTMLDivElement | null) => void;
  onHourMouseDown: (hour: number) => void;
  onHourMouseEnter: (hour: number) => void;
  onItemMouseDown: (
    item: WeekScheduledItem,
    dayIndex: number,
    event: ReactMouseEvent<HTMLDivElement>
  ) => void;
  onItemResizeMouseDown: (
    item: WeekScheduledItem,
    dayIndex: number,
    edge: 'start' | 'end',
    event: ReactMouseEvent<HTMLDivElement>
  ) => void;
  onItemClick?: (item: WeekScheduledItem) => void;
}) {
  const selectionTop = selection ? (selection.startMinutes / 60) * HOUR_HEIGHT : 0;
  const selectionHeight = selection
    ? Math.max(((selection.endMinutes - selection.startMinutes) / 60) * HOUR_HEIGHT, HOUR_HEIGHT)
    : 0;

  return (
    <div
      ref={columnRef}
      className={cn(
        'relative bg-white border-r border-gray-300',
        isLastColumn && 'border-r-0',
        isDayToday && 'bg-[#FCFCFC]'
      )}
    >
      {/* Hour grid lines */}
      {hours.map((hour) => (
        <div
          key={`${day.toISOString()}-${hour}`}
          className={cn(
            'relative group cursor-pointer border-b border-gray-300 transition-colors',
            isDayToday ? 'hover:bg-[#F4F4F4]' : 'hover:bg-[#F8F8F8]'
          )}
          style={{ height: `${HOUR_HEIGHT}px` }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onHourMouseDown(hour);
          }}
          onMouseEnter={() => onHourMouseEnter(hour)}
        >
          {/* Hour hover indicator */}
          <div className="pointer-events-none absolute inset-0 bg-black/[0.02] opacity-0 group-hover:opacity-100" />
        </div>
      ))}

      {selection && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border border-[rgba(17,24,39,0.22)] bg-[rgba(17,24,39,0.12)]"
          style={{
            top: `${selectionTop}px`,
            height: `${selectionHeight}px`,
          }}
        />
      )}

      {items.map((item) => {
        const safeStart = Math.max(0, Math.min(item.startMinutes, TOTAL_DAY_MINUTES));
        const safeEnd = Math.max(safeStart + 30, Math.min(item.endMinutes, TOTAL_DAY_MINUTES));
        const top = (safeStart / 60) * HOUR_HEIGHT;
        const height = Math.max(((safeEnd - safeStart) / 60) * HOUR_HEIGHT, 22);

        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={`Edit ${item.title}`}
            onMouseDown={(event) => onItemMouseDown(item, dayIndex, event)}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && onItemClick) {
                event.preventDefault();
                onItemClick(item);
              }
            }}
            className="group absolute inset-x-0 z-20 box-border overflow-hidden border border-[#111827]/20 bg-[#111827] px-2 py-1 text-left text-[11px] text-white shadow-sm cursor-move select-none"
            style={{
              top: `${top}px`,
              height: `${height}px`,
            }}
          >
            <div className="pointer-events-none">
              <p className="truncate font-medium">{item.title}</p>
              <p className="truncate text-[10px] text-white/70">
                {formatClockMinutes(safeStart)} - {formatClockMinutes(safeEnd)}
              </p>
            </div>

            <div
              className="absolute inset-x-0 top-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
              onMouseDown={(event) => onItemResizeMouseDown(item, dayIndex, 'start', event)}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
              onMouseDown={(event) => onItemResizeMouseDown(item, dayIndex, 'end', event)}
            />
          </div>
        );
      })}
    </div>
  );
});

export const CalendarWeekView = memo(function CalendarWeekView({
  weekDays,
  currentDate,
  scheduledItems = [],
  onCreateSelection,
  onItemClick,
  onItemUpdate,
}: CalendarWeekViewProps) {
  const columnTemplate = `${TIME_COLUMN_WIDTH}px repeat(7, minmax(0, 1fr))`;
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  const [itemInteraction, setItemInteraction] = useState<ItemInteractionState | null>(null);
  const dayColumnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const itemInteractionRef = useRef<ItemInteractionState | null>(null);

  const renderedScheduledItems = useMemo(() => {
    if (!itemInteraction) return scheduledItems;

    return scheduledItems.map((item) => {
      if (item.id !== itemInteraction.itemId) return item;
      return {
        ...item,
        day: itemInteraction.previewDayKey,
        startMinutes: itemInteraction.previewStartMinutes,
        endMinutes: itemInteraction.previewEndMinutes,
      };
    });
  }, [scheduledItems, itemInteraction]);

  const scheduledItemsByDay = useMemo(() => {
    const grouped = new Map<string, WeekScheduledItem[]>();

    for (const item of renderedScheduledItems) {
      const existing = grouped.get(item.day) ?? [];
      existing.push(item);
      grouped.set(item.day, existing);
    }

    for (const [day, items] of grouped.entries()) {
      items.sort((a, b) => a.startMinutes - b.startMinutes);
      grouped.set(day, items);
    }

    return grouped;
  }, [renderedScheduledItems]);

  const selectionPreview = useMemo(() => {
    if (!dragSelection) return null;
    const startHour = Math.min(dragSelection.anchorHour, dragSelection.currentHour);
    const endHour = Math.max(dragSelection.anchorHour, dragSelection.currentHour) + 1;

    return {
      day: dragSelection.day,
      dayKey: dragSelection.dayKey,
      startMinutes: startHour * 60,
      endMinutes: endHour * 60,
    };
  }, [dragSelection]);

  const finalizeSelection = useCallback(() => {
    if (selectionPreview && onCreateSelection) {
      onCreateSelection(selectionPreview);
    }
    setDragSelection(null);
  }, [onCreateSelection, selectionPreview]);

  const getClosestDayIndex = useCallback(
    (clientX: number): number => {
      const maxIndex = Math.max(weekDays.length - 1, 0);
      if (maxIndex === 0) return 0;

      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (let index = 0; index <= maxIndex; index += 1) {
        const node = dayColumnRefs.current[index];
        if (!node) continue;

        const rect = node.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) {
          return index;
        }

        const distance = clientX < rect.left ? rect.left - clientX : clientX - rect.right;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }

      return nearestIndex;
    },
    [weekDays.length]
  );

  const beginItemInteraction = useCallback(
    (
      item: WeekScheduledItem,
      dayIndex: number,
      mode: ItemInteractionMode,
      event: ReactMouseEvent<HTMLDivElement>
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const boundedDayIndex = Math.max(0, Math.min(dayIndex, weekDays.length - 1));
      const day = weekDays[boundedDayIndex];
      if (!day) return;

      const interaction: ItemInteractionState = {
        itemId: item.id,
        mode,
        originDayIndex: boundedDayIndex,
        originStartMinutes: item.startMinutes,
        originEndMinutes: item.endMinutes,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        previewDayIndex: boundedDayIndex,
        previewDayKey: format(day, 'yyyy-MM-dd'),
        previewStartMinutes: item.startMinutes,
        previewEndMinutes: item.endMinutes,
        hasDragged: false,
      };

      itemInteractionRef.current = interaction;
      setItemInteraction(interaction);
    },
    [weekDays]
  );

  const updateItemInteractionPreview = useCallback(
    (clientX: number, clientY: number) => {
      const current = itemInteractionRef.current;
      if (!current) return;

      const deltaSlots = Math.round((clientY - current.pointerStartY) / SLOT_HEIGHT);
      const deltaMinutes = deltaSlots * MINUTES_PER_SLOT;

      let nextDayIndex = current.originDayIndex;
      let nextStartMinutes = current.originStartMinutes;
      let nextEndMinutes = current.originEndMinutes;

      if (current.mode === 'move') {
        nextDayIndex = getClosestDayIndex(clientX);

        const duration = current.originEndMinutes - current.originStartMinutes;
        const maxStart = Math.max(TOTAL_DAY_MINUTES - duration, 0);
        nextStartMinutes = Math.max(
          0,
          Math.min(current.originStartMinutes + deltaMinutes, maxStart)
        );
        nextEndMinutes = nextStartMinutes + duration;
      } else if (current.mode === 'resize-start') {
        const maxStart = current.originEndMinutes - MIN_BLOCK_MINUTES;
        nextStartMinutes = Math.max(
          0,
          Math.min(current.originStartMinutes + deltaMinutes, maxStart)
        );
      } else {
        const minEnd = current.originStartMinutes + MIN_BLOCK_MINUTES;
        nextEndMinutes = Math.max(
          minEnd,
          Math.min(current.originEndMinutes + deltaMinutes, TOTAL_DAY_MINUTES)
        );
      }

      const day = weekDays[nextDayIndex];
      if (!day) return;

      const hasMoved =
        nextDayIndex !== current.originDayIndex ||
        nextStartMinutes !== current.originStartMinutes ||
        nextEndMinutes !== current.originEndMinutes;

      const nextInteraction: ItemInteractionState = {
        ...current,
        previewDayIndex: nextDayIndex,
        previewDayKey: format(day, 'yyyy-MM-dd'),
        previewStartMinutes: nextStartMinutes,
        previewEndMinutes: nextEndMinutes,
        hasDragged: current.hasDragged || hasMoved,
      };

      const didPreviewChange =
        nextInteraction.previewDayKey !== current.previewDayKey ||
        nextInteraction.previewStartMinutes !== current.previewStartMinutes ||
        nextInteraction.previewEndMinutes !== current.previewEndMinutes ||
        nextInteraction.hasDragged !== current.hasDragged;

      if (!didPreviewChange) return;

      itemInteractionRef.current = nextInteraction;
      setItemInteraction(nextInteraction);
    },
    [getClosestDayIndex, weekDays]
  );

  const clearItemInteraction = useCallback(() => {
    itemInteractionRef.current = null;
    setItemInteraction(null);
  }, []);

  const finalizeItemInteraction = useCallback(() => {
    const current = itemInteractionRef.current;
    if (!current) return;

    const originalItem = scheduledItems.find((item) => item.id === current.itemId);
    if (!originalItem) {
      clearItemInteraction();
      return;
    }

    const hasTimeChanged =
      current.previewDayKey !== originalItem.day ||
      current.previewStartMinutes !== originalItem.startMinutes ||
      current.previewEndMinutes !== originalItem.endMinutes;

    if (hasTimeChanged && onItemUpdate) {
      onItemUpdate(originalItem, {
        day: current.previewDayKey,
        startMinutes: current.previewStartMinutes,
        endMinutes: current.previewEndMinutes,
      });
    } else if (current.mode === 'move' && !current.hasDragged) {
      onItemClick?.(originalItem);
    }

    clearItemInteraction();
  }, [clearItemInteraction, onItemClick, onItemUpdate, scheduledItems]);

  useEffect(() => {
    if (!dragSelection) return;

    const handleWindowMouseUp = () => {
      finalizeSelection();
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragSelection, finalizeSelection]);

  useEffect(() => {
    if (!itemInteraction) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      updateItemInteractionPreview(event.clientX, event.clientY);
    };

    const handleWindowMouseUp = () => {
      finalizeItemInteraction();
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [finalizeItemInteraction, itemInteraction, updateItemInteractionPreview]);

  const startHourSelection = useCallback((day: Date, dayKey: string, hour: number) => {
    if (itemInteractionRef.current) return;

    setDragSelection({
      day,
      dayKey,
      anchorHour: hour,
      currentHour: hour,
    });
  }, []);

  const updateHourSelection = useCallback((dayKey: string, hour: number) => {
    setDragSelection((prev) => {
      if (itemInteractionRef.current) return prev;
      if (!prev || prev.dayKey !== dayKey || prev.currentHour === hour) {
        return prev;
      }
      return {
        ...prev,
        currentHour: hour,
      };
    });
  }, []);

  return (
    <div className="flex flex-col border border-gray-300 bg-white">
      {/* Day headers */}
      <div
        className="grid border-b border-gray-300"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        {/* Empty space above time column */}
        <div className="h-14 border-r border-gray-300 bg-white" />

        {/* Day headers - name and date on same row */}
        {weekDays.map((day, index) => {
          const isDayToday = isToday(day);
          const isCurrentMonth = isSameMonth(day, currentDate);

          return (
            <div
              key={day.toString()}
              className={cn(
                'h-14 px-2 bg-white border-r border-gray-300',
                index === weekDays.length - 1 && 'border-r-0',
                isDayToday && 'bg-[#FCFCFC]'
              )}
            >
              <div className="flex h-full items-center justify-center gap-2 text-[13px]">
                <span className="uppercase tracking-[0.02em] text-[#7A7A7A] font-medium">
                  {format(day, 'EEE')}
                </span>
                <span
                  className={cn(
                    'text-[#1A1A1A] font-medium',
                    isDayToday && 'font-semibold'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {!isCurrentMonth && (
                  <span className="text-[10px] uppercase text-[#A0A0A0]">
                    {format(day, 'MMM')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        className="grid flex-1 overflow-y-auto"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        {/* Time labels column */}
        <div className="bg-white border-r border-gray-300">
          {hours.map((hour) => (
            <div
              key={hour}
              className="flex items-center border-b border-gray-300 pl-3 text-[12px] tabular-nums text-[#8A8A8A]"
              style={{ height: `${HOUR_HEIGHT}px` }}
            >
              {formatHour(hour, 24)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day, index) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const isDayToday = isToday(day);
          const dayItems = scheduledItemsByDay.get(dateKey) ?? [];
          const daySelection =
            selectionPreview && selectionPreview.dayKey === dateKey
              ? {
                  startMinutes: selectionPreview.startMinutes,
                  endMinutes: selectionPreview.endMinutes,
                }
              : null;

          return (
            <DayColumn
              key={dateKey}
              day={day}
              dayIndex={index}
              isDayToday={isDayToday}
              isLastColumn={index === weekDays.length - 1}
              items={dayItems}
              selection={daySelection}
              columnRef={(node) => {
                dayColumnRefs.current[index] = node;
              }}
              onHourMouseDown={(hour) => startHourSelection(day, dateKey, hour)}
              onHourMouseEnter={(hour) => updateHourSelection(dateKey, hour)}
              onItemMouseDown={(item, dayIndex, event) =>
                beginItemInteraction(item, dayIndex, 'move', event)
              }
              onItemResizeMouseDown={(item, dayIndex, edge, event) =>
                beginItemInteraction(
                  item,
                  dayIndex,
                  edge === 'start' ? 'resize-start' : 'resize-end',
                  event
                )
              }
              onItemClick={onItemClick}
            />
          );
        })}
      </div>
    </div>
  );
});
