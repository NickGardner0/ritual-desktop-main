'use client';

import React, { useState } from 'react';
import { CalendarDays, Clock, Plus, Sparkles } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@ritual/ui/card';
import { Separator } from '@ritual/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ritual/ui/tabs';

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
    <Card density="compact" className="flex min-h-52 items-center justify-center border-dashed border-[var(--border-subtle)] bg-transparent">
      <CardContent className="p-6 text-center">
        <div className="mx-auto flex items-center justify-center text-[var(--icon-muted)]" aria-hidden>
          <span className="flex h-7 w-7 rotate-[-4deg] items-center justify-center rounded-md border border-[var(--border-subtle)] bg-surface-panel">
            <Clock className="h-3.5 w-3.5" />
          </span>
          <span className="relative z-10 -mx-1 flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-background shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="flex h-7 w-7 rotate-[4deg] items-center justify-center rounded-md border border-[var(--border-subtle)] bg-surface-panel">
            <CalendarDays className="h-3.5 w-3.5" />
          </span>
        </div>
        <h2 className="mt-4 text-lg font-normal leading-6 text-[var(--text-primary)]">Set your AI on a schedule</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">
          Describe what you want Ritual to gather, analyze, or summarize, pick a schedule, and Ritual delivers a report when it&rsquo;s ready.
        </p>
        <Button
          type="button"
          onClick={onNewRoutine}
          className="mt-4 h-9 rounded-md border border-black bg-black px-3 text-[13px] font-medium text-white shadow-none transition-all duration-200 hover:bg-[#3D3C38] hover:text-white"
        >
          <Plus className="h-4 w-4" />
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
    <Card density="compact" className="flex min-h-32 flex-col border-border/70 transition-colors hover:bg-surface-panel">
      <CardHeader className="pb-2.5">
        <CardTitle className="truncate text-sm font-normal leading-5 text-[var(--text-primary)]">
          {template.title}
        </CardTitle>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-[1.45] text-[var(--text-secondary)]">{template.description}</p>
      </CardHeader>
      <Separator className="mt-auto bg-[var(--border-subtle)]" />
      <CardFooter className="justify-between gap-3 pt-3">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{templateScheduleSummary(template)}</span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="compact"
          onClick={() => onSetUp(template)}
          className="shrink-0 rounded-md px-2.5 font-normal"
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
        <div className="text-[13px] text-[var(--text-secondary)]">{heading}</div>
      ) : null}
      <Tabs value={category} onValueChange={(value) => setCategory(value as RoutineTemplateCategory)}>
        <TabsList className="mt-2 w-full justify-start overflow-x-auto" aria-label="Routine template categories">
          {ROUTINE_TEMPLATE_CATEGORIES.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={category} className="mt-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
        </TabsContent>
      </Tabs>
    </section>
  );
}
