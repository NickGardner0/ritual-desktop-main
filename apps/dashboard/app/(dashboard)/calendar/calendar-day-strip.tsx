'use client';

import { memo, useMemo } from 'react';
import Image from 'next/image';
import { format, isSameDay, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import type { HabitLog } from './tracker-events';
import type { WeekScheduledItem } from './calendar-week-view';

type CalendarDayStripProps = {
  weekDays: Date[];
  logsByDate: Map<string, HabitLog[]>;
  scheduledItems: WeekScheduledItem[];
  selectedDate: string | null;
  onDayClick: (dateKey: string) => void;
};

type IntegrationKey = 'apple' | 'whoop' | 'oura' | 'fitbit' | 'garmin';

const INTEGRATION_LOGOS: Record<IntegrationKey, { src: string; alt: string }> = {
  apple: { src: '/images/apple-logo.svg', alt: 'Apple' },
  whoop: { src: '/images/whoop.svg', alt: 'Whoop' },
  oura: { src: '/images/oura.svg', alt: 'Oura' },
  fitbit: { src: '/images/fitbit.svg', alt: 'Fitbit' },
  garmin: { src: '/images/garmin.svg', alt: 'Garmin' },
};

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function normalizeIntegration(source?: string): IntegrationKey | null {
  if (!source) return null;
  const key = source.trim().toLowerCase();
  return key in INTEGRATION_LOGOS ? (key as IntegrationKey) : null;
}

type DayBadge =
  | { kind: 'logo'; integration: IntegrationKey }
  | { kind: 'emoji'; char: string };

function badgesForDay(logs: HabitLog[], maxBadges: number): DayBadge[] {
  const seen = new Set<string>();
  const badges: DayBadge[] = [];

  for (const log of logs) {
    if (badges.length >= maxBadges) break;

    const integration = normalizeIntegration(log.integration_source);
    if (integration) {
      const key = `i:${integration}`;
      if (!seen.has(key)) {
        seen.add(key);
        badges.push({ kind: 'logo', integration });
      }
      continue;
    }

    const icon = log.icon?.trim();
    if (icon && EMOJI_PATTERN.test(icon)) {
      const key = `e:${icon}`;
      if (!seen.has(key)) {
        seen.add(key);
        badges.push({ kind: 'emoji', char: icon });
      }
    }
  }

  return badges;
}

export const CalendarDayStrip = memo(function CalendarDayStrip({
  weekDays,
  logsByDate,
  scheduledItems,
  selectedDate,
  onDayClick,
}: CalendarDayStripProps) {
  const today = useMemo(() => startOfDay(new Date()), []);

  const scheduledByDay = useMemo(() => {
    const map = new Map<string, WeekScheduledItem[]>();
    scheduledItems.forEach((item) => {
      const list = map.get(item.day) || [];
      list.push(item);
      map.set(item.day, list);
    });
    return map;
  }, [scheduledItems]);

  const MAX_BADGES = 3;

  return (
    <div className="grid grid-cols-7 gap-2.5">
      {weekDays.map((day) => {
        const dayKey = format(day, 'yyyy-MM-dd');
        const dayLogs = logsByDate.get(dayKey) || [];
        const dayBlocks = scheduledByDay.get(dayKey) || [];
        const totalCount = dayLogs.length + dayBlocks.length;
        const badges = badgesForDay(dayLogs, MAX_BADGES);
        const isSelected = selectedDate === dayKey;
        const isCurrent = isSameDay(day, today);
        const isFuture = day > today;
        const isEmpty = totalCount === 0;
        const isFutureEmpty = isFuture && isEmpty;

        let countLabel: string;
        if (totalCount === 0) {
          countLabel = isFuture ? 'No events' : 'No logs';
        } else if (dayLogs.length > 0 && dayBlocks.length > 0) {
          countLabel = `${totalCount} items`;
        } else if (dayBlocks.length > 0) {
          countLabel = `${dayBlocks.length} ${dayBlocks.length === 1 ? 'event' : 'events'}`;
        } else {
          countLabel = `${dayLogs.length} ${dayLogs.length === 1 ? 'log' : 'logs'}`;
        }

        return (
          <button
            key={dayKey}
            type="button"
            onClick={() => onDayClick(dayKey)}
            aria-pressed={isSelected}
            aria-label={`${format(day, 'EEEE, MMMM d')} — ${countLabel}`}
            className={cn(
              'group relative flex h-[100px] flex-col justify-between rounded-md px-4 py-3.5 text-left transition-shadow duration-150',
              isSelected
                ? 'bg-[#EDE7DA] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_1px_rgba(39,37,30,0.07)]'
                : 'bg-white shadow-[0_0_0_1px_rgba(39,37,30,0.06)] hover:shadow-[0_0_0_1px_rgba(39,37,30,0.12)]',
            )}
          >
            <span
              className={cn(
                'text-[13px] font-normal leading-none',
                isFutureEmpty
                  ? 'text-[#C4C0B8]'
                  : isCurrent
                    ? 'text-[#27251E]'
                    : 'text-[#6B7280]',
              )}
            >
              {format(day, 'EEE')}
            </span>

            <div className="flex flex-col gap-2">
              <span
                className={cn(
                  'text-[22px] font-semibold leading-none tracking-tight',
                  isFutureEmpty ? 'text-[#C4C0B8]' : 'text-[#1F1D17]',
                )}
              >
                {format(day, 'MMM d')}
              </span>
              <div className="flex min-h-[20px] items-center gap-2">
                {badges.length > 0 && (
                  <div className="flex shrink-0 items-center -space-x-1.5">
                    {badges.map((badge, i) => (
                      <span
                        key={i}
                        className={cn(
                          'inline-flex h-[20px] w-[20px] items-center justify-center overflow-hidden rounded-full bg-white ring-2',
                          isSelected ? 'ring-[#EDE7DA]' : 'ring-white',
                          'shadow-[0_0_0_0.5px_rgba(39,37,30,0.10)]',
                        )}
                      >
                        {badge.kind === 'logo' ? (
                          <Image
                            src={INTEGRATION_LOGOS[badge.integration].src}
                            alt={INTEGRATION_LOGOS[badge.integration].alt}
                            width={14}
                            height={14}
                            className="h-[14px] w-[14px] object-contain"
                            unoptimized
                          />
                        ) : (
                          <span className="text-[12px] leading-none">{badge.char}</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                <span
                  className={cn(
                    'truncate text-[13px] font-normal',
                    isEmpty ? 'text-[#C4C0B8]' : 'text-[#6B7280]',
                  )}
                >
                  {countLabel}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
});
