'use client';

import React from 'react';
import {
  format, parseISO, isToday, isYesterday, isTomorrow, differenceInDays,
  formatDistanceToNow, eachDayOfInterval,
} from 'date-fns';
import {
  aggregateTooltipMetrics,
  formatDurationDisplay,
  formatTooltipMetricName,
  formatTooltipMetricValue,
} from './calendar-client.helpers';
import type { HabitLog } from './tracker-events';
import type { ProjectTimeSessionRow } from './calendar-client.helpers';

type ProjectSession = ProjectTimeSessionRow;

export type CalendarDayPanelsProps = {
  hoveredDate: Date | null;
  hoveredData: HabitLog[];
  selectedDate: string | null;
  setSelectedDate: (v: string | null) => void;
  selectedDayPanelRef: React.RefObject<HTMLDivElement | null>;
  logsByDate: Map<string, HabitLog[]>;
  selectedProjectSessions: ProjectSession[];
  aiSummary: string;
  aiSummaryLoading: boolean;
  validRange: [string, string] | null;
  setRange: (v: [string, string] | null) => void;
};

export function CalendarDayPanels(props: CalendarDayPanelsProps) {
  const {
    hoveredDate, hoveredData, selectedDate, setSelectedDate, selectedDayPanelRef,
    logsByDate, selectedProjectSessions, aiSummary, aiSummaryLoading, validRange, setRange,
  } = props;

  return (
    <>
          {/* Hover panel - like Lumen (shows below calendar on left) */}
          {hoveredDate && !selectedDate && !validRange && (
            <div className="mt-4">
              <div className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] min-h-[180px]">
                <p className="font-medium text-foreground font-mono text-lg">
                  {format(hoveredDate, 'EEE, MMM d')}
                </p>
                <p className="text-sm text-[#878787] mt-1">
                  {formatDistanceToNow(hoveredDate, { addSuffix: true })}
                </p>
                {hoveredData.length > 0 ? (
                  <div className="mt-4 space-y-1">
                    {(() => {
                      const totalDur = hoveredData.reduce((acc, log) => acc + (log.duration || 0), 0);
                      const hrs = Math.floor(totalDur / 3600);
                      const mins = Math.floor((totalDur % 3600) / 60);
                      return (
                        <>
                          {totalDur > 0 && (
                            <p className="text-sm text-[#878787]">
                              {hrs > 0 ? `${hrs}h ` : ''}{mins}m tracked
                            </p>
                          )}
                          <p className="text-sm text-[#878787]">
                            {hoveredData.length} {hoveredData.length === 1 ? 'entry' : 'entries'}
                          </p>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-[#878787] mt-4 font-mono">
                    Empty note
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Selected day panel */}
          {selectedDate && (
            <div ref={selectedDayPanelRef} className="mt-4 flex items-start gap-3">
              {/* Metrics tooltip — left side */}
              <div
                className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] shrink-0"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-foreground font-mono text-lg">
                    {format(parseISO(selectedDate), 'EEE, MMM d')}
                  </p>
                  <button
                    onClick={() => setSelectedDate(null)}
                    aria-label="Close tooltip"
                    className="rounded-sm text-lg leading-none text-[#878787] transition-colors hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
                <p className="text-sm text-[#878787]">
                  {(() => {
                    const date = parseISO(selectedDate);
                    if (isToday(date)) return 'Today';
                    if (isYesterday(date)) return 'Yesterday';
                    if (isTomorrow(date)) return 'Tomorrow';
                    const daysDiff = differenceInDays(new Date(), date);
                    if (daysDiff > 0 && daysDiff <= 7) return `${daysDiff} days ago`;
                    if (daysDiff < 0 && daysDiff >= -7) return `In ${Math.abs(daysDiff)} days`;
                    return formatDistanceToNow(date, { addSuffix: true });
                  })()}
                </p>

                {(() => {
                  const dayLogs = logsByDate.get(selectedDate) || [];
                  const dayMetrics = aggregateTooltipMetrics(dayLogs);

                  if (dayMetrics.length === 0) {
                    return (
                      <p className="text-sm text-[#878787] mt-4 font-mono">
                        Empty note
                      </p>
                    );
                  }

                  return (
                    <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
                      {dayMetrics.map((metric) => (
                        <div
                          key={metric.key}
                          className="flex items-center justify-between text-sm transition-colors duration-150 hover:text-[#27251E] cursor-default group"
                        >
                          <span className="font-medium">{formatTooltipMetricName(metric)}</span>
                          <span className="text-[#878787] group-hover:text-[#27251E] transition-colors duration-150">
                            {formatTooltipMetricValue(metric)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Daily Summary panel — right side, fills remaining space */}
              <div className="relative border border-gray-300 dark:border-gray-700 bg-white p-5 flex-1 max-h-[320px] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[rgba(39,37,30,0.35)]">
                    Daily Summary
                  </p>
                  <button
                    onClick={() => setSelectedDate(null)}
                    aria-label="Close summary"
                    className="rounded-sm text-lg leading-none text-[#878787] transition-colors hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
                {selectedProjectSessions.length > 0 && (
                  <div className="mb-4 space-y-2 border-b border-[rgba(39,37,30,0.10)] pb-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[rgba(39,37,30,0.35)]">
                      Workstreams
                    </p>
                    {selectedProjectSessions.slice(0, 6).map((session) => {
                      const started = session.start_ts ? new Date(session.start_ts) : null;
                      const ended = session.end_ts ? new Date(session.end_ts) : null;
                      const timeRange = started && ended && !Number.isNaN(started.getTime()) && !Number.isNaN(ended.getTime())
                        ? `${started.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${ended.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                        : 'Unknown time';
                      const apps = Array.isArray(session.apps)
                        ? session.apps.slice(0, 2).map((item: { name?: string }) => item.name).filter(Boolean).join(', ')
                        : '';
                      return (
                        <div key={session.session_uid} className="text-[12px] leading-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-[#27251E]">
                                {session.project_name || 'Unclassified'} / {session.task_name || 'General'}
                              </p>
                              <p className="text-[#878787]">{timeRange}{apps ? ` · ${apps}` : ''}</p>
                            </div>
                            <span className="shrink-0 text-[#878787]">
                              {formatDurationDisplay(Math.round(Number(session.active_ms || 0) / 1000))}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {aiSummaryLoading ? (
                  <p className="text-[13px] text-[rgba(39,37,30,0.35)] animate-pulse">
                    {aiSummary || 'Thinking...'}
                  </p>
                ) : aiSummary ? (
                  <div className="text-[13px] leading-[1.6] tracking-[-0.1px] text-[#27251E] space-y-2">
                    {aiSummary.split('\n').filter(Boolean).map((line, i) => {
                      // Parse inline markdown: **bold**, *italic*, `code`
                      const parseInline = (text: string) => {
                        const tokens = text.split(/(\*\*.*?\*\*|\*.*?\*|`[^`]+`)/g);
                        return tokens.map((tok, j) => {
                          if (tok.startsWith('**') && tok.endsWith('**')) {
                            return <strong key={j} className="font-semibold text-[#27251E]">{tok.slice(2, -2)}</strong>;
                          }
                          if (tok.startsWith('*') && tok.endsWith('*') && !tok.startsWith('**')) {
                            return <em key={j} className="text-[11px] not-italic text-[#878787] tracking-wide block -mt-1 mb-0.5">{tok.slice(1, -1)}</em>;
                          }
                          if (tok.startsWith('`') && tok.endsWith('`')) {
                            return <code key={j} className="px-1 py-0.5 rounded bg-[#f0ede8] text-[#535353] font-mono text-[12px]">{tok.slice(1, -1)}</code>;
                          }
                          return <span key={j}>{tok}</span>;
                        });
                      };
                      return <p key={i}>{parseInline(line)}</p>;
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Range selection panel */}
          {validRange && (
            <div className="mt-4">
              <div className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] min-h-[180px]">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-foreground font-mono text-lg">
                    {format(new Date(validRange[0]), 'MMM d')} - {format(new Date(validRange[1]), 'MMM d')}
                  </p>
                  <button
                    onClick={() => setRange(null)}
                    className="rounded-sm text-xs text-[#878787] transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-sm text-[#878787]">
                  {format(new Date(validRange[0]), 'yyyy')}
                </p>

                {(() => {
                  let totalRangeDuration = 0;
                  let totalRangeLogs = 0;

                  const startDate = new Date(validRange[0]);
                  const endDate = new Date(validRange[1]);
                  const daysInRange = eachDayOfInterval({
                    start: startDate,
                    end: endDate,
                  });

                  daysInRange.forEach((day) => {
                    const dateKey = format(day, 'yyyy-MM-dd');
                    const dayLogs = logsByDate.get(dateKey) || [];
                    totalRangeLogs += dayLogs.length;
                    dayLogs.forEach((log) => {
                      totalRangeDuration += log.duration || 0;
                    });
                  });

                  const hours = Math.floor(totalRangeDuration / 3600);
                  const minutes = Math.floor((totalRangeDuration % 3600) / 60);

                  return (
                    <div className="mt-4 space-y-1">
                      <p className="text-sm text-[#878787]">
                        {hours}h {minutes}m tracked
                      </p>
                      <p className="text-sm text-[#878787]">
                        {totalRangeLogs} {totalRangeLogs === 1 ? 'entry' : 'entries'} over {daysInRange.length} days
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
    </>
  );
}
