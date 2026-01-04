'use client';

import * as React from "react";
import { Command } from "cmdk";
import * as LucideIcons from "lucide-react";
import { 
  Search, 
  List, 
  BarChart3, 
  Wifi, 
  Bot, 
  Timer, 
  Focus, 
  Eye, 
  FileText, 
  TrendingUp, 
  Download,
  Plus,
  Settings,
  Upload,
  Watch,
  MessageSquare,
  Activity,
  Clock,
  Calendar,
  Loader2,
  ArrowRight,
  Hash,
  FileSpreadsheet,
  LayoutDashboard
} from "lucide-react";

// Helper to convert kebab-case to PascalCase for Lucide icons
const kebabToPascal = (k: string) => k.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');

// Check if string is an emoji
const isEmoji = (str: string) => /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(str);

// Render habit icon - handles both emojis and Lucide icon names
const HabitIcon = ({ iconName, className = "w-4 h-4" }: { iconName?: string; className?: string }) => {
  if (!iconName) {
    return <LayoutDashboard className={`${className} text-gray-400`} />;
  }
  
  // If it's an emoji, render directly
  if (isEmoji(iconName)) {
    return <span className="text-base leading-none">{iconName}</span>;
  }
  
  // Otherwise, it's a Lucide icon name - convert and render
  const IconComponent = (LucideIcons as any)[kebabToPascal(iconName)];
  
  if (IconComponent) {
    return <IconComponent className={`${className} text-gray-600`} />;
  }
  
  // Fallback
  return <LayoutDashboard className={`${className} text-gray-400`} />;
};
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAnalytics } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/hooks/use-debounce";
import { format, parseISO } from "date-fns";

// ================================
// TYPES
// ================================

interface QuickAction {
  id: string;
  name: string;
  keywords?: string[];
  action: "navigate" | "open_logger" | "open_import" | "open_settings" | "export";
  path?: string;
  icon: string;
}

interface HabitResult {
  id: string;
  name: string;
  category?: string;
  icon?: string;
  unit_type?: string;
  highlight?: string;
}

interface LogResult {
  id: string;
  habit_id: string;
  habit_name: string;
  date: string;
  amount?: number;
  unit_type?: string;
  notes?: string;
}

interface SearchResults {
  query: string;
  quick_actions: QuickAction[];
  habits: { hits: HabitResult[]; found: number };
  logs: { hits: LogResult[]; found: number };
  conversations: { hits: any[]; found: number };
  activity: { hits: any[]; found: number };
  fallback?: boolean;
}

// ================================
// ICON MAPPING
// ================================

const iconMap: Record<string, React.ReactNode> = {
  "plus": <Plus className="h-4 w-4" />,
  "search": <Search className="h-4 w-4" />,
  "bar-chart": <BarChart3 className="h-4 w-4" />,
  "bot": <Bot className="h-4 w-4" />,
  "upload": <Upload className="h-4 w-4" />,
  "watch": <Watch className="h-4 w-4" />,
  "settings": <Settings className="h-4 w-4" />,
  "download": <Download className="h-4 w-4" />,
  "timer": <Timer className="h-4 w-4" />,
  "focus": <Focus className="h-4 w-4" />,
  "eye": <Eye className="h-4 w-4" />,
  "file": <FileText className="h-4 w-4" />,
  "trending": <TrendingUp className="h-4 w-4" />,
  "list": <List className="h-4 w-4" />,
  "wifi": <Wifi className="h-4 w-4" />,
  "message": <MessageSquare className="h-4 w-4" />,
  "activity": <Activity className="h-4 w-4" />,
};

// ================================
// PROPS
// ================================

interface CommandPaletteProps {
  className?: string;
  initialOpen?: boolean;
  onOpenLogger?: () => void;
  onOpenImport?: () => void;
  onOpenSettings?: () => void;
}

// ================================
// COMPONENT
// ================================

