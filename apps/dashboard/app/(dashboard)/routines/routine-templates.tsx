'use client';

import React, { useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';

import { describeSchedule } from '@/lib/routines/schedule-engine.mjs';
import { triggerConfigFromDraft } from '@/lib/routines/model';
import {
  ROUTINE_TEMPLATE_CATEGORIES,
  ROUTINE_TEMPLATES,
  templateScheduleDraft,
  type RoutineTemplate,
  type RoutineTemplateCategory,
} from '@/lib/routines/templates';
import { DataSourceIcons, RoutineIcon } from '@/lib/routines/ui';
import { FilterChip, subtleBorderClass } from '@/lib/tasks/reference-task-shell';
import { cn } from '@/lib/utils';

export function templateScheduleSummary(template: RoutineTemplate): string {
  const draft = templateScheduleDraft(template);
  return describeSchedule(draft.frequency, triggerConfigFromDraft(draft));
}

export function RoutinesEmptyHero({ onNewRoutine }: { onNewRoutine: () => void }) {
  return (
    <div className={cn('rounded-[10px] border border-dashed px-8 py-14 text-center', subtleBorderClass)}>
      <div className="mx-auto flex w-fit items-end gap-2" aria-hidden>
        <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-white/85 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <CalendarClock className="h-4 w-4 text-[#4b5563]" />
        </span>
        <span className="flex h-12 w-12 -translate-y-1 items-center justify-center rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-white/85 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <RoutineIcon name="sparkles" className="h-5 w-5 text-[#4b5563]" />
        </span>
        <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-white/85 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <RoutineIcon name="radar" className="h-4 w-4 text-[#4b5563]" />
        </span>
      </div>
      <h2 className="mt-6 text-[24px] font-[680] tracking-[-0.02em] text-[#10141d]">Put your data on a schedule</h2>
      <p className="mx-auto mt-2 max-w-[420px] text-[14px] leading-6 text-[#737b86]">
        Describe what you want Ritual to gather, pick a schedule, and get a report when it&rsquo;s ready.
      </p>
      <button
        type="button"
        onClick={onNewRoutine}
        className="mt-6 inline-flex h-9 items-center gap-2 rounded-sm bg-[#111827] px-3.5 text-[14px] font-[650] text-white transition hover:bg-[#202938]"
      >
        <Plus className="h-4 w-4" />
        New routine
      </button>
    </div>
  );
}

export function TemplateCard({
  template,
  onSetUp,
  installed,
}: {
  template: RoutineTemplate;
  onSetUp: (template: RoutineTemplate) => void;
  installed?: boolean;
}) {
  return (
    <div className={cn('flex flex-col rounded-[10px] border bg-white/70 p-5 transition hover:bg-white/95', subtleBorderClass)}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-[#f4f5f2]">
          <RoutineIcon name={template.icon} className="h-4 w-4 text-[#374151]" />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-[660] leading-snug text-[#1f242d]">{template.title}</div>
          <p className="mt-1 line-clamp-3 text-[13px] leading-5 text-[#737b86]">{template.description}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[rgba(15,23,42,0.05)] pt-3.5">
        <span className="flex min-w-0 items-center gap-3 text-[12px] font-[540] text-[#8a929c]">
          <DataSourceIcons sources={template.dataSources.slice(0, 4)} />
          <span className="truncate">{templateScheduleSummary(template)}</span>
        </span>
        <button
          type="button"
          onClick={() => onSetUp(template)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white px-2.5 text-[12px] font-[640] text-[#2f3743] transition hover:border-[rgba(15,23,42,0.22)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {installed ? 'Set up again' : 'Set up'}
        </button>
      </div>
    </div>
  );
}

export function TemplateLibrary({
  onSetUp,
  installedTemplateKeys,
  heading = 'Browse the library',
}: {
  onSetUp: (template: RoutineTemplate) => void;
  installedTemplateKeys?: Set<string>;
  heading?: string | null;
}) {
  const [category, setCategory] = useState<RoutineTemplateCategory>('suggested');
  const templates = ROUTINE_TEMPLATES.filter((template) => template.categories.includes(category));

  return (
    <section>
      {heading ? (
        <div className="text-[13px] font-[650] uppercase tracking-[0.12em] text-[#8a929c]">{heading}</div>
      ) : null}
      <div className={cn('mt-3 flex flex-wrap items-center gap-1 border-b pb-2', subtleBorderClass)}>
        {ROUTINE_TEMPLATE_CATEGORIES.map((item) => (
          <FilterChip key={item.id} active={category === item.id} onClick={() => setCategory(item.id)}>
            {item.label}
          </FilterChip>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSetUp={onSetUp}
            installed={installedTemplateKeys?.has(template.id)}
          />
        ))}
        {!templates.length ? (
          <div className="col-span-full px-2 py-10 text-center text-[14px] text-[#737b86]">
            No templates in this category yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}
