'use client';

import { Search, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface KanbanHeaderProps {
  totalTasks: number;
  completedTasks: number;
  filterText: string;
  onFilterChange: (text: string) => void;
  onAddSection?: () => void;
}

export function KanbanHeader({
  totalTasks,
  completedTasks,
  filterText,
  onFilterChange,
  onAddSection,
}: KanbanHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold text-foreground">Daily Tracker</h1>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{totalTasks} items</span>
          <span className="text-muted-foreground/30">/</span>
          <span>{completedTasks} done</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={filterText}
            onChange={(e) => onFilterChange(e.target.value)}
            className="h-8 w-52 border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center border border-border">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-none px-2.5 text-muted-foreground hover:text-foreground"
            aria-label="List view"
          >
            <List className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-none border-l border-border bg-accent px-2.5 text-foreground"
            aria-label="Board view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </Button>
        </div>
        {onAddSection && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onAddSection}>
            Add section
          </Button>
        )}
      </div>
    </header>
  );
}
