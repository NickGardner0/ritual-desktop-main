'use client';

import React, { useState } from 'react';
import { CalendarDays, Clock, Plus, Sparkles } from 'lucide-react';

import {
  ROUTINE_TEMPLATE_CATEGORIES,
  ROUTINE_TEMPLATES,
  type RoutineTemplate,
  type RoutineTemplateCategory,
} from '@/lib/routines/templates';
import { RoutineIcon } from '@/lib/routines/ui';
import { cn } from '@/lib/utils';

export function templateScheduleSummary(template: RoutineTemplate): string {
  return template.scheduleLabel;
}

export function RoutinesEmptyHero({ onNewRoutine }: { onNewRoutine: () => void }) {
  return (
    <div className="rounded-[14px] border border-dashed border-[#e7dfd0] bg-[#fffefa] px-6 py-[72px] text-center shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
      <div className="mx-auto flex h-14 w-[148px] items-center justify-center" aria-hidden>
        <span className="-mr-1 flex h-10 w-10 -rotate-3 items-center justify-center rounded-[8px] border border-[#e4dccd] bg-[#fbfaf6] text-[#7d8188] shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
          <Clock className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
        <span className="z-10 flex h-12 w-12 items-center justify-center rounded-[9px] border border-[#dfd5c3] bg-[#f8f6ef] text-[#6d737c] shadow-[0_1px_2px_rgba(15,23,42,0.045)]">
          <Sparkles className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <span className="-ml-1 flex h-10 w-10 rotate-3 items-center justify-center rounded-[8px] border border-[#e4dccd] bg-[#fbfaf6] text-[#7d8188] shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
          <CalendarDays className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
      </div>
      <h2 className="mt-5 text-[24px] font-normal leading-[1.16] text-[#27251e]">Set your AI on a schedule</h2>
      <p className="mx-auto mt-3 max-w-[430px] text-[15px] font-normal leading-[1.45] text-[#85878b]">
        Describe what you want done, pick a schedule, and Ritual delivers a report when it&rsquo;s ready.
      </p>
      <button
        type="button"
        onClick={onNewRoutine}
        className="mt-6 inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#e1dacd] bg-white/80 px-3.5 text-[14px] font-medium text-[#2f312f] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-white hover:border-[#d8cfc0]"
      >
        <Plus className="h-4 w-4" />
        Start from scratch
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
    <div className="flex min-h-[206px] flex-col rounded-[14px] border border-[#ece6db] bg-[#fffefa] px-6 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)] transition hover:border-[#ded5c5] hover:bg-white">
      <div className="min-w-0">
        <div className="truncate text-[17px] font-medium leading-6 text-[#27251e]">{template.title}</div>
        <p className="mt-3 line-clamp-2 text-[15px] font-normal leading-[1.45] text-[#808080]">{template.description}</p>
        <div className="mt-5 flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#f3f1e8] text-[#7a7d82]" aria-hidden>
          <RoutineIcon name={template.icon} className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#ebe4d8] pt-4">
        <span className="flex min-w-0 items-center gap-2 text-[14px] font-normal text-[#8a8d92]">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="truncate">{templateScheduleSummary(template)}</span>
        </span>
        <button
          type="button"
          onClick={() => onSetUp(template)}
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-[#e4dccd] bg-white px-3 text-[14px] font-medium text-[#27251e] shadow-[0_1px_2px_rgba(15,23,42,0.045)] transition hover:bg-[#fbfaf6]"
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
        <div className="text-[16px] font-normal text-[#85878b]">{heading}</div>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-7 border-b border-[#e9e2d7]">
        {ROUTINE_TEMPLATE_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={cn(
              '-mb-px h-9 border-b text-[16px] font-normal transition',
              category === item.id
                ? 'border-[#27251e] text-[#27251e]'
                : 'border-transparent text-[#4f5358] hover:text-[#27251e]',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSetUp={onSetUp}
            installed={installedTemplateKeys?.has(template.id)}
          />
        ))}
        {!templates.length ? (
          <div className="col-span-full px-2 py-10 text-center text-[15px] text-[#85878b]">
            No templates in this category yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}
