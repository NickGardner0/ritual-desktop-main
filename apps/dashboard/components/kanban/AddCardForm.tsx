'use client';

import React, { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@ritual/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricLinker } from './MetricLinker';
import type { EnergyCost } from '@/types/kanban';
import type { HabitOption } from './MetricLinker';

interface AddCardFormProps {
  columnId: string;
  habits: HabitOption[];
  v0Style?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAdd: (data: {
    title: string;
    energyCost: EnergyCost;
    linkedMetricId?: string | null;
    linkedMetricTarget?: number;
    isRecurring?: boolean;
  }) => void;
}

const ENERGY_OPTIONS: { value: EnergyCost; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function AddCardForm({ columnId, habits, v0Style, open: controlledOpen, onOpenChange, onAdd }: AddCardFormProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [title, setTitle] = useState('');
  const [energyCost, setEnergyCost] = useState<EnergyCost>('medium');
  const [linkedMetricId, setLinkedMetricId] = useState<string | null>(null);
  const [linkedMetricTarget, setLinkedMetricTarget] = useState<number | undefined>();
  const [isRecurring, setIsRecurring] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    onAdd({
      title: t,
      energyCost,
      linkedMetricId,
      linkedMetricTarget,
      isRecurring,
    });
    setTitle('');
    setEnergyCost('medium');
    setLinkedMetricId(null);
    setLinkedMetricTarget(undefined);
    setIsRecurring(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 transition-colors',
            v0Style
              ? 'rounded-lg px-2 py-2 text-xs text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground'
              : 'justify-start text-muted-foreground hover:text-foreground'
          )}
        >
          <Plus className={cn(v0Style ? 'h-3.5 w-3.5' : 'mr-1.5 h-3.5 w-3.5')} />
          Add task
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="add-title">Title</Label>
            <Input
              id="add-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What do you want to do?"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Energy
            </Label>
            <div className="flex gap-2">
              {ENERGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEnergyCost(opt.value)}
                  className={`flex-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                    energyCost === opt.value
                      ? 'border-ring bg-muted'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <MetricLinker
            habits={habits}
            selectedMetricId={linkedMetricId}
            targetValue={linkedMetricTarget}
            onMetricChange={setLinkedMetricId}
            onTargetChange={setLinkedMetricTarget}
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="add-recurring"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="add-recurring" className="text-sm">
              Recurring
            </Label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!title.trim()}>
              Add
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
