'use client';

import * as React from "react";
import { Search, Clock, Hash, MessageSquare } from "lucide-react";
import { HabitIcon, commandPaletteIconMap } from "@/components/command-palette.icons";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useAnalytics } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { useDebounce } from "@/hooks/use-debounce";
import { format, parseISO } from "date-fns";
import { BrailleSpinner } from "@/components/ui/braille-spinner";
import { useAuth, useUser } from "@clerk/nextjs";
import type { EntitySummary } from "@ritual/shared-contracts";
import { entityProtocolEnabled } from "@/lib/entities/feature-flag";
import { rememberEntitySummary, searchLocalEntities, summaryFromCloud } from "@/lib/entities/resolve";
import { apiOperationWithAuth } from "@/lib/api/client";
import { mergeEntitySummaries, summariesFromSearchBuckets } from "@/lib/entities/search-normalize";
import { ENTITY_TYPE_LABELS } from "@/lib/entities/registry";

const paletteRowClass =
  "ritual-snappy-row ritual-snappy-row-menu flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none";

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
  artifacts?: { hits: any[]; found: number };
  fallback?: boolean;
  privacy_blocked?: boolean;
  entities?: EntitySummary[];
}

// ================================
// ICON MAPPING
// ================================

const iconMap = commandPaletteIconMap;

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

function getLocalQuickActions(q: string): QuickAction[] {
  const actions: QuickAction[] = [
    { id: "log-habit", name: "Log habit", keywords: ["log", "track", "add"], action: "navigate", path: "/dashboard?view=overview&compose=log", icon: "plus" },
    { id: "search-logs", name: "Search logs", keywords: ["find", "search", "history"], action: "navigate", path: "/activity", icon: "search" },
    { id: "view-metrics", name: "View metrics", keywords: ["stats", "charts", "analytics", "metrics"], action: "navigate", path: "/dashboard?view=metrics", icon: "bar-chart" },
    { id: "open-calendar", name: "Open calendar", keywords: ["calendar", "schedule"], action: "navigate", path: "/calendar", icon: "calendar" },
    { id: "ai-assistant", name: "Ask AI", keywords: ["ai", "chat", "ask", "analyze"], action: "navigate", path: "/chat", icon: "bot" },
    { id: "open-reports", name: "Open reports", keywords: ["reports"], action: "navigate", path: "/reports", icon: "file" },
    { id: "import-data", name: "Import data", keywords: ["import", "upload", "csv"], action: "navigate", path: "/dashboard?view=overview&openImport=1", icon: "upload" },
    { id: "connect-wearables", name: "Integrations", keywords: ["whoop", "oura", "garmin", "apple", "connect"], action: "navigate", path: "/integrations", icon: "watch" },
    { id: "settings", name: "Settings", keywords: ["settings", "preferences"], action: "navigate", path: "/dashboard?openSettings=general", icon: "settings" },
    { id: "sentry-smoke", name: "Sentry smoke tests", keywords: ["sentry", "smoke", "observability", "monitoring", "diagnostics"], action: "navigate", path: "/sentry-smoke", icon: "settings" },
  ];

  if (!q) return actions;
  const qLower = q.toLowerCase();
  return actions.filter(a =>
    a.name.toLowerCase().includes(qLower) ||
    a.keywords?.some(k => k.includes(qLower) || qLower.includes(k))
  );
}

