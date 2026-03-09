'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MetricLinker } from './MetricLinker';
import type { KanbanCard, EnergyCost } from '@/types/kanban';
import type { HabitOption } from './MetricLinker';

interface KanbanCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: KanbanCard | null;
  habits: HabitOption[];
  onSave: (updates: Partial<KanbanCard>) => void;
}

const ENERGY_OPTIONS: { value: EnergyCost; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function KanbanCardDialog({
  open,
  onOpenChange,
  card,
  habits,
  onSave,
}: KanbanCardDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [energyCost, setEnergyCost] = useState<EnergyCost>('medium');
  const [linkedMetricId, setLinkedMetricId] = useState<string | null>(null);
  const [linkedMetricTarget, setLinkedMetricTarget] = useState<number | undefined>();
  const [isRecurring, setIsRecurring] = useState(false);

  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setDescription(card.description ?? '');
      setEnergyCost(card.energyCost);
      setLinkedMetricId(card.linkedMetricId ?? null);
      setLinkedMetricTarget(card.linkedMetricTarget);
      setIsRecurring(card.isRecurring);
    }
  }, [card]);

  const handleSave = () => {
    const t = title.trim() || 'Untitled';
    onSave({
      title: t,
      description: description.trim() || undefined,
      energyCost,
      linkedMetricId: linkedMetricId ?? undefined,
      linkedMetricTarget,
      isRecurring,
    });
    onOpenChange(false);
  };

  if (!card) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Edit card</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="card-title">Title</Label>
            <Input
              id="card-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="card-desc">Description (optional)</Label>
            <textarea
              id="card-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes..."
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Energy cost
            </Label>
            <div className="flex gap-2">
              {ENERGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEnergyCost(opt.value)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
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
              id="recurring"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="recurring" className="text-sm">
              Recurring (daily ritual)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
