'use client';

import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  ListTodo,
  LoaderCircle,
  PanelRight,
  Plus,
  Search,
  Settings2,
  TriangleAlert,
} from 'lucide-react';

import type { CalendarMode, CalendarPreferences, CalendarView } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ritual/ui/select';

type HeaderProps = {
  periodLabel: string;
  view: CalendarView;
  mode: CalendarMode;
  preferences: CalendarPreferences;
  showToday: boolean;
  syncState: 'pending' | 'refreshing' | 'error' | 'ready';
  pendingCount: number;
  googleConnected: boolean;
  copying: boolean;
  onCreate: () => void;
  onCopyAvailability: () => void;
  onView: (view: CalendarView) => void;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSearch: () => void;
  onConnectGoogle: () => void;
  onPatchPreferences: (patch: Partial<CalendarPreferences>) => void;
};

function SyncState({ state, pendingCount }: { state: HeaderProps['syncState']; pendingCount: number }) {
  if (state === 'pending') return <span title="Calendar changes are queued"><LoaderCircle className="animate-spin" />{pendingCount} pending</span>;
  if (state === 'refreshing') return <span title="Refreshing calendar"><LoaderCircle className="animate-spin" />Syncing</span>;
  if (state === 'error') return <span title="Calendar sync needs attention"><TriangleAlert />Sync issue</span>;
  return <span title="Calendar is up to date"><CheckCircle2 />Up to date</span>;
}

export function CalendarHeader(props: HeaderProps) {
  const {
    periodLabel,
    view,
    mode,
    preferences,
    showToday,
    syncState,
    pendingCount,
    googleConnected,
    copying,
  } = props;
  return (
    <header className="ritual-calendar-header">
      <div className="ritual-calendar-header-primary">
        <h1>{periodLabel}</h1>
        <Button variant="outline" size="compact" onClick={props.onCopyAvailability} disabled={copying}>
          {copying ? <LoaderCircle className="animate-spin" /> : <Copy />}
          <span>Copy availability</span>
        </Button>
      </div>

      <div className="ritual-calendar-header-actions">
        <div className="ritual-calendar-header-sync"><SyncState state={syncState} pendingCount={pendingCount} /></div>
        <Button variant="brand" size="compact" onClick={props.onCreate}><Plus />New event</Button>
        <Select value={view} onValueChange={(value) => props.onView(value as CalendarView)}>
          <SelectTrigger density="compact" className="ritual-calendar-view-select" aria-label="Calendar view">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="week">Week</SelectItem>
            <SelectItem value="day">Day</SelectItem>
          </SelectContent>
        </Select>
        {showToday ? <Button variant="ghost" size="compact" onClick={props.onToday}>Today</Button> : null}
        <div className="ritual-calendar-nav-group">
          <Button variant="ghost" size="icon-compact" onClick={props.onPrevious} aria-label="Previous period"><ChevronLeft /></Button>
          <Button variant="ghost" size="icon-compact" onClick={props.onNext} aria-label="Next period"><ChevronRight /></Button>
        </div>
        <Button variant="ghost" size="icon-compact" onClick={props.onSearch} aria-label="Search calendar"><Search /></Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-compact" aria-label="Calendar settings"><Settings2 /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Calendar settings</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={mode} onValueChange={(value) => props.onPatchPreferences({ mode: value as CalendarMode })}>
              <DropdownMenuRadioItem value="plan"><CalendarDays />Plan</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="review"><Clock3 />Review</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={preferences.show_weekends} onCheckedChange={(value) => props.onPatchPreferences({ show_weekends: value === true })}>
              Show weekends
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={preferences.tasks_open} onCheckedChange={(value) => props.onPatchPreferences({ tasks_open: value === true })}>
              <ListTodo />Task drawer
            </DropdownMenuCheckboxItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Week starts</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={String(preferences.week_starts_on)} onValueChange={(value) => props.onPatchPreferences({ week_starts_on: value === '1' ? 1 : 0 })}>
                  <DropdownMenuRadioItem value="0">Sunday</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="1">Monday</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Time format</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={preferences.time_format} onValueChange={(value) => props.onPatchPreferences({ time_format: value as '12h' | '24h' })}>
                  <DropdownMenuRadioItem value="12h">12-hour</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="24h">24-hour</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Working hours</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuLabel>Start</DropdownMenuLabel>
                {[7, 8, 9, 10].map((hour) => (
                  <DropdownMenuItem
                    key={`start-${hour}`}
                    onSelect={() => props.onPatchPreferences({ workday_start_minutes: hour * 60 })}
                  >{new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })}</DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>End</DropdownMenuLabel>
                {[17, 18, 19, 20].map((hour) => (
                  <DropdownMenuItem
                    key={`end-${hour}`}
                    onSelect={() => props.onPatchPreferences({ workday_end_minutes: hour * 60 })}
                  >{new Date(2020, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            {!googleConnected ? <DropdownMenuItem onSelect={props.onConnectGoogle}>Connect Google Calendar</DropdownMenuItem> : <DropdownMenuLabel>Google Calendar connected</DropdownMenuLabel>}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant={preferences.side_panel_open ? 'secondary' : 'ghost'}
          size="icon-compact"
          onClick={() => props.onPatchPreferences({ side_panel_open: !preferences.side_panel_open })}
          aria-label={preferences.side_panel_open ? 'Hide calendar side panel' : 'Show calendar side panel'}
          aria-pressed={preferences.side_panel_open}
        ><PanelRight /></Button>
      </div>
    </header>
  );
}
