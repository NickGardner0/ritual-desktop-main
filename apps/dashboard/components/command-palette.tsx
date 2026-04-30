'use client';

import * as React from "react";
import dynamic from "next/dynamic";
import { Command } from "cmdk";
// REMOVED: import * as LucideIcons from "lucide-react" - this imported 400+ icons
// Now using dynamic import for the icon component
import { 
  Search, 
  List, 
  BarChart3, 
  CalendarDays,
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
  Monitor,
  Activity,
  Clock,
  Hash,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

// Dynamic icon component - loads lucide icons on-demand
const DynamicIcon = dynamic(() => import('@/components/ui/dynamic-icon'), {
  ssr: false,
  loading: () => <LayoutDashboard className="w-4 h-4 text-gray-400" />,
});

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
  
  // Use dynamic icon loader for Lucide icons
  return <DynamicIcon name={iconName} className={`${className} text-gray-600`} />;
};
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAnalytics } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/hooks/use-debounce";
import { format, parseISO } from "date-fns";
import { BrailleSpinner } from "@/components/ui/braille-spinner";

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
  artifacts: { hits: any[]; found: number };
  workflows: { hits: any[]; found: number };
  facts: { hits: any[]; found: number };
  fallback?: boolean;
}

// ================================
// ICON MAPPING
// ================================

