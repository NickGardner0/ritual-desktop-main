'use client';

import * as React from "react";
import { Command } from "cmdk";
import { FileSearch, Calendar, ListTodo, BarChart3, Wifi, Bot, Timer, Focus, Eye, FileText, TrendingUp, Download } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Define the structure for quick actions menu items
interface QuickActionItem {
  id: string; 
  name: string;
  icon: React.ReactNode;
  section: 'quick_actions' | 'tracker' | 'insights';
}

const quickActionItems: QuickActionItem[] = [
  // Quick Actions section
  { id: 'search-logs', name: 'Search logs', icon: <FileSearch className="h-4 w-4 text-gray-700" />, section: 'quick_actions' },
  { id: 'calendar-view', name: 'Calendar view', icon: <Calendar className="h-4 w-4 text-gray-700" />, section: 'quick_actions' },
  { id: 'create-task', name: 'Create task', icon: <ListTodo className="h-4 w-4 text-gray-700" />, section: 'quick_actions' },
  { id: 'view-analytics', name: 'View analytics', icon: <BarChart3 className="h-4 w-4 text-gray-700" />, section: 'quick_actions' },
  { id: 'connect-wearables', name: 'Connect wearables', icon: <Wifi className="h-4 w-4 text-gray-700" />, section: 'quick_actions' },
  { id: 'ai-assistant', name: 'AI assistant', icon: <Bot className="h-4 w-4 text-gray-700" />, section: 'quick_actions' },
  
  // Tracker section
  { id: 'track-time', name: 'Track time', icon: <Timer className="h-4 w-4 text-gray-700" />, section: 'tracker' },
  { id: 'start-focus-session', name: 'Start focus session', icon: <Focus className="h-4 w-4 text-gray-700" />, section: 'tracker' },
  
  // Insights section
  { id: 'view-today-summary', name: "View today's summary", icon: <Eye className="h-4 w-4 text-gray-700" />, section: 'insights' },
  { id: 'weekly-activity-report', name: 'Weekly activity report', icon: <FileText className="h-4 w-4 text-gray-700" />, section: 'insights' },
  { id: 'correlation-finder', name: 'Correlation finder', icon: <TrendingUp className="h-4 w-4 text-gray-700" />, section: 'insights' },
  { id: 'export-data', name: 'Export data', icon: <Download className="h-4 w-4 text-gray-700" />, section: 'insights' },
];

interface HabitSelectorProps {
  className?: string;
}

export function HabitSelector({ className }: HabitSelectorProps) {
  const [open, setOpen] = React.useState(false);

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
    <Command.Dialog 
      open={open} 
      onOpenChange={setOpen} 
      className="fixed z-50 font-inter"
      style={{ 
        top: '50%', 
        left: '50%', 
        transform: 'translate(-50%, -50%)',
        width: '100%',
        maxWidth: '720px',
        height: '400px'
      }}
    >
      <div className="bg-white rounded-none shadow-xl border border-gray-200 overflow-hidden max-h-full">
        <div className="relative border-b border-gray-200">
          <Command.Input 
            placeholder="Search actions..."
            className="w-full py-3 text-sm border-0 focus:outline-none bg-transparent px-4"
          />
        </div>

        <Command.List className="max-h-[180px] overflow-y-auto p-2">
          <Command.Empty className="py-4 text-center text-sm text-gray-500">No results found.</Command.Empty>

          {/* Quick Actions Section */}
          <div className="px-0 pb-1 text-xs text-gray-500 font-medium">
            Quick Actions
          </div>
          
          {quickActionItems.filter(item => item.section === 'quick_actions').map((action) => (
            <Command.Item 
              key={action.id}
              onSelect={() => handleActionSelect(action.id)}
              className="flex items-center px-6 py-1.5 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
            >
              <div className="flex items-center gap-3">
                {action.icon}
                <span className="text-sm font-medium text-gray-900">{action.name}</span>
              </div>
            </Command.Item>
          ))}
          
          {/* Tracker Section */}
          <div className="px-0 pb-1 pt-2 text-xs text-gray-500 font-medium">
            Tracker
          </div>
          
          {quickActionItems.filter(item => item.section === 'tracker').map((action) => (
            <Command.Item 
              key={action.id}
              onSelect={() => handleActionSelect(action.id)}
              className="flex items-center px-6 py-1.5 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
            >
              <div className="flex items-center gap-3">
                {action.icon}
                <span className="text-sm font-medium text-gray-900">{action.name}</span>
              </div>
            </Command.Item>
          ))}
          
          {/* Insights Section */}
          <div className="px-0 pb-1 pt-2 text-xs text-gray-500 font-medium">
            Insights
          </div>
          
          {quickActionItems.filter(item => item.section === 'insights').map((action) => (
            <Command.Item 
              key={action.id}
              onSelect={() => handleActionSelect(action.id)}
              className="flex items-center px-6 py-1.5 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
            >
              <div className="flex items-center gap-3">
                {action.icon}
                <span className="text-sm font-medium text-gray-900">{action.name}</span>
              </div>
            </Command.Item>
          ))}
        </Command.List>
        
        {/* Bottom footer row - similar to Raycast */}
        <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 flex items-center justify-between">
          {/* Left side - Logo */}
          <div className="flex items-center opacity-40">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 40 40" className="text-gray-500">
              <path fill="currentColor" d="M0 20C0 8.954 8.954 0 20 0c8.121 0 15.112 4.84 18.245 11.794l-26.45 26.45a20 20 0 0 1-3.225-1.83L24.984 20H20L5.858 34.142A19.94 19.94 0 0 1 0 20M39.999 20.007 20.006 40c11.04-.004 19.99-8.953 19.993-19.993"/>
            </svg>
          </div>

          {/* Right side - Actions */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <span>Select</span>
              <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded-none text-xs font-mono">↵</kbd>
            </div>
          </div>
        </div>
      </div>
    </Command.Dialog>
  );
}