'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@ritual/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface LogPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  metricName: string;
  unit?: string;
  onSubmit: (value: number) => void;
}

export function LogPrompt({
  open,
  onOpenChange,
  title,
  metricName,
  unit = '',
  onSubmit,
}: LogPromptProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const num = Number(value);
    if (Number.isNaN(num) || num < 0) {
      setError('Please enter a valid number');
      return;
    }
    setError(null);
    onSubmit(num);
    setValue('');
    onOpenChange(false);
  };

  const handleClose = () => {
    setValue('');
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Log value for <strong>{metricName}</strong>
          </p>
          <div className="space-y-2">
            <Label htmlFor="log-value">Value {unit ? `(${unit})` : ''}</Label>
            <Input
              id="log-value"
              type="number"
              min={0}
              step={0.1}
              placeholder={unit ? `e.g. 30 ${unit}` : 'e.g. 30'}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Log</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