export default function CommandPalette({ 
  className, 
  initialOpen = false,
  onOpenLogger,
  onOpenImport,
  onOpenSettings,
}: CommandPaletteProps) {
  const [open, setOpen] = React.useState(initialOpen);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [selectedSection, setSelectedSection] = React.useState<string | null>(null);
  
  const router = useRouter();
  const { trackQuickActionsOpened, track } = useAnalytics();
  const inputRef = React.useRef<HTMLInputElement>(null);
  
  // Debounce search query
  const debouncedQuery = useDebounce(query, 150);

  // ================================
  // KEYBOARD SHORTCUT
  // ================================
  
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          setOpen(true);
          trackQuickActionsOpened();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [trackQuickActionsOpened]);

  // ================================
  // SEARCH API
  // ================================
  
  React.useEffect(() => {
    const fetchResults = async () => {
      setIsLoading(true);
      
      try {
        const params = new URLSearchParams();
        params.set("q", debouncedQuery);
        params.set("limit", "8");
        
        const response = await fetch(`/api/search?${params.toString()}`);
        
        if (response.ok) {
          const data = await response.json();
          setResults(data);
        } else {
          // Use fallback
          setResults(getFallbackResults(debouncedQuery));
        }
      } catch (error) {
        console.error("Search failed:", error);
        setResults(getFallbackResults(debouncedQuery));
      } finally {
        setIsLoading(false);
      }
    };
    
    if (open) {
      fetchResults();
    }
  }, [debouncedQuery, open]);

  // ================================
  // FALLBACK RESULTS
  // ================================
  
  const getFallbackResults = (q: string): SearchResults => {
    const actions: QuickAction[] = [
      { id: "log-habit", name: "Log a habit", keywords: ["log", "track", "add"], action: "open_logger", icon: "plus" },
      { id: "search-logs", name: "Search activity logs", keywords: ["find", "search", "history"], action: "navigate", path: "/activity", icon: "search" },
      { id: "view-analytics", name: "View analytics", keywords: ["stats", "charts"], action: "navigate", path: "/analytics", icon: "bar-chart" },
      { id: "ai-assistant", name: "Ask AI assistant", keywords: ["ai", "chat", "ask", "analyze"], action: "navigate", path: "/chat", icon: "bot" },
      { id: "import-data", name: "Import data", keywords: ["import", "upload", "csv"], action: "open_import", icon: "upload" },
      { id: "connect-wearables", name: "Connect wearables", keywords: ["whoop", "oura", "garmin", "apple"], action: "navigate", path: "/integrations", icon: "watch" },
      { id: "settings", name: "Settings", keywords: ["settings", "preferences"], action: "open_settings", icon: "settings" },
    ];
    
    let filteredActions = actions;
    if (q) {
      const qLower = q.toLowerCase();
      filteredActions = actions.filter(a => 
        a.name.toLowerCase().includes(qLower) ||
        a.keywords?.some(k => k.includes(qLower) || qLower.includes(k))
      );
    }
    
    return {
      query: q,
      quick_actions: filteredActions.slice(0, 6),
      habits: { hits: [], found: 0 },
      logs: { hits: [], found: 0 },
      conversations: { hits: [], found: 0 },
      activity: { hits: [], found: 0 },
      fallback: true,
    };
  };

  // ================================
  // ACTION HANDLERS
  // ================================
  
  const handleActionSelect = (action: QuickAction) => {
    track('quick_action_selected', { actionId: action.id });
    setOpen(false);
    setQuery("");
    
    switch (action.action) {
      case "navigate":
        if (action.path) router.push(action.path);
        break;
      case "open_logger":
        onOpenLogger?.();
        break;
      case "open_import":
        onOpenImport?.();
        break;
      case "open_settings":
        onOpenSettings?.();
        break;
      case "export":
        router.push("/analytics?export=true");
        break;
    }
  };
  
  const handleHabitSelect = (habit: HabitResult) => {
    track('search_habit_selected', { habitId: habit.id, habitName: habit.name });
    setOpen(false);
    setQuery("");
    // Navigate to analytics for this habit or open logger
    router.push(`/analytics?habit=${habit.id}`);
  };
  
  const handleLogSelect = (log: LogResult) => {
    track('search_log_selected', { logId: log.id });
    setOpen(false);
    setQuery("");
    // Navigate to activity page with date filter
    router.push(`/activity?date=${log.date}`);
  };
  
  const handleConversationSelect = (conv: any) => {
    track('search_conversation_selected', { conversationId: conv.conversation_id });
    setOpen(false);
    setQuery("");
    router.push(`/chat?conversation=${conv.conversation_id}`);
  };

  // ================================
  // RENDER HELPERS
  // ================================
  
  const formatDate = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), "MMM d, yyyy");
    } catch {
      return dateStr;
    }
  };
  
  const getActionIcon = (iconName: string) => {
    return iconMap[iconName] || <Hash className="h-4 w-4" />;
  };

  // ================================
  // RENDER
  // ================================
  
  // Button when closed
  if (!open) {
    return (
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          trackQuickActionsOpened();
        }}
        className={cn(
          "justify-between border border-gray-200 shadow-sm hover:bg-[#F5F5F5] rounded-none",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-gray-400" />
          <span>Search</span>
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 border bg-[#fafaf9] px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </Button>
    );
  }

  const hasResults = results && (
    results.quick_actions.length > 0 ||
    results.habits.found > 0 ||
    results.logs.found > 0 ||
    results.conversations.found > 0
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <DialogContent
        className="overflow-hidden p-0 max-w-full w-full md:max-w-[580px] h-[440px] m-0 select-text border-none shadow-2xl"
        style={{ borderRadius: '0px' }}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div 
          className="bg-white border border-gray-200 overflow-hidden h-full flex flex-col" 
          style={{ borderRadius: '0px' }}
        >
          {/* Search Input */}
          <div className="border-b border-gray-200 px-4 py-3 flex items-center gap-3">
            <Search className="h-5 w-5 text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search habits, logs, actions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 text-base border-0 focus:outline-none bg-transparent placeholder:text-gray-400"
              autoFocus
            />
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto">
            <Command className="rtlp-cmd h-full">
              <Command.List className="h-full px-2 py-2">
                
                {/* No results */}
                {!hasResults && query && !isLoading && (
                  <div className="py-12 text-center">
                    <p className="text-sm text-gray-500">No results found for "{query}"</p>
                    <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
                  </div>
                )}

                {/* Quick Actions */}
                {results?.quick_actions && results.quick_actions.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Quick Actions
                    </div>
                    {results.quick_actions.map((action) => (
                      <Command.Item
                        key={action.id}
                        value={action.name}
                        onSelect={() => handleActionSelect(action)}
                        className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-none hover:bg-[#F3F3F3] data-[selected=true]:bg-[#F3F3F3] transition-colors"
                      >
                        <div className="flex items-center justify-center w-7 h-7 bg-gray-100 text-gray-500">
                          {getActionIcon(action.icon)}
                        </div>
                        <span className="text-sm text-gray-700">{action.name}</span>
                        <ArrowRight className="h-3 w-3 text-gray-300 ml-auto" />
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* Habits */}
                {results?.habits && results.habits.found > 0 && (
                  <>
                    <div className="px-2 py-1.5 pt-3 text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Habits</span>
                      <span className="text-gray-300">{results.habits.found} found</span>
                    </div>
                    {results.habits.hits.slice(0, 5).map((habit) => (
                      <Command.Item
                        key={habit.id}
                        value={`habit-${habit.name}`}
                        onSelect={() => handleHabitSelect(habit)}
                        className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-none hover:bg-[#F3F3F3] data-[selected=true]:bg-[#F3F3F3] transition-colors"
                      >
                        <div className="flex items-center justify-center w-7 h-7">
                          <HabitIcon iconName={habit.icon} className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-700 truncate">{habit.name}</div>
                          {habit.category && (
                            <div className="text-xs text-gray-400">{habit.category}</div>
                          )}
                        </div>
                        {habit.unit_type && (
                          <span className="text-xs text-gray-400">{habit.unit_type}</span>
                        )}
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* Recent Logs */}
                {results?.logs && results.logs.found > 0 && (
                  <>
                    <div className="px-2 py-1.5 pt-3 text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Recent Logs</span>
                      <span className="text-gray-300">{results.logs.found} found</span>
                    </div>
                    {results.logs.hits.slice(0, 5).map((log) => (
                      <Command.Item
                        key={log.id}
                        value={`log-${log.habit_name}-${log.date}`}
                        onSelect={() => handleLogSelect(log)}
                        className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-none hover:bg-[#F3F3F3] data-[selected=true]:bg-[#F3F3F3] transition-colors"
                      >
                        <div className="flex items-center justify-center w-7 h-7 bg-green-50 text-green-600">
                          <Clock className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-700 truncate">{log.habit_name}</div>
                          <div className="text-xs text-gray-400 flex items-center gap-2">
                            <span>{formatDate(log.date)}</span>
                            {log.amount != null && (
                              <>
                                <span>•</span>
                                <span>{log.amount} {log.unit_type || ''}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {log.notes && (
                          <span className="text-xs text-gray-400 truncate max-w-[120px]">
                            "{log.notes}"
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* AI Conversations */}
                {results?.conversations && results.conversations.found > 0 && (
                  <>
                    <div className="px-2 py-1.5 pt-3 text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center justify-between">
                      <span>AI Conversations</span>
                      <span className="text-gray-300">{results.conversations.found} found</span>
                    </div>
                    {results.conversations.hits.slice(0, 3).map((conv: any) => (
                      <Command.Item
                        key={conv.id}
                        value={`conv-${conv.id}`}
                        onSelect={() => handleConversationSelect(conv)}
                        className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-none hover:bg-[#F3F3F3] data-[selected=true]:bg-[#F3F3F3] transition-colors"
                      >
                        <div className="flex items-center justify-center w-7 h-7 bg-purple-50 text-purple-600">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-700 truncate">
                            {conv.content_preview || conv.content?.slice(0, 60)}...
                          </div>
                        </div>
                      </Command.Item>
                    ))}
                  </>
                )}

              </Command.List>
            </Command>
          </div>
          
          {/* Footer */}
          <div className="px-3 py-1.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400 bg-[#fafaf9]">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-white border border-gray-200 text-[10px]">↵</kbd>
                <span>Select</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-white border border-gray-200 text-[10px]">↑↓</kbd>
                <span>Navigate</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-white border border-gray-200 text-[10px]">esc</kbd>
                <span>Close</span>
              </span>
            </div>
            {results?.fallback && (
              <span className="text-amber-500 text-[10px]">Offline mode</span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Also export as HabitSelector for backward compatibility
export { CommandPalette as HabitSelector };

