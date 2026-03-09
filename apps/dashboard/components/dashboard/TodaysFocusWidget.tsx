'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, Flame } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import { useKanbanBoard } from '@/hooks/useKanbanBoard';
import { cn } from '@/lib/utils';


export function TodaysFocusWidget() {
  const { user } = useUser();
  const { cards } = useKanbanBoard(user?.id);

  const activeColumnIds = ['todo', 'in-progress'];
  const activeCards = cards
    .filter((c) => activeColumnIds.includes(c.columnId))
    .sort((a, b) => a.order - b.order)
    .slice(0, 3);

  if (activeCards.length === 0) return null;

  return (
    <div className="border-b border-border pb-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Today&apos;s Focus</h3>
        <Link
          href="/tasks"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
        >
          View Board
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1.5">
        {activeCards.map((card) => (
          <Link
            key={card.id}
            href="/tasks"
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted/30 transition-colors"
          >
            <span className="font-medium truncate flex-1">{card.title}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {card.isRecurring && card.streak > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs text-orange-500">
                  <Flame className="h-3 w-3" />
                  {card.streak}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
