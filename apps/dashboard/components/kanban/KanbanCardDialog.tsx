'use client';

import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CheckSquare,
  MessageSquare,
  Plus,
  Repeat2,
  Target,
  Trash2,
} from 'lucide-react';
import { PriorityIcon, NoPriorityIcon } from './kanban-icons';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type {
  KanbanCard,
  KanbanChecklist,
  KanbanLabel,
  KanbanColumn,
  EnergyCost,
  Priority,
} from '@/types/kanban';
import { PRIORITY_CONFIG } from '@/types/kanban';
import type { HabitOption } from './MetricLinker';

interface KanbanCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: KanbanCard | null;
  habits: HabitOption[];
  labels: KanbanLabel[];
  columns: KanbanColumn[];
  onSave: (updates: Partial<KanbanCard>, activityMessage?: string) => void;
  onDelete: () => void;
  onCreateLabel: (name: string, color: string) => KanbanLabel | null;
  onAddComment: (body: string) => void;
  onDeleteComment: (commentId: string) => void;
  onAddChecklist: (title: string) => string | null;
  onUpdateChecklistTitle: (checklistId: string, title: string) => void;
  onDeleteChecklist: (checklistId: string) => void;
  onAddChecklistItem: (checklistId: string, title: string) => string | null;
  onToggleChecklistItem: (checklistId: string, itemId: string) => void;
  onDeleteChecklistItem: (checklistId: string, itemId: string) => void;
}

