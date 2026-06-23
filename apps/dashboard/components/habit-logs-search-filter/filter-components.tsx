'use client';

import React, { useMemo, useState } from 'react';
import { formatISO, parseISO } from 'date-fns';
import { Check } from 'lucide-react';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DATE_PRESET_OPTIONS } from './helpers';

export function SearchableList({
  items,
  placeholder,
  selectedValues,
  onToggle,
}: {
  items: Array<{
    id: string;
    label: string;
    color?: string;
    fillClass?: string;
    rawValues?: string[];
  }>;
  placeholder: string;
  selectedValues: string[] | null | undefined;
  onToggle: (item: {
    id: string;
    label: string;
    color?: string;
    fillClass?: string;
    rawValues?: string[];
  }) => void;
}) {
  const [query, setQuery] = useState('');

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const normalizedQuery = query.toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(normalizedQuery));
  }, [items, query]);

  return (
    <div className="w-[260px]">
      <div className="border-b border-black/10 p-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="h-8 rounded-none border-black/10 px-3 text-xs focus-visible:border-neutral-300 focus-visible:ring-0"
        />
      </div>
      <div className="max-h-[320px] overflow-y-auto p-1">
        {filteredItems.length > 0 ? (
          filteredItems.map((item) => {
            const checked = item.rawValues
              ? item.rawValues.some((value) => selectedValues?.includes(value))
              : selectedValues?.includes(item.id) || false;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-neutral-900 ritual-snappy-row',
                  checked && 'bg-[#F5F5F5]',
                )}
              >
                <span
                  className={cn('h-2.5 w-2.5 shrink-0 rounded-none', item.fillClass)}
                  style={item.color ? { backgroundColor: item.color } : undefined}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {checked ? <Check className="h-3.5 w-3.5 text-neutral-900" /> : null}
              </button>
            );
          })
        ) : (
          <div className="px-3 py-2 text-[13px] text-neutral-500">No results found.</div>
        )}
      </div>
    </div>
  );
}

export function FilterMenuItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="px-2 py-1.5 text-sm text-neutral-950 focus:bg-[#F5F5F5] data-[state=open]:bg-[#F5F5F5]">
          <Icon className="mr-2 h-4 w-4 stroke-[1.75] text-neutral-950" />
          <span>{label}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent
            sideOffset={14}
            alignOffset={-4}
            className="rounded-none border border-black/10 bg-white p-0 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
          >
            {children}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}

export function FilterCheckboxItem({
  checked,
  label,
  onCheckedChange,
  className,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: () => void;
  className?: string;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
      className={cn(
        'rounded-none py-2 pl-4 pr-10 text-[13px] text-neutral-900 focus:bg-[#F5F5F5]',
        className,
      )}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
}

export function InlineDateRangeFilter({
  start,
  end,
  onSelect,
}: {
  start: string | null | undefined;
  end: string | null | undefined;
  onSelect: (range: { start: string | null; end: string | null }) => void;
}) {
  return (
    <div className="flex w-fit max-w-[calc(100vw-120px)] flex-col bg-white">
      <div className="border-b border-black/10 p-3">
        <Select
          onValueChange={(value) => {
            const now = new Date();

            if (value === 'clear') {
              onSelect({ start: null, end: null });
              return;
            }

            if (value === 'today') {
              const today = formatISO(now, { representation: 'date' });
              onSelect({ start: today, end: today });
              return;
            }

            if (value === 'yesterday') {
              const yesterday = new Date(now);
              yesterday.setDate(yesterday.getDate() - 1);
              const day = formatISO(yesterday, { representation: 'date' });
              onSelect({ start: day, end: day });
              return;
            }

            const daysBack = value === '7d' ? 7 : value === '30d' ? 30 : 90;
            const from = new Date(now);
            from.setDate(from.getDate() - daysBack);

            onSelect({
              start: formatISO(from, { representation: 'date' }),
              end: formatISO(now, { representation: 'date' }),
            });
          }}
        >
          <SelectTrigger className="h-8 w-[240px] rounded-none border-black/10 text-xs focus:ring-0 focus:ring-offset-0">
            <SelectValue placeholder="Select preset" />
          </SelectTrigger>
          <SelectContent className="rounded-none border-black/10">
            {DATE_PRESET_OPTIONS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id} className="text-[13px]">
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Calendar
        mode="range"
        initialFocus
        numberOfMonths={2}
        toDate={new Date()}
        defaultMonth={start ? parseISO(start) : new Date()}
        selected={{
          from: start ? parseISO(start) : undefined,
          to: end ? parseISO(end) : undefined,
        }}
        onSelect={(range) => {
          if (!range) return;

          onSelect({
            start: range.from ? formatISO(range.from, { representation: 'date' }) : null,
            end: range.to ? formatISO(range.to, { representation: 'date' }) : null,
          });
        }}
        className="w-fit p-3"
        classNames={{
          months: 'flex flex-col gap-4 md:flex-row md:gap-5',
          month: 'w-[264px] space-y-3',
          caption: 'relative flex h-9 items-center justify-center px-9 pt-0',
          caption_label: 'text-sm font-medium text-neutral-950',
          nav: 'absolute inset-x-0 top-0 flex h-9 items-center justify-between',
          nav_button:
            'flex h-7 w-7 items-center justify-center rounded-none border border-black/10 bg-white p-0 opacity-100 hover:bg-[#F5F5F5]',
          nav_button_previous: 'absolute left-0 top-1',
          nav_button_next: 'absolute right-0 top-1',
          head_row: 'flex',
          head_cell: 'w-8 text-[0.8rem] font-normal text-[#7C7C7C]',
          row: 'mt-2 flex w-full',
          cell:
            'h-8 w-8 p-0 text-center text-sm [&:has([aria-selected].day-range-end)]:rounded-none [&:has([aria-selected].day-outside)]:bg-[#DCDCDC]/50 [&:has([aria-selected])]:bg-[#E7E7E7] first:[&:has([aria-selected])]:rounded-none last:[&:has([aria-selected])]:rounded-none',
          day: 'h-8 w-8 rounded-none p-0 text-sm font-normal text-neutral-950 hover:bg-[#F1F1F1] aria-selected:opacity-100',
          day_selected:
            'bg-[#DCDCDC] text-neutral-950 hover:bg-[#DCDCDC] hover:text-neutral-950 focus:bg-[#DCDCDC] focus:text-neutral-950',
          day_today: 'bg-transparent text-neutral-950',
          day_outside: 'text-[#B4B4B4] aria-selected:bg-[#DCDCDC]/50',
          day_disabled: 'text-[#D0D0D0]',
          day_range_middle: 'bg-[#E7E7E7] text-neutral-950',
        }}
      />
    </div>
  );
}
