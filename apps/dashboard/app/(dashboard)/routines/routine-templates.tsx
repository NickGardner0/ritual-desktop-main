'use client';

import React, { useState } from 'react';
import { Clock, Plus, Sparkles } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@ritual/ui/card';
import { cn } from '@ritual/ui/cn';
import { Separator } from '@ritual/ui/separator';

import {
  ROUTINE_TEMPLATE_CATEGORIES,
  ROUTINE_TEMPLATES,
  type RoutineTemplate,
  type RoutineTemplateCategory,
} from '@/lib/routines/templates';

export function templateScheduleSummary(template: RoutineTemplate): string {
  return template.scheduleLabel;
}

export function RoutinesEmptyHero({ onNewRoutine }: { onNewRoutine: () => void }) {
  return (
    <Card className="border-[var(--border-subtle)] bg-surface-panel shadow-none">
      <CardContent className="px-8 py-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-background text-[var(--icon-default)]" aria-hidden>
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="mt-6 text-2xl font-medium leading-tight text-[var(--text-primary)]">Set your AI on a schedule</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
          Describe what you want done, pick a schedule, and Ritual delivers a report when it&rsquo;s ready.
        </p>
        <Button type="button" onClick={onNewRoutine} className="mt-6">
          <Plus />
          Start from scratch
        </Button>
      </CardContent>
    </Card>
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
    <Card className="flex min-h-44 flex-col border-[var(--border-subtle)] shadow-none transition-colors hover:bg-surface-panel">
      <CardHeader className="p-5 pb-4">
        <CardTitle className="truncate text-base font-medium leading-5 tracking-normal text-[var(--text-primary)]">
          {template.title}
        </CardTitle>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--text-secondary)]">{template.description}</p>
      </CardHeader>
      <Separator className="mt-auto bg-[var(--border-subtle)]" />
      <CardFooter className="justify-between gap-3 p-4">
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--text-muted)]">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="truncate">{templateScheduleSummary(template)}</span>
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onSetUp(template)}
          className="shrink-0"
        >
          <Plus />
          {installed ? 'Set up again' : 'Set up'}
        </Button>
      </CardFooter>
    </Card>
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
        <div className="text-sm text-[var(--text-secondary)]">{heading}</div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Routine template categories">
        {ROUTINE_TEMPLATE_CATEGORIES.map((item) => (
          <Button
            key={item.id}
            id={`routine-template-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            aria-controls="routine-template-panel"
            variant={category === item.id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setCategory(item.id)}
            className={cn('h-8 rounded-row px-3 text-[13px]', category !== item.id && 'text-[var(--text-secondary)]')}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div
        id="routine-template-panel"
        role="tabpanel"
        aria-labelledby={`routine-template-tab-${category}`}
        className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSetUp={onSetUp}
            installed={installedTemplateKeys?.has(template.id)}
          />
        ))}
        {!templates.length ? (
          <div className="col-span-full px-2 py-10 text-center text-sm text-[var(--text-muted)]">
            No templates in this category yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}
