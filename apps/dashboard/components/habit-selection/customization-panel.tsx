'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CustomizationPanelProps = {
  selectedCategory: string | null;
  selectedHabit: any;
  customHabitName: string;
  setCustomHabitName: (v: string) => void;
  selectedMetric: string;
  setSelectedMetric: (v: string) => void;
  isMetricDropdownOpen: boolean;
  setIsMetricDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  metricDropdownRef: React.RefObject<HTMLDivElement | null>;
  metricBtnRef: React.RefObject<HTMLButtonElement | null>;
  metricStyle: React.CSSProperties;
  metricOptions: string[];
  isCreating: boolean;
  handleBack: () => void;
  handleCreateHabit: () => void;
};

const fieldRowClass =
  'flex min-h-[44px] items-center justify-between gap-4 border-b border-[rgba(39,37,30,0.06)] px-3.5 last:border-b-0';

const labelClass = 'shrink-0 text-[13px] font-normal text-[rgba(39,37,30,0.55)]';

const controlClass =
  'h-9 w-full min-w-0 rounded-md border border-[rgba(39,37,30,0.1)] bg-white px-2.5 text-[13.5px] font-normal tracking-[-0.01em] text-[#27251E] outline-none transition-colors placeholder:text-[rgba(39,37,30,0.35)] focus:border-[rgba(39,37,30,0.18)] focus:ring-1 focus:ring-gray-300';

export function CustomizationPanel(props: CustomizationPanelProps) {
  const {
    selectedCategory,
    selectedHabit,
    customHabitName,
    setCustomHabitName,
    selectedMetric,
    setSelectedMetric,
    isMetricDropdownOpen,
    setIsMetricDropdownOpen,
    metricDropdownRef,
    metricBtnRef,
    metricStyle,
    metricOptions,
    isCreating,
    handleBack,
    handleCreateHabit,
  } = props;

  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  const titleValue = selectedCategory === 'custom' ? customHabitName : (selectedHabit?.label || '');
  const canSubmit = !(isCreating || (selectedCategory === 'custom' && !customHabitName.trim()));
  const startDateLabel = `Today, ${new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return (
    <div className="flex h-full flex-col px-2 py-1">
      <div className="mb-3 px-1.5 pt-1">
        <h3 className="text-[18px] font-medium tracking-[-0.015em] text-[#27251E]">Configure</h3>
        <p className="mt-1 text-[12.5px] leading-4 text-[rgba(39,37,30,0.45)]">
          Choose how this habit should be tracked.
        </p>
      </div>

      <section className="overflow-hidden rounded-md bg-[#f8f8f7]">
        <div className={fieldRowClass}>
          <span className={labelClass}>Title</span>
          <div className="min-w-0 flex-1 max-w-[260px]">
            <input
              type="text"
              placeholder="Name"
              value={titleValue}
              onChange={(event) => {
                if (selectedCategory === 'custom') setCustomHabitName(event.target.value);
              }}
              readOnly={selectedCategory !== 'custom'}
              className={cn(
                controlClass,
                selectedCategory !== 'custom' && 'cursor-default bg-[#F3F3F3] text-[rgba(39,37,30,0.7)]',
              )}
            />
          </div>
        </div>

        <div className={fieldRowClass}>
          <span className={labelClass}>Metric</span>
          <div className="relative min-w-0 flex-1 max-w-[260px]" ref={metricDropdownRef}>
            <button
              ref={metricBtnRef}
              type="button"
              onClick={() => setIsMetricDropdownOpen((open) => !open)}
              className={cn(
                controlClass,
                'inline-flex items-center justify-between gap-2 hover:bg-[#F5F5F5]',
                isMetricDropdownOpen && 'border-[rgba(39,37,30,0.18)] bg-[#F5F5F5]',
              )}
            >
              <span className="truncate">{selectedMetric}</span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-[rgba(39,37,30,0.4)] transition-transform',
                  isMetricDropdownOpen && 'rotate-180',
                )}
              />
            </button>

            {isMetricDropdownOpen && portalTarget
              ? createPortal(
                  <div
                    style={metricStyle}
                    data-metric-dropdown
                    className="overflow-hidden p-1"
                  >
                    {metricOptions.map((metric) => {
                      const active = selectedMetric === metric;
                      return (
                        <button
                          key={metric}
                          type="button"
                          onClick={() => {
                            setSelectedMetric(metric);
                            setIsMetricDropdownOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] font-normal tracking-[-0.01em] outline-none transition-colors',
                            active
                              ? 'bg-[#F3F3F3] text-[#27251E]'
                              : 'text-[#27251E] hover:bg-[#F3F3F3]',
                          )}
                        >
                          {metric}
                        </button>
                      );
                    })}
                  </div>,
                  portalTarget,
                )
              : null}
          </div>
        </div>

        <div className={fieldRowClass}>
          <span className={labelClass}>Start date</span>
          <div className="min-w-0 flex-1 max-w-[260px]">
            <div
              className={cn(
                controlClass,
                'inline-flex cursor-default items-center gap-2 bg-[#F3F3F3] text-[rgba(39,37,30,0.7)]',
              )}
            >
              <Calendar className="h-3.5 w-3.5 shrink-0 text-[rgba(39,37,30,0.4)]" />
              <span className="truncate">{startDateLabel}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-auto flex items-center justify-end gap-1.5 pt-5">
        <button
          type="button"
          onClick={handleBack}
          className="h-8 rounded-md px-2.5 text-[12.5px] font-normal text-[rgba(39,37,30,0.55)] transition-colors hover:bg-[#F3F3F3] hover:text-[#27251E]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreateHabit}
          disabled={!canSubmit}
          className="h-8 rounded-md border border-black bg-black px-3 text-[12.5px] font-normal text-white transition-colors hover:bg-[#3D3C38] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isCreating ? 'Starting…' : 'Start Tracking'}
        </button>
      </div>
    </div>
  );
}
