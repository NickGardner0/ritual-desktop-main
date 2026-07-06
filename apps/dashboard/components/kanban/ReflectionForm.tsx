'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { EnergyCost, KanbanCardReflection } from '@/types/kanban';

const RATING_EMOJIS = ['😫', '😐', '😊', '🤩', '🏆'];
const ENERGY_LABELS: Record<EnergyCost, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

interface ReflectionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardTitle: string;
  onSubmit: (reflection: KanbanCardReflection) => void;
}

export function ReflectionForm({
  open,
  onOpenChange,
  cardTitle,
  onSubmit,
}: ReflectionFormProps) {
  const [rating, setRating] = useState(3);
  const [energyAfter, setEnergyAfter] = useState<EnergyCost>('medium');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    onSubmit({ rating, energyAfter, notes: notes.trim() || undefined });
    setRating(3);
    setEnergyAfter('medium');
    setNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Reflect on {cardTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              How did it feel?
            </Label>
            <div className="flex gap-1">
              {RATING_EMOJIS.map((emoji, i) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setRating(i + 1)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md text-lg transition-colors',
                    rating === i + 1
                      ? 'bg-muted ring-1 ring-ring'
                      : 'hover:bg-muted/50'
                  )}
                  aria-label={`Rate ${i + 1} out of 5`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Energy after
            </Label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setEnergyAfter(level)}
                  className={cn(
                    'flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors',
                    energyAfter === level
                      ? 'border-ring bg-muted'
                      : 'border-border hover:bg-muted/30'
                  )}
                >
                  {ENERGY_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Quick note (optional)
            </Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Brief reflection..."
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          <Button onClick={handleSubmit}>Save reflection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
