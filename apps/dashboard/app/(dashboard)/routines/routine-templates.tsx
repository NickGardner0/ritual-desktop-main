'use client';

import React, { useState } from 'react';
import { Clock, Plus, Sparkles } from 'lucide-react';

import {
  ROUTINE_TEMPLATE_CATEGORIES,
  ROUTINE_TEMPLATES,
  type RoutineTemplate,
  type RoutineTemplateCategory,
} from '@/lib/routines/templates';
import { subtleBorderClass } from '@/lib/tasks/reference-task-shell';
import { cn } from '@/lib/utils';

export function templateScheduleSummary(template: RoutineTemplate): string {
  return template.scheduleLabel;
}

export function RoutinesEmptyHero({ onNewRoutine }: { onNewRoutine: () => void }) {
  return (
    <div className={cn('rounded-[16px] border bg-white px-8 py-16 text-center', subtleBorderClass)}>
      <div className="mx-auto flex h-[68px] w-[68px] items-center justify-center rounded-[10px] bg-[#f8f8f8]" aria-hidden>
        <Sparkles className="h-7 w-7 text-[#007aff]" />
      </div>
      <h2 className="mt-6 text-[32px] font-[640] tracking-[-0.03em] text-black">Set your AI on a schedule</h2>
      <p className="mx-auto mt-3 max-w-[480px] text-[17px] font-[450] leading-[1.32] text-[#9a9a9a]">
        Describe what you want done, pick a schedule, and Ritual delivers a report when it&rsquo;s ready.
      </p>
      <button
        type="button"
        onClick={onNewRoutine}
        className="mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-[#007aff] px-5 text-[16px] font-[650] text-white shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition hover:bg-[#0876e3]"
      >
        <Plus className="h-5 w-5" />
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
    <div className={cn('flex min-h-[176px] flex-col rounded-[16px] border bg-white px-5 py-4 transition hover:bg-[#fcfcfc]', subtleBorderClass)}>
      <div className="min-w-0">
        <div className="truncate text-[18px] font-[650] tracking-[-0.015em] text-black">{template.title}</div>
        <p className="mt-2 line-clamp-2 text-[16px] font-[430] leading-[1.28] text-[#666]">{template.description}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#ececec] pt-4">
        <span className="flex min-w-0 items-center gap-2 text-[14px] font-[500] text-[#9a9a9a]">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="truncate">{templateScheduleSummary(template)}</span>
        </span>
        <button
          type="button"
          onClick={() => onSetUp(template)}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-[#ebebeb] px-4 text-[16px] font-[650] text-black transition hover:bg-[#dedede]"
        >
          <Plus className="h-4 w-4" />
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
        <div className="text-[16px] font-[450] text-[#9a9a9a]">{heading}</div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ROUTINE_TEMPLATE_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={cn(
              'h-9 rounded-full px-4 text-[16px] font-[620] transition',
              category === item.id
                ? 'bg-[#e9e9e9] text-black'
                : 'text-[#666] hover:bg-[#f4f4f4] hover:text-black',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-9 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSetUp={onSetUp}
            installed={installedTemplateKeys?.has(template.id)}
          />
        ))}
        {!templates.length ? (
          <div className="col-span-full px-2 py-10 text-center text-[15px] text-[#777]">
            No templates in this category yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}
