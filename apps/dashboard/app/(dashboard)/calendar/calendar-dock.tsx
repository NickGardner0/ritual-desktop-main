'use client';

import { Bot, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Plus, Search, SlidersHorizontal } from 'lucide-react';

import type { CalendarMode, CalendarSource, CalendarView } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@ritual/ui/tabs';

export function CalendarDock({
  date,
  view,
  mode,
  sources,
  tasksOpen,
  agentsOpen,
  onToday,
  onPrevious,
  onNext,
  onView,
  onMode,
  onToggleSource,
  onToggleTasks,
  onToggleAgents,
  onCreateEvent,
  onSearch,
}: {
  date: Date;
  view: CalendarView;
  mode: CalendarMode;
  sources: CalendarSource[];
  tasksOpen: boolean;
  agentsOpen: boolean;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onView: (view: CalendarView) => void;
  onMode: (mode: CalendarMode) => void;
  onToggleSource: (source: CalendarSource) => void;
  onToggleTasks: () => void;
  onToggleAgents: () => void;
  onCreateEvent: () => void;
  onSearch: () => void;
}) {
  const label = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  return (
    <div className="ritual-calendar-dock" role="toolbar" aria-label="Calendar controls">
      <div className="ritual-calendar-date-chip"><CalendarDays /><strong>{label}</strong></div>
      <Button variant="ghost" size="compact" onClick={onToday}>Today</Button>
      <div className="ritual-calendar-dock-pair">
        <Button variant="ghost" size="icon-compact" onClick={onPrevious} aria-label="Previous period"><ChevronLeft /></Button>
        <Button variant="ghost" size="icon-compact" onClick={onNext} aria-label="Next period"><ChevronRight /></Button>
      </div>
      <Tabs value={view} onValueChange={(value) => onView(value as CalendarView)}>
        <TabsList variant="segmented">
          <TabsTrigger value="day">Day</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={mode} onValueChange={(value) => onMode(value as CalendarMode)}>
        <TabsList variant="segmented">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>
      </Tabs>
      <Button variant="ghost" size="icon-compact" onClick={onSearch} aria-label="Search calendar"><Search /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-compact" aria-label="Calendar sources and panes"><SlidersHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Workspace</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={tasksOpen} onCheckedChange={onToggleTasks}><ClipboardList />Task inbox</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={agentsOpen} onCheckedChange={onToggleAgents}><Bot />Agent timeline</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Calendar sources</DropdownMenuLabel>
          {sources.map((source) => <DropdownMenuCheckboxItem key={source.id} checked={source.is_visible} onCheckedChange={() => onToggleSource(source)}><span className="ritual-calendar-source-dot" style={{ background: source.color || 'var(--calendar-external-event)' }} />{source.name}</DropdownMenuCheckboxItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="brand" size="icon-compact" aria-label="Create"><Plus /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem onSelect={onCreateEvent}>New event</DropdownMenuItem><DropdownMenuItem onSelect={onToggleTasks}>New task</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