function getFallbackResults(q: string): SearchResults {
  const filteredActions = getLocalQuickActions(q);

  return {
    query: q,
    quick_actions: filteredActions.slice(0, 6),
    habits: { hits: [], found: 0 },
    logs: { hits: [], found: 0 },
    conversations: { hits: [], found: 0 },
    activity: { hits: [], found: 0 },
    fallback: true,
    entities: [],
  };
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
  const { user } = useUser();
  const { getToken } = useAuth();
  const { trackQuickActionsOpened, track } = useAnalytics();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  
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
        const data = await apiOperationWithAuth(
          "global_search_api_search_get",
          getToken,
          { query: { q: debouncedQuery, limit: 8 } },
          user?.id,
        ) as SearchResults;
        let entities: EntitySummary[] = summariesFromSearchBuckets(
          data as unknown as Parameters<typeof summariesFromSearchBuckets>[0],
        );
        if (entityProtocolEnabled()) {
          try {
            const entityPayload = await apiOperationWithAuth(
              "search_entities_api_entities_search_get",
              getToken,
              { query: { q: debouncedQuery, limit: 16 } },
              user?.id,
            );
            entities = mergeEntitySummaries(entities, (entityPayload.items || []).map(summaryFromCloud));
          } catch {
            // Keep bucket-normalized results.
          }
          if (user?.id) {
            const local = await searchLocalEntities(user.id, debouncedQuery);
            entities = mergeEntitySummaries(local, entities);
          }
        }
        for (const item of entities) rememberEntitySummary(item);
        setResults({ ...data, entities });
      } catch (error) {
        console.error("Search failed:", error);
        const fallback = getFallbackResults(debouncedQuery);
        if (entityProtocolEnabled() && user?.id) {
          try {
            const local = await searchLocalEntities(user.id, debouncedQuery);
            for (const item of local) rememberEntitySummary(item);
            fallback.entities = local;
          } catch {
            // Keep empty fallback entities.
          }
        }
        setResults(fallback);
      } finally {
        setIsLoading(false);
      }
    };
    
    if (open) {
      fetchResults();
    }
  }, [debouncedQuery, getToken, open, user?.id]);

  const paletteActions = React.useMemo(() => {
    const trimmedQuery = debouncedQuery.trim();
    const actions: QuickAction[] = [
      ...getLocalQuickActions(trimmedQuery),
      ...(results?.quick_actions || []),
    ];
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
        else router.push("/dashboard?openSettings=general");
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

  const handleEntitySelect = (summary: EntitySummary) => {
    track('search_entity_selected', { entityType: summary.ref.type, entityId: summary.ref.id });
    setOpen(false);
    setQuery("");
    router.push(summary.route);
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

  const hasResults = Boolean(
    results && (
      paletteActions.length > 0 ||
      results.habits.found > 0 ||
      results.logs.found > 0 ||
      results.conversations.found > 0 ||
      results.activity.found > 0 ||
      (results.entities && results.entities.length > 0)
    ),
  );

  type PaletteEntry =
    | { kind: "action"; key: string; run: () => void }
    | { kind: "habit"; key: string; run: () => void }
    | { kind: "log"; key: string; run: () => void }
    | { kind: "conversation"; key: string; run: () => void }
    | { kind: "entity"; key: string; run: () => void };

  const selectableEntries = React.useMemo(() => {
    const entries: PaletteEntry[] = [];
    for (const action of paletteActions) {
      entries.push({
        kind: "action",
        key: `action:${action.id}:${action.path || action.name}`,
        run: () => handleActionSelect(action),
      });
    }
    if (!(entityProtocolEnabled() && (results?.entities?.length || 0) > 0)) {
      for (const habit of results?.habits?.hits?.slice(0, 5) || []) {
        entries.push({
          kind: "habit",
          key: `habit:${habit.id}`,
          run: () => handleHabitSelect(habit),
        });
      }
      for (const log of results?.logs?.hits?.slice(0, 5) || []) {
        entries.push({
          kind: "log",
          key: `log:${log.id}`,
          run: () => handleLogSelect(log),
        });
      }
      for (const conv of results?.conversations?.hits?.slice(0, 3) || []) {
        entries.push({
          kind: "conversation",
          key: `conv:${conv.id}`,
          run: () => handleConversationSelect(conv),
        });
      }
    }
    for (const summary of results?.entities?.slice(0, 12) || []) {
      entries.push({
        kind: "entity",
        key: `entity:${summary.ref.type}:${summary.ref.id}`,
        run: () => handleEntitySelect(summary),
      });
    }
    return entries;
  }, [paletteActions, results]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, open, selectableEntries.length]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setQuery("");
        return;
      }
      if (!selectableEntries.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % selectableEntries.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + selectableEntries.length) % selectableEntries.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        selectableEntries[activeIndex]?.run();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, selectableEntries, activeIndex]);

  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Button when closed — Midday-style quiet search affordance (icon + label, no chrome box)
  if (!open) {
    const isTight = density === "tight";
    return (
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label="Search"
        onClick={() => {
          setOpen(true);
          trackQuickActionsOpened();
        }}
        className={cn(
          "inline-flex items-center border-0 bg-transparent shadow-none transition-colors",
          "text-[rgba(39,37,30,0.55)] hover:text-[#27251E] focus-visible:outline-none focus-visible:ring-0",
          isTight ? "h-7 gap-1.5 px-1 text-[14px]" : "h-8 gap-2 px-1.5 text-[15px]",
          className,
        )}
      >
        <Search
          className={cn("shrink-0 opacity-80", isTight ? "h-4 w-4" : "h-[18px] w-[18px]")}
          strokeWidth={1.85}
          aria-hidden
        />
        <span className="font-normal leading-none">Search...</span>
      </button>
    );
  }

  if (typeof document === "undefined") return null;

  let optionIndex = -1;
  const nextOptionIndex = () => {
    optionIndex += 1;
    return optionIndex;
  };

  const modal = (
    <div className="fixed inset-0 z-[9999] h-[100dvh] w-screen overflow-hidden">
      <div
        className="absolute inset-0 bg-[rgba(232,229,223,0.22)] backdrop-blur-[6px]"
        onClick={() => {
          setOpen(false);
          setQuery("");
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 grid place-items-center p-4"
        style={{ left: "var(--ritual-sidebar-current-width, 0px)" }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className={cn(
            "pointer-events-auto flex h-[min(420px,calc(100dvh-48px))] w-full max-w-[640px] flex-col overflow-hidden",
            "rounded-2xl border border-[rgba(39,37,30,0.08)] text-[#111111]",
            "bg-[rgba(255,255,255,0.55)] shadow-[0_24px_64px_rgba(28,25,18,0.16),0_4px_16px_rgba(28,25,18,0.06)]",
            "backdrop-blur-2xl backdrop-saturate-150",
            "supports-[backdrop-filter]:bg-[rgba(255,255,255,0.48)]",
          )}
        >
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-[rgba(39,37,30,0.06)] px-4 py-3">
            <input
              ref={inputRef}
              type="text"
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border-0 bg-transparent text-[15px] font-normal tracking-[-0.01em] text-[#27251E] outline-none placeholder:text-[rgba(39,37,30,0.38)] focus:outline-none"
              autoFocus
            />
            {isLoading && <BrailleSpinner className="text-sm text-[rgba(39,37,30,0.4)]" />}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {!hasResults && query && !isLoading && (
              <div className="py-12 text-center">
                <p className="text-[13.5px] text-[rgba(39,37,30,0.55)]">No results found for &quot;{query}&quot;</p>
                <p className="mt-1 text-[12.5px] text-[rgba(39,37,30,0.4)]">Try a different search term</p>
              </div>
            )}

            {paletteActions.length > 0 && (
              <div>
                <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium tracking-[0.01em] text-[rgba(39,37,30,0.4)]">
                  {debouncedQuery.trim() ? "Best Matches" : "Quick Actions"}
                </div>
                {paletteActions.map((action) => {
                  const index = nextOptionIndex();
                  const active = index === activeIndex;
                  return (
                    <button
                      key={`action:${action.id}:${action.path || action.name}`}
                      type="button"
                      data-active={active ? "true" : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleActionSelect(action)}
                      className={paletteRowClass}
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-[#27251E]">
                        {getActionIcon(action.icon)}
                      </span>
                      <span className="text-[13.5px] font-normal tracking-[-0.01em] text-[#27251E]">
                        {action.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {entityProtocolEnabled() && results?.entities && results.entities.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-2.5 pb-1 pt-3 text-[11px] font-medium tracking-[0.01em] text-[rgba(39,37,30,0.4)]">
                  <span>Objects</span>
                  <span className="text-[11px] text-[rgba(39,37,30,0.3)]">{results.entities.length} found</span>
                </div>
                {results.entities.slice(0, 12).map((summary) => {
                  const index = nextOptionIndex();
                  const active = index === activeIndex;
                  return (
                    <button
                      key={`${summary.ref.type}:${summary.ref.id}`}
                      type="button"
                      data-active={active ? "true" : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleEntitySelect(summary)}
                      className={paletteRowClass}
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-[#27251E]">
                        <Search className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-[#27251E]">{summary.title}</span>
                        {summary.subtitle ? (
                          <span className="ml-2 text-xs text-[rgba(39,37,30,0.4)]">{summary.subtitle}</span>
                        ) : null}
                      </div>
                      <span className="text-xs text-[rgba(39,37,30,0.4)]">{ENTITY_TYPE_LABELS[summary.ref.type]}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {(!entityProtocolEnabled() || !results?.entities?.length) && results?.habits && results.habits.found > 0 && (
              <div>
                <div className="flex items-center justify-between px-2.5 pb-1 pt-3 text-[11px] font-medium tracking-[0.01em] text-[rgba(39,37,30,0.4)]">
                  <span>Habits</span>
                  <span className="text-[11px] text-[rgba(39,37,30,0.3)]">{results.habits.found} found</span>
                </div>
                {results.habits.hits.slice(0, 5).map((habit) => {
                  const index = nextOptionIndex();
                  const active = index === activeIndex;
                  return (
                    <button
                      key={habit.id}
                      type="button"
                      data-active={active ? "true" : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleHabitSelect(habit)}
                      className={paletteRowClass}
                    >
                      <span className="flex h-4 w-4 items-center justify-center">
                        <HabitIcon iconName={habit.icon} className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-[#27251E]">{habit.name}</span>
                        {habit.category && (
                          <span className="ml-2 text-xs text-[rgba(39,37,30,0.4)]">{habit.category}</span>
                        )}
                      </div>
                      {habit.unit_type && (
                        <span className="text-xs text-[rgba(39,37,30,0.4)]">{habit.unit_type}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {(!entityProtocolEnabled() || !results?.entities?.length) && results?.logs && results.logs.found > 0 && (
              <div>
                <div className="flex items-center justify-between px-2.5 pb-1 pt-3 text-[11px] font-medium tracking-[0.01em] text-[rgba(39,37,30,0.4)]">
                  <span>Recent Logs</span>
                  <span className="text-[11px] text-[rgba(39,37,30,0.3)]">{results.logs.found} found</span>
                </div>
                {results.logs.hits.slice(0, 5).map((log) => {
                  const index = nextOptionIndex();
                  const active = index === activeIndex;
                  return (
                    <button
                      key={log.id}
                      type="button"
                      data-active={active ? "true" : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleLogSelect(log)}
                      className={paletteRowClass}
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-[#27251E]">
                        <Clock className="h-4 w-4" />
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-sm text-[#27251E]">{log.habit_name}</span>
                        <span className="text-xs text-[rgba(39,37,30,0.4)]">{formatDate(log.date)}</span>
                        {log.amount != null && (
                          <span className="text-xs text-[rgba(39,37,30,0.4)]">
                            {log.amount} {log.unit_type || ""}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {(!entityProtocolEnabled() || !results?.entities?.length) && results?.conversations && results.conversations.found > 0 && (
              <div>
                <div className="flex items-center justify-between px-2.5 pb-1 pt-3 text-[11px] font-medium tracking-[0.01em] text-[rgba(39,37,30,0.4)]">
                  <span>AI Conversations</span>
                  <span className="text-[11px] text-[rgba(39,37,30,0.3)]">{results.conversations.found} found</span>
                </div>
                {results.conversations.hits.slice(0, 3).map((conv: any) => {
                  const index = nextOptionIndex();
                  const active = index === activeIndex;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      data-active={active ? "true" : undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleConversationSelect(conv)}
                      className={paletteRowClass}
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-[#27251E]">
                        <MessageSquare className="h-4 w-4" />
                      </span>
                      <span className="flex-1 truncate text-sm text-[#27251E]">
                        {conv.content_preview || conv.content?.slice(0, 60)}...
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center justify-between border-t border-[rgba(39,37,30,0.06)] px-3 py-2 text-[12px] text-[rgba(39,37,30,0.4)]">
            <img src="/images/eclipse.svg" alt="Ritual" className="h-4 w-4 opacity-70" />
            <div className="flex items-center gap-1.5">
              <kbd className="rounded-md border border-[rgba(39,37,30,0.1)] bg-[rgba(255,255,255,0.45)] px-1.5 py-0.5 text-[11px] text-[rgba(39,37,30,0.55)]">↑</kbd>
              <kbd className="rounded-md border border-[rgba(39,37,30,0.1)] bg-[rgba(255,255,255,0.45)] px-1.5 py-0.5 text-[11px] text-[rgba(39,37,30,0.55)]">↓</kbd>
              <kbd className="rounded-md border border-[rgba(39,37,30,0.1)] bg-[rgba(255,255,255,0.45)] px-1.5 py-0.5 text-[11px] text-[rgba(39,37,30,0.55)]">↵</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// Also export as HabitSelector for backward compatibility
export { CommandPalette as HabitSelector };
