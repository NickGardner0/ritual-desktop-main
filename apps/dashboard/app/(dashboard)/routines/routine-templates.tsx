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

export function RoutinesEmptyHero() {
  return (
    <section className="mb-10 flex h-[288px] flex-col items-center justify-center rounded-[14px] border border-dashed border-neutral-200 bg-white px-6 text-center">
      <div className="mb-6 flex items-center justify-center -space-x-1" aria-hidden>
        <span className="flex h-10 w-10 -rotate-[4deg] items-center justify-center rounded-[9px] border border-neutral-200 bg-neutral-50 shadow-sm">
          <Clock className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
        </span>
        <span className="z-10 flex h-11 w-11 items-center justify-center rounded-[10px] border border-neutral-200 bg-white shadow-sm">
          <Sparkles className="h-5 w-5 text-neutral-600" strokeWidth={1.8} />
        </span>
        <span className="flex h-10 w-10 rotate-[4deg] items-center justify-center rounded-[9px] border border-neutral-200 bg-neutral-50 shadow-sm">
          <CalendarDays className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
        </span>
      </div>
      <h2 className="text-[20px] font-medium leading-tight tracking-[-0.015em] text-neutral-950">Set your AI on a schedule</h2>
      <p className="mt-3 max-w-[440px] text-center text-[14px] leading-6 text-neutral-500">
        Describe what you want Ritual to gather, analyze, or summarize, pick a schedule, and Ritual delivers a report when it&rsquo;s ready.
      </p>
    </section>
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
    <article className="flex min-h-[176px] flex-col rounded-[14px] border border-neutral-200 bg-white p-6 transition-colors hover:border-neutral-300">
      <div className="min-w-0">
        <h4 className="truncate text-[16px] font-medium leading-6 tracking-[-0.01em] text-neutral-950">{template.title}</h4>
        <p className="mt-3 line-clamp-2 text-[14px] leading-6 text-neutral-500">{template.description}</p>
        <div className="mt-4 flex h-7 w-7 items-center justify-center rounded-[7px] bg-neutral-50 text-neutral-500" aria-hidden>
          <RoutineIcon name={template.icon} className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-auto border-t border-neutral-100 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-neutral-500">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{templateScheduleSummary(template)}</span>
          </span>
          <button
            type="button"
            onClick={() => onSetUp(template)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-neutral-200 bg-neutral-50 px-3 text-[13px] font-medium text-neutral-950 transition hover:border-neutral-300 hover:bg-white"
          >
            <Plus className="h-3.5 w-3.5" />
            {installed ? 'Set up again' : 'Set up'}
          </button>
        </div>
      </div>
    </article>
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
        <h3 className="mb-4 text-[14px] font-normal text-neutral-500">{heading}</h3>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-7 border-b border-neutral-200">
        {ROUTINE_TEMPLATE_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={cn(
              'relative pb-3 text-[14px] font-medium transition-colors',
              category === item.id
                ? 'text-neutral-950 after:absolute after:bottom-[-1px] after:left-0 after:h-px after:w-full after:bg-neutral-950'
                : 'text-neutral-500 hover:text-neutral-950',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSetUp={onSetUp}
            installed={installedTemplateKeys?.has(template.id)}
          />
        ))}
        {!templates.length ? (
          <div className="col-span-full px-2 py-10 text-center text-[14px] text-neutral-500">
            No templates in this category yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}
