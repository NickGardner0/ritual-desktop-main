'use client';

import * as React from "react";
import { Command } from "cmdk";
import { FindInPageSharp, CalendarTodaySharp, FormatListBulletedSharp, BarChartSharp, WifiSharp, SmartToySharp, TimerSharp, CenterFocusStrongSharp, VisibilitySharp, DescriptionSharp, TrendingUpSharp, DownloadSharp } from "@mui/icons-material";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchFooter } from "./search-footer";

// Define the structure for quick actions menu items
interface QuickActionItem {
  id: string; 
  name: string;
  icon: React.ReactNode;
  section: 'quick_actions' | 'tracker' | 'insights';
}

const quickActionItems: QuickActionItem[] = [
  // Quick Actions section
  { id: 'search-logs', name: 'Search logs', icon: <FindInPageSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'quick_actions' },
  { id: 'calendar-view', name: 'Calendar view', icon: <CalendarTodaySharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'quick_actions' },
  { id: 'create-task', name: 'Create task', icon: <FormatListBulletedSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'quick_actions' },
  { id: 'view-analytics', name: 'View analytics', icon: <BarChartSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'quick_actions' },
  { id: 'connect-wearables', name: 'Connect wearables', icon: <WifiSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'quick_actions' },
  { id: 'ai-assistant', name: 'AI assistant', icon: <SmartToySharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'quick_actions' },
  
  // Tracker section
  { id: 'track-time', name: 'Track time', icon: <TimerSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'tracker' },
  { id: 'start-focus-session', name: 'Start focus session', icon: <CenterFocusStrongSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'tracker' },
  
  // Insights section
  { id: 'view-today-summary', name: "View today's summary", icon: <VisibilitySharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'insights' },
  { id: 'weekly-activity-report', name: 'Weekly activity report', icon: <DescriptionSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'insights' },
  { id: 'correlation-finder', name: 'Correlation finder', icon: <TrendingUpSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'insights' },
  { id: 'export-data', name: 'Export data', icon: <DownloadSharp sx={{ fontSize: 16, color: '#374151' }} />, section: 'insights' },
];

interface HabitSelectorProps {
  className?: string;
  initialOpen?: boolean;
  initialCategory?: string | null;
}

export default function CommandPalette({ className, initialOpen = false, initialCategory = null }: HabitSelectorProps) {
  const [open, setOpen] = React.useState(initialOpen);

  // Add key listener for keyboard shortcut
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          setOpen(true);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, []);

  const handleActionSelect = (actionId: string) => {
    console.log("Selected action:", actionId);
    // Here you could handle the specific action (navigate, open modal, etc.)
    setOpen(false);
  };

  if (!open) return (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className={cn("justify-between border border-gray-200 shadow-sm hover:bg-[#F5F5F5] rounded-none", className)}
    >
      <div className="flex items-center gap-2">
        <span>Quick Actions</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 border bg-[#fafaf9] px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </div>
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="overflow-hidden p-0 max-w-full w-full md:max-w-[740px] h-[475px] m-0 select-text bg-transparent border-none"
        style={{ borderRadius: '0px' }}
      >
        <div 
          className="bg-white shadow-lg border border-gray-300 overflow-hidden h-full flex flex-col" 
          style={{ 
            borderRadius: '0px',
            boxSizing: 'border-box',
            outline: 'none'
          }}
        >
          {/* Search Input */}
          <div className="border-b border-gray-300 px-4 py-3">
            <Command className="w-full">
              <Command.Input 
                placeholder="Type a command or search..."
                className="w-full text-sm border-0 focus:outline-none bg-transparent placeholder:text-gray-400"
                autoFocus
              />
            </Command>
          </div>

          {/* Command List */}
          <div className="flex-1 overflow-hidden">
            {/* Scope palette overrides under .rtlp-cmd so global CSS applies square corners */}
            <Command className="rtlp-cmd h-full">
              <Command.List className="h-full overflow-y-auto px-2 pb-2">
                <Command.Empty className="py-6 text-center text-sm text-gray-500">
                  No results found.
                </Command.Empty>

                {/* Quick Actions Section */}
                <div className="px-2 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Quick Actions
                </div>
                {quickActionItems.filter(item => item.section === 'quick_actions').map((action) => (
                  <Command.Item 
                    key={action.id}
                    onSelect={() => handleActionSelect(action.id)}
                    className="flex items-center px-3 py-1.5 mx-2 mb-1 cursor-pointer rounded-none transition-colors hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] data-[selected=true]:bg-[#F3F3F3]"
                  >
                    <div className="flex items-center gap-3">
                      {action.icon}
                      <span className="text-sm text-gray-900">{action.name}</span>
                    </div>
                  </Command.Item>
                ))}
                
                {/* Tracker Section */}
                <div className="px-2 py-2 pt-4 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Tracker
                </div>
                {quickActionItems.filter(item => item.section === 'tracker').map((action) => (
                  <Command.Item 
                    key={action.id}
                    onSelect={() => handleActionSelect(action.id)}
                    className="flex items-center px-3 py-1.5 mx-2 mb-1 cursor-pointer rounded-none transition-colors hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] data-[selected=true]:bg-[#F3F3F3]"
                  >
                    <div className="flex items-center gap-3">
                      {action.icon}
                      <span className="text-sm text-gray-900">{action.name}</span>
                    </div>
                  </Command.Item>
                ))}
                
                {/* Insights Section */}
                <div className="px-2 py-2 pt-4 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Insights
                </div>
                {quickActionItems.filter(item => item.section === 'insights').map((action) => (
                  <Command.Item 
                    key={action.id}
                    onSelect={() => handleActionSelect(action.id)}
                    className="flex items-center px-3 py-1.5 mx-2 mb-1 cursor-pointer rounded-none transition-colors hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] data-[selected=true]:bg-[#F3F3F3]"
                  >
                    <div className="flex items-center gap-3">
                      {action.icon}
                      <span className="text-sm text-gray-900">{action.name}</span>
                    </div>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </div>
          
          {/* Footer */}
          <SearchFooter />
        </div>
      </DialogContent>
    </Dialog>
  );
}