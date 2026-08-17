'use client';

import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ritual/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface HabitOption {
  id: string;
  name: string;
  icon?: string;
  unit_type?: string;
}

interface MetricLinkerProps {
  habits: HabitOption[];
  selectedMetricId: string | null;
  targetValue: number | undefined;
  onMetricChange: (metricId: string | null) => void;
  onTargetChange: (value: number | undefined) => void;
  className?: string;
}

export function MetricLinker({
  habits,
  selectedMetricId,
  targetValue,
  onMetricChange,
  onTargetChange,
  className,
}: MetricLinkerProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Link to metric
      </Label>
      <Select
        value={selectedMetricId ?? 'none'}
        onValueChange={(v) => onMetricChange(v === 'none' ? null : v)}
      >
        <SelectTrigger className="h-8">
          <SelectValue placeholder="No metric" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No metric</SelectItem>
          {habits.map((h) => (
            <SelectItem key={h.id} value={h.id}>
              {h.icon ? (
                <span className="mr-2">{h.icon}</span>
              ) : null}
              {h.name}
              {h.unit_type ? ` (${h.unit_type})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedMetricId && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Target value</Label>
          <Input
            type="number"
            min={0}
            step={0.1}
            placeholder="e.g. 30"
            value={targetValue ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onTargetChange(v === '' ? undefined : Number(v));
            }}
            className="h-8"
          />
        </div>
      )}
    </div>
  );
}