const iconMap: Record<string, React.ReactNode> = {
  "plus": <Plus className="h-4 w-4" />,
  "search": <Search className="h-4 w-4" />,
  "bar-chart": <BarChart3 className="h-4 w-4" />,
  "calendar": <CalendarDays className="h-4 w-4" />,
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
  "monitor": <Monitor className="h-4 w-4" />,
  "activity": <Activity className="h-4 w-4" />,
  "sparkles": <Sparkles className="h-4 w-4" />,
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
  density?: "default" | "tight";
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
  density = "default",
}: CommandPaletteProps) {
  const [open, setOpen] = React.useState(initialOpen);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  
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
      { id: "log-habit", name: "Log habit", keywords: ["log", "track", "add"], action: "navigate", path: "/dashboard?view=overview&compose=log", icon: "plus" },
      { id: "search-logs", name: "Search logs", keywords: ["find", "search", "history"], action: "navigate", path: "/activity", icon: "search" },
      { id: "view-metrics", name: "View metrics", keywords: ["stats", "charts", "analytics", "metrics"], action: "navigate", path: "/dashboard?view=metrics", icon: "bar-chart" },
      { id: "open-calendar", name: "Open calendar", keywords: ["calendar", "schedule"], action: "navigate", path: "/calendar", icon: "calendar" },
      { id: "ai-assistant", name: "Ask AI", keywords: ["ai", "chat", "ask", "analyze"], action: "navigate", path: "/chat", icon: "bot" },
      { id: "open-reports", name: "Open reports", keywords: ["reports", "artifacts", "notebooks", "plans"], action: "navigate", path: "/reports", icon: "file" },
      { id: "import-data", name: "Import data", keywords: ["import", "upload", "csv"], action: "navigate", path: "/dashboard?view=overview&openImport=1", icon: "upload" },
      { id: "connect-wearables", name: "Integrations", keywords: ["whoop", "oura", "garmin", "apple", "connect"], action: "navigate", path: "/integrations", icon: "watch" },
      { id: "settings", name: "Settings", keywords: ["settings", "preferences"], action: "navigate", path: "/dashboard?openSettings=account", icon: "settings" },
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
      artifacts: { hits: [], found: 0 },
      workflows: { hits: [], found: 0 },
      facts: { hits: [], found: 0 },
      fallback: true,
    };
  };

  const paletteActions = React.useMemo(() => {
    const trimmedQuery = debouncedQuery.trim();
    const actions: QuickAction[] = [...(results?.quick_actions || [])];
    const topHabit = results?.habits?.hits?.[0];

    if (trimmedQuery) {
      actions.unshift(
        {
          id: `search-logs:${trimmedQuery.toLowerCase()}`,
          name: `Search logs for "${trimmedQuery}"`,
          action: "navigate",
          path: `/activity?q=${encodeURIComponent(trimmedQuery)}`,
          icon: "search",
        },
        {
          id: `ask-ai:${trimmedQuery.toLowerCase()}`,
          name: `Ask AI about "${trimmedQuery}"`,
          action: "navigate",
          path: `/chat?q=${encodeURIComponent(trimmedQuery)}`,
          icon: "bot",
        },
      );

      if (topHabit) {
        actions.unshift(
          {
            id: `log:${topHabit.id}`,
            name: `Log ${topHabit.name}`,
            action: "navigate",
            path: `/dashboard?view=overview&compose=log&prefill=${encodeURIComponent(`${topHabit.name} `)}`,
            icon: "plus",
          },
          {
            id: `metrics:${topHabit.id}`,
            name: `View ${topHabit.name} metrics`,
            action: "navigate",
            path: `/dashboard?view=metrics&habit=${encodeURIComponent(topHabit.id)}`,
            icon: "bar-chart",
          },
        );
      }
    }

    const deduped = new Map<string, QuickAction>();
    for (const action of actions) {
      const key = `${action.id}:${action.path || action.name}`;
      if (!deduped.has(key)) {
        deduped.set(key, action);
      }
      if (deduped.size >= 6) break;
    }
    return Array.from(deduped.values());
  }, [debouncedQuery, results]);

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
        if (onOpenLogger) onOpenLogger();
        else router.push("/dashboard?view=overview&compose=log");
        break;
      case "open_import":
        if (onOpenImport) onOpenImport();
        else router.push("/dashboard?view=overview&openImport=1");
        break;
      case "open_settings":
        if (onOpenSettings) onOpenSettings();
        else router.push("/dashboard?openSettings=account");
        break;
      case "export":
        router.push("/dashboard?view=metrics&export=true");
        break;
    }
  };
  
  const handleHabitSelect = (habit: HabitResult) => {
    track('search_habit_selected', { habitId: habit.id, habitName: habit.name });
    setOpen(false);
    setQuery("");
    router.push(`/dashboard?view=metrics&habit=${encodeURIComponent(habit.id)}`);
  };
  
  const handleLogSelect = (log: LogResult) => {
    track('search_log_selected', { logId: log.id });
    setOpen(false);
    setQuery("");
    const params = new URLSearchParams();
    params.set("date", log.date);
    params.set("habits", log.habit_id);
    params.set("q", log.habit_name);
    router.push(`/activity?${params.toString()}`);
  };
  
  const handleConversationSelect = (conv: any) => {
    track('search_conversation_selected', { conversationId: conv.conversation_id });
    setOpen(false);
    setQuery("");
    router.push(`/chat?conversation=${conv.conversation_id}`);
  };

  const handleArtifactSelect = (artifact: any) => {
    track('search_artifact_selected', { artifactId: artifact.id, kind: artifact.kind });
    setOpen(false);
    setQuery("");
    router.push(`/reports?artifactId=${artifact.id}`);
  };

  const handleWorkflowSelect = (workflow: any) => {
    track('search_workflow_selected', { workflowId: workflow.id, kind: workflow.kind });
    setOpen(false);
    setQuery("");
    router.push(`/reports?definitionId=${workflow.id}`);
  };

  const handleFactSelect = (fact: any) => {
    track('search_fact_selected', { factId: fact.id, predicate: fact.predicate });
    setOpen(false);
    setQuery("");
    router.push(`/reports?memory=1&factId=${fact.id}`);
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
    const isTight = density === "tight";
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
          "justify-between border border-gray-200/90 bg-white shadow-sm hover:bg-gray-50 rounded-none",
          className
        )}
      >
        <div className={cn("flex items-center", isTight ? "gap-1.5" : "gap-2")}>
          <span>Search</span>
          <kbd
            className={cn(
              "pointer-events-none inline-flex select-none items-center border border-gray-200/90 bg-[#F0F0F0]/90 font-mono font-medium text-muted-foreground opacity-100",
              isTight ? "h-[18px] gap-0.5 px-1.5 text-[9px]" : "h-5 gap-1 px-1.5 text-[10px]"
            )}
          >
            <span className={cn(isTight ? "text-[10px]" : "text-xs")}>⌘</span>K
          </kbd>
        </div>
      </Button>
    );
  }

  const hasResults = results && (
    paletteActions.length > 0 ||
    results.habits.found > 0 ||
    results.logs.found > 0 ||
    results.conversations.found > 0 ||
    results.artifacts.found > 0 ||
    results.workflows.found > 0 ||
    results.facts.found > 0
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <DialogPrimitive.Portal>
        {/* High z-index overlay to cover sidebar (z-[1001]) */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[9998] bg-[rgba(232,229,223,0.18)] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[9999] translate-x-[-50%] translate-y-[-50%] w-full md:max-w-[680px] select-text border-none shadow-2xl focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <div className="flex h-[420px] flex-col overflow-hidden rounded-sm border border-[rgba(255,255,255,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.50),rgba(246,244,240,0.42))] shadow-[0_24px_56px_rgba(15,23,42,0.16),0_6px_20px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.32)] backdrop-blur-[22px] supports-[backdrop-filter]:bg-[rgba(248,248,246,0.42)]">
            {/* Search Input */}
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-[rgba(39,37,30,0.08)] bg-[rgba(255,255,255,0.16)] px-4 py-3">
              <input
                ref={inputRef}
                type="text"
                placeholder="Type a command or search..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 text-base border-0 focus:outline-none bg-transparent placeholder:text-gray-400"
                autoFocus
              />
              {isLoading && <BrailleSpinner className="text-sm text-gray-400" />}
            </div>

          {/* Results */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-[rgba(255,255,255,0.10)]">
            <Command className="rtlp-cmd" shouldFilter={false}>
              <Command.List className="px-1 py-2 max-h-full overflow-y-auto">
                
                {/* No results */}
                {!hasResults && query && !isLoading && (
                  <div className="py-12 text-center">
                    <p className="text-sm text-gray-500">No results found for &quot;{query}&quot;</p>
                    <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
                  </div>
                )}

                {/* Quick Actions */}
                {paletteActions.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-xs font-medium text-gray-400">
                      {debouncedQuery.trim() ? "Best Matches" : "Quick Actions"}
                    </div>
                    {paletteActions.map((action) => (
                      <Command.Item
                        key={action.id}
                        value={action.name}
                        onSelect={() => handleActionSelect(action)}
                        onClick={() => handleActionSelect(action)}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 rounded-sm hover:bg-[#f0f0ef] data-[selected=true]:bg-[#f0f0ef]"
                      >
                        <span className="text-gray-700 w-4 h-4 flex items-center justify-center">
                          {getActionIcon(action.icon)}
                        </span>
                        <span className="text-sm text-gray-700">{action.name}</span>
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* Habits */}
                {results?.habits && results.habits.found > 0 && (
                  <>
                    <div className="px-3 py-1.5 pt-3 text-xs font-medium text-gray-400 flex items-center justify-between">
                      <span>Habits</span>
                      <span className="text-gray-300 text-xs">{results.habits.found} found</span>
                    </div>
                    {results.habits.hits.slice(0, 5).map((habit) => (
                      <Command.Item
                        key={habit.id}
                        value={`habit-${habit.name}`}
                        onSelect={() => handleHabitSelect(habit)}
                        onClick={() => handleHabitSelect(habit)}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 rounded-sm hover:bg-[#f0f0ef] data-[selected=true]:bg-[#f0f0ef]"
                      >
                        <span className="w-4 h-4 flex items-center justify-center">
                          <HabitIcon iconName={habit.icon} className="w-4 h-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-gray-700">{habit.name}</span>
                          {habit.category && (
                            <span className="text-xs text-gray-400 ml-2">{habit.category}</span>
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
                    <div className="px-3 py-1.5 pt-3 text-xs font-medium text-gray-400 flex items-center justify-between">
                      <span>Recent Logs</span>
                      <span className="text-gray-300 text-xs">{results.logs.found} found</span>
                    </div>
                    {results.logs.hits.slice(0, 5).map((log) => (
                      <Command.Item
                        key={log.id}
                        value={`log-${log.habit_name}-${log.date}`}
                        onSelect={() => handleLogSelect(log)}
                        onClick={() => handleLogSelect(log)}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 rounded-sm hover:bg-[#f0f0ef] data-[selected=true]:bg-[#f0f0ef]"
                      >
                        <span className="text-gray-700 w-4 h-4 flex items-center justify-center">
                          <Clock className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-sm text-gray-700 truncate">{log.habit_name}</span>
                          <span className="text-xs text-gray-400">{formatDate(log.date)}</span>
                          {log.amount != null && (
                            <span className="text-xs text-gray-400">{log.amount} {log.unit_type || ''}</span>
                          )}
                        </div>
                        {log.notes && (
                          <span className="hidden max-w-[180px] truncate text-xs text-gray-400 md:block">
                            {log.notes}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* AI Conversations */}
                {results?.conversations && results.conversations.found > 0 && (
                  <>
                    <div className="px-3 py-1.5 pt-3 text-xs font-medium text-gray-400 flex items-center justify-between">
                      <span>AI Conversations</span>
                      <span className="text-gray-300 text-xs">{results.conversations.found} found</span>
                    </div>
                    {results.conversations.hits.slice(0, 3).map((conv: any) => (
                      <Command.Item
                        key={conv.id}
                        value={`conv-${conv.id}`}
                        onSelect={() => handleConversationSelect(conv)}
                        onClick={() => handleConversationSelect(conv)}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 rounded-sm hover:bg-[#f0f0ef] data-[selected=true]:bg-[#f0f0ef]"
                      >
                        <span className="text-gray-700 w-4 h-4 flex items-center justify-center">
                          <MessageSquare className="h-4 w-4" />
                        </span>
                        <span className="text-sm text-gray-700 truncate flex-1">
                          {conv.content_preview || conv.content?.slice(0, 60)}...
                        </span>
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* Artifacts */}
                {results?.artifacts && results.artifacts.found > 0 && (
                  <>
                    <div className="px-3 py-1.5 pt-3 text-xs font-medium text-gray-400 flex items-center justify-between">
                      <span>Artifacts</span>
                      <span className="text-gray-300 text-xs">{results.artifacts.found} found</span>
                    </div>
                    {results.artifacts.hits.slice(0, 4).map((artifact: any) => (
                      <Command.Item
                        key={artifact.id}
                        value={`artifact-${artifact.id}`}
                        onSelect={() => handleArtifactSelect(artifact)}
                        onClick={() => handleArtifactSelect(artifact)}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 rounded-sm hover:bg-[#f0f0ef] data-[selected=true]:bg-[#f0f0ef]"
                      >
                        <span className="text-gray-700 w-4 h-4 flex items-center justify-center">
                          <FileText className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-gray-700 truncate block">{artifact.title}</span>
                          <span className="text-xs text-gray-400 truncate block">{artifact.kind?.replace?.(/_/g, ' ') || 'artifact'}</span>
                        </div>
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* Workflows */}
                {results?.workflows && results.workflows.found > 0 && (
                  <>
                    <div className="px-3 py-1.5 pt-3 text-xs font-medium text-gray-400 flex items-center justify-between">
                      <span>Routines & Ambient</span>
                      <span className="text-gray-300 text-xs">{results.workflows.found} found</span>
                    </div>
                    {results.workflows.hits.slice(0, 4).map((workflow: any) => (
                      <Command.Item
                        key={workflow.id}
                        value={`workflow-${workflow.id}`}
                        onSelect={() => handleWorkflowSelect(workflow)}
                        onClick={() => handleWorkflowSelect(workflow)}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 rounded-sm hover:bg-[#f0f0ef] data-[selected=true]:bg-[#f0f0ef]"
                      >
                        <span className="text-gray-700 w-4 h-4 flex items-center justify-center">
                          <Sparkles className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-gray-700 truncate block">{workflow.name}</span>
                          <span className="text-xs text-gray-400 truncate block">
                            {(workflow.definition_family || workflow.kind || 'workflow').replace?.(/_/g, ' ')}
                          </span>
                        </div>
                      </Command.Item>
                    ))}
                  </>
                )}

                {/* Facts */}
                {results?.facts && results.facts.found > 0 && (
                  <>
                    <div className="px-3 py-1.5 pt-3 text-xs font-medium text-gray-400 flex items-center justify-between">
                      <span>Memory & Rules</span>
                      <span className="text-gray-300 text-xs">{results.facts.found} found</span>
                    </div>
                    {results.facts.hits.slice(0, 4).map((fact: any) => (
                      <Command.Item
                        key={fact.id}
                        value={`fact-${fact.id}`}
                        onSelect={() => handleFactSelect(fact)}
                        onClick={() => handleFactSelect(fact)}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 rounded-sm hover:bg-[#f0f0ef] data-[selected=true]:bg-[#f0f0ef]"
                      >
                        <span className="text-gray-700 w-4 h-4 flex items-center justify-center">
                          <ShieldCheck className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-gray-700 truncate block">{fact.predicate || fact.category}</span>
                          <span className="text-xs text-gray-400 truncate block">{fact.category || 'fact'}</span>
                        </div>
                      </Command.Item>
                    ))}
                  </>
                )}

              </Command.List>
            </Command>
          </div>
          
          {/* Footer */}
          <div className="flex flex-shrink-0 items-center justify-between border-t border-[rgba(39,37,30,0.08)] bg-[rgba(255,255,255,0.14)] px-3 py-2 text-xs text-gray-400">
            {/* Logo on left */}
            <div className="flex items-center gap-2">
              <img src="/images/eclipse.svg" alt="Ritual" className="h-4 w-4 opacity-70" />
            </div>
            
            {/* Keyboard shortcuts on right */}
            <div className="flex items-center gap-2">
              <kbd className="rounded-sm border border-[rgba(255,255,255,0.54)] bg-[rgba(255,255,255,0.20)] px-1.5 py-0.5 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">↑</kbd>
              <kbd className="rounded-sm border border-[rgba(255,255,255,0.54)] bg-[rgba(255,255,255,0.20)] px-1.5 py-0.5 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">↓</kbd>
              <kbd className="rounded-sm border border-[rgba(255,255,255,0.54)] bg-[rgba(255,255,255,0.20)] px-1.5 py-0.5 text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">↵</kbd>
            </div>
          </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Also export as HabitSelector for backward compatibility
export { CommandPalette as HabitSelector };