const energyOptions: { value: EnergyCost; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const labelPalette = ['#0f766e', '#1d4ed8', '#7c3aed', '#dc2626', '#d97706', '#15803d'];

function ChecklistBlock({
  checklist,
  onUpdateTitle,
  onDelete,
  onAddItem,
  onToggleItem,
  onDeleteItem,
}: {
  checklist: KanbanChecklist;
  onUpdateTitle: (title: string) => void;
  onDelete: () => void;
  onAddItem: (title: string) => void;
  onToggleItem: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
}) {
  const [newItemTitle, setNewItemTitle] = useState('');
  const completedCount = checklist.items.filter((item) => item.completed).length;

  return (
    <div className="rounded-sm border border-border bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={checklist.title}
            onChange={(event) => onUpdateTitle(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#111827] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-[rgba(39,37,30,0.5)]">
            {completedCount}/{checklist.items.length}
          </span>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-sm p-1 text-[rgba(39,37,30,0.42)] transition-colors hover:bg-[#F5F5F2] hover:text-[#111827]"
            aria-label={`Delete checklist ${checklist.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {checklist.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-sm border border-border bg-white px-3 py-2"
          >
            <Checkbox
              checked={item.completed}
              onCheckedChange={() => onToggleItem(item.id)}
            />
            <span
              className={item.completed ? 'flex-1 text-sm text-[rgba(39,37,30,0.42)] line-through' : 'flex-1 text-sm text-[#111827]'}
            >
              {item.title}
            </span>
            <button
              type="button"
              onClick={() => onDeleteItem(item.id)}
              className="rounded-sm p-1 text-[rgba(39,37,30,0.36)] transition-colors hover:bg-[#F5F5F2] hover:text-[#111827]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Input
          value={newItemTitle}
          onChange={(event) => setNewItemTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const title = newItemTitle.trim();
              if (!title) return;
              onAddItem(title);
              setNewItemTitle('');
            }
          }}
          placeholder="Add checklist item"
          className="h-9 rounded-sm border-border"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const title = newItemTitle.trim();
            if (!title) return;
            onAddItem(title);
            setNewItemTitle('');
          }}
          className="rounded-sm border-border"
        >
          Add
        </Button>
      </div>
    </div>
  );
}

export function KanbanCardDialog({
  open,
  onOpenChange,
  card,
  habits,
  labels,
  columns,
  onSave,
  onDelete,
  onCreateLabel,
  onAddComment,
  onDeleteComment,
  onAddChecklist,
  onUpdateChecklistTitle,
  onDeleteChecklist,
  onAddChecklistItem,
  onToggleChecklistItem,
  onDeleteChecklistItem,
}: KanbanCardDialogProps) {
  const [title, setTitle] = useState(card?.title ?? '');
  const [description, setDescription] = useState(card?.description ?? '');
  const [priority, setPriority] = useState<Priority>(card?.priority ?? 4);
  const [energyCost, setEnergyCost] = useState<EnergyCost>(card?.energyCost ?? 'medium');
  const [linkedMetricId, setLinkedMetricId] = useState<string | null>(card?.linkedMetricId ?? null);
  const [linkedMetricTarget, setLinkedMetricTarget] = useState<number | undefined>(card?.linkedMetricTarget);
  const [isRecurring, setIsRecurring] = useState(card?.isRecurring ?? false);
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '');
  const [commentDraft, setCommentDraft] = useState('');
  const [checklistTitle, setChecklistTitle] = useState('');
  const [newLabelName, setNewLabelName] = useState('');

  const linkedMetric = useMemo(
    () => habits.find((habit) => habit.id === linkedMetricId),
    [habits, linkedMetricId]
  );

  if (!card) return null;

  const persist = (updates: Partial<KanbanCard>, activityMessage?: string) => {
    onSave(updates, activityMessage);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[620px] max-w-[94vw] overflow-y-auto border-l border-border bg-white px-0"
      >
        <div className="border-b border-border px-6 py-5">
          <SheetHeader className="space-y-1">
            <SheetTitle className="text-[24px] font-medium tracking-[-0.03em] text-[#111827]">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => persist({ title: title.trim() || 'Untitled' }, 'Updated card title')}
                className="h-auto border-0 bg-transparent px-0 py-0 text-[24px] font-medium tracking-[-0.03em] text-[#111827] shadow-none focus-visible:ring-0"
              />
            </SheetTitle>
            <SheetDescription className="text-[13px] text-[rgba(39,37,30,0.56)]">
              Edit task details, notes, and checklist items.
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="space-y-8 px-6 py-6">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
                List
              </Label>
              <Select
                value={card.columnId}
                onValueChange={(value) => persist({ columnId: value }, 'Changed list')}
              >
                <SelectTrigger className="rounded-sm border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-sm border-border">
                  {columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
                Due date
              </Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgba(39,37,30,0.34)]" />
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(event) => {
                    setDueDate(event.target.value);
                    persist({ dueDate: event.target.value || undefined }, 'Updated due date');
                  }}
                  className="rounded-sm border-border pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
                Priority
              </Label>
              <div className="flex gap-2">
                {([1, 2, 3, 4] as Priority[]).map((p) => {
                  const cfg = PRIORITY_CONFIG[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setPriority(p);
                        persist({ priority: p }, `Set priority to ${cfg.label}`);
                      }}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm border px-3 py-2 text-sm transition-colors ${
                        priority === p
                          ? 'border-[#27251E] bg-[#F5F5F2] text-[#111827]'
                          : 'border-border bg-white text-[rgba(39,37,30,0.56)] hover:bg-[#F5F5F2]'
                      }`}
                    >
                      {p < 4 ? <PriorityIcon priority={p} size={14} /> : <NoPriorityIcon size={14} />}
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
                Energy cost
              </Label>
              <div className="flex gap-2">
                {energyOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setEnergyCost(option.value);
                      persist({ energyCost: option.value }, 'Updated energy cost');
                    }}
                    className={`flex-1 rounded-sm border px-3 py-2 text-sm transition-colors ${
                      energyCost === option.value
                        ? 'border-[#27251E] bg-[#F5F5F2] text-[#111827]'
                        : 'border-border bg-white text-[rgba(39,37,30,0.56)] hover:bg-[#F5F5F2]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
                Linked metric
              </Label>
              <Select
                value={linkedMetricId ?? 'none'}
                onValueChange={(value) => {
                  const nextValue = value === 'none' ? null : value;
                  setLinkedMetricId(nextValue);
                  persist({ linkedMetricId: nextValue ?? undefined }, 'Updated linked metric');
                }}
              >
                <SelectTrigger className="rounded-sm border-border">
                  <SelectValue placeholder="No metric linked" />
                </SelectTrigger>
                <SelectContent className="rounded-sm border-border">
                  <SelectItem value="none">No metric linked</SelectItem>
                  {habits.map((habit) => (
                    <SelectItem key={habit.id} value={habit.id}>
                      {habit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {linkedMetricId ? (
              <div className="space-y-2">
                <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
                  Target value
                </Label>
                <div className="relative">
                  <Target className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgba(39,37,30,0.34)]" />
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={linkedMetricTarget ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      const nextValue = value ? Number(value) : undefined;
                      setLinkedMetricTarget(nextValue);
                      persist({ linkedMetricTarget: nextValue }, 'Updated linked metric target');
                    }}
                    className="rounded-sm border-border pl-9"
                    placeholder={linkedMetric?.unit_type ? `Target (${linkedMetric.unit_type})` : 'Target'}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-2 rounded-sm border border-border bg-white px-3 py-2 sm:col-span-2">
              <Checkbox
                checked={isRecurring}
                onCheckedChange={(checked) => {
                  const nextValue = Boolean(checked);
                  setIsRecurring(nextValue);
                  persist({ isRecurring: nextValue }, nextValue ? 'Marked as recurring' : 'Removed recurring status');
                }}
              />
              <Repeat2 className="h-4 w-4 text-[rgba(39,37,30,0.46)]" />
              <span className="text-sm text-[#111827]">Recurring card</span>
            </div>
          </section>

          <section className="space-y-2">
            <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
              Description
            </Label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => persist({ description: description.trim() || undefined }, 'Updated description')}
              rows={4}
              className="w-full rounded-sm border border-border bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[rgba(39,37,30,0.34)] focus:outline-none"
              placeholder="Add context, acceptance criteria, or notes..."
            />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-[12px] uppercase tracking-[0.12em] text-[rgba(39,37,30,0.46)]">
                Labels
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={newLabelName}
                  onChange={(event) => setNewLabelName(event.target.value)}
                  placeholder="New label"
                  className="h-8 w-32 rounded-sm border-border text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = newLabelName.trim();
                    if (!trimmed) return;
                    const label = onCreateLabel(trimmed, labelPalette[labels.length % labelPalette.length]);
                    if (!label) return;
                    persist(
                      { labelIds: [...card.labelIds, label.id] },
                      `Added ${trimmed} label`
                    );
                    setNewLabelName('');
                  }}
                  className="rounded-sm border border-border px-2.5 py-1.5 text-xs text-[#111827] transition-colors hover:bg-[#F5F5F2]"
                >
                  Create
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {labels.map((label) => {
                const active = card.labelIds.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() =>
                      persist(
                        {
                          labelIds: active
                            ? card.labelIds.filter((labelId) => labelId !== label.id)
                            : [...card.labelIds, label.id],
                        },
                        active ? `Removed ${label.name} label` : `Added ${label.name} label`
                      )
                    }
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? 'border-[#27251E] bg-[#F5F5F2] text-[#111827]'
                        : 'border-border bg-white text-[rgba(39,37,30,0.58)] hover:bg-[#F5F5F2]'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                    {label.name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-[rgba(39,37,30,0.46)]" />
                <h3 className="text-sm font-medium text-[#111827]">Checklists</h3>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={checklistTitle}
                  onChange={(event) => setChecklistTitle(event.target.value)}
                  placeholder="New checklist"
                  className="h-8 w-36 rounded-sm border-border text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-sm border-border"
                  onClick={() => {
                    const title = checklistTitle.trim();
                    if (!title) return;
                    onAddChecklist(title);
                    setChecklistTitle('');
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {card.checklists.map((checklist) => (
                <ChecklistBlock
                  key={checklist.id}
                  checklist={checklist}
                  onUpdateTitle={(nextTitle) => onUpdateChecklistTitle(checklist.id, nextTitle)}
                  onDelete={() => onDeleteChecklist(checklist.id)}
                  onAddItem={(itemTitle) => onAddChecklistItem(checklist.id, itemTitle)}
                  onToggleItem={(itemId) => onToggleChecklistItem(checklist.id, itemId)}
                  onDeleteItem={(itemId) => onDeleteChecklistItem(checklist.id, itemId)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[rgba(39,37,30,0.46)]" />
              <h3 className="text-sm font-medium text-[#111827]">Comments</h3>
            </div>

            <div className="space-y-2">
              {card.comments.map((comment) => (
                <div key={comment.id} className="rounded-sm border border-border bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-6 text-[#111827]">{comment.body}</p>
                    <button
                      type="button"
                      onClick={() => onDeleteComment(comment.id)}
                      className="rounded-sm p-1 text-[rgba(39,37,30,0.36)] transition-colors hover:bg-[#F5F5F2] hover:text-[#111827]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] text-[rgba(39,37,30,0.44)]">
                    {new Date(comment.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add a comment"
                className="rounded-sm border-border"
              />
              <Button
                type="button"
                size="sm"
                className="rounded-sm"
                onClick={() => {
                  const comment = commentDraft.trim();
                  if (!comment) return;
                  onAddComment(comment);
                  setCommentDraft('');
                }}
              >
                Post
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium text-[#111827]">Activity</h3>
            <div className="space-y-2 rounded-sm border border-border bg-white p-3">
              {card.activity
                .slice()
                .reverse()
                .map((entry) => (
                  <div key={entry.id} className="flex items-start justify-between gap-3 border-b border-[#f1f1ec] py-2 last:border-b-0">
                    <span className="text-sm text-[#111827]">{entry.message}</span>
                    <span className="shrink-0 text-[11px] text-[rgba(39,37,30,0.44)]">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
            </div>
          </section>

          <section className="flex items-center justify-between border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              className="rounded-sm border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete card
            </Button>
            <div className="text-[12px] text-[rgba(39,37,30,0.44)]">
              {card.comments.length} comments · {card.activity.length} activity events
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
