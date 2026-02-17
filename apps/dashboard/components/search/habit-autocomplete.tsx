'use client';

import * as React from "react";
import { Search, Loader2, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";

// ================================
// TYPES
// ================================

interface HabitResult {
  id: string;
  name: string;
  category?: string;
  icon?: string;
  unit_type?: string;
  highlight?: string;
  score?: number;
}

interface HabitAutocompleteProps {
  value?: string;
  onSelect: (habit: HabitResult | { id: null; name: string; isNew: true }) => void;
  placeholder?: string;
  className?: string;
  allowCreate?: boolean;  // Allow creating new habits from search
  autoFocus?: boolean;
  disabled?: boolean;
}

// ================================
// COMPONENT
// ================================

export function HabitAutocomplete({
  value = "",
  onSelect,
  placeholder = "Search habits...",
  className,
  allowCreate = true,
  autoFocus = false,
  disabled = false,
}: HabitAutocompleteProps) {
  const [query, setQuery] = React.useState(value);
  const [results, setResults] = React.useState<HabitResult[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  // Debounce search query
  const debouncedQuery = useDebounce(query, 100);

  // ================================
  // SEARCH API
  // ================================
  
  React.useEffect(() => {
    const fetchHabits = async () => {
      if (!debouncedQuery || debouncedQuery.length < 1) {
        setResults([]);
        return;
      }
      
      setIsLoading(true);
      
      try {
        const params = new URLSearchParams();
        params.set("q", debouncedQuery);
        params.set("limit", "6");
        
        const response = await fetch(`/api/search/habits?${params.toString()}`);
        
        if (response.ok) {
          const data = await response.json();
          setResults(data.hits || []);
        } else {
          setResults([]);
        }
      } catch (error) {
        console.error("Habit search failed:", error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchHabits();
  }, [debouncedQuery]);

  // ================================
  // CLICK OUTSIDE
  // ================================
  
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ================================
  // KEYBOARD NAVIGATION
  // ================================
  
  const totalItems = results.length + (allowCreate && query.length > 0 ? 1 : 0);
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
      }
      return;
    }
    
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalItems);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
        break;
      case "Enter":
        e.preventDefault();
        handleSelectByIndex(selectedIndex);
        break;
      case "Escape":
        setIsOpen(false);
        break;
      case "Tab":
        // Select first result on tab if available
        if (results.length > 0) {
          e.preventDefault();
          handleSelectByIndex(0);
        }
        break;
    }
  };
  
  const handleSelectByIndex = (index: number) => {
    if (index < results.length) {
      handleSelectHabit(results[index]);
    } else if (allowCreate && query.length > 0) {
      // Create new habit
      handleCreateNew();
    }
  };
  
  const handleSelectHabit = (habit: HabitResult) => {
    setQuery(habit.name);
    setIsOpen(false);
    onSelect(habit);
  };
  
  const handleCreateNew = () => {
    setIsOpen(false);
    onSelect({ id: null, name: query, isNew: true });
  };

  // ================================
  // RENDER
  // ================================
  
  const showDropdown = isOpen && (results.length > 0 || (allowCreate && query.length > 0));

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className={cn(
            "w-full pl-9 pr-9 py-2 text-sm border border-gray-300 focus:outline-none focus:border-gray-400",
            "placeholder:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed",
            "rounded-none"
          )}
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 shadow-lg max-h-64 overflow-y-auto">
          {/* Results */}
          {results.map((habit, index) => (
            <button
              key={habit.id}
              type="button"
              onClick={() => handleSelectHabit(habit)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "w-full px-3 py-2 text-left flex items-center gap-3 hover:bg-gray-50",
                selectedIndex === index && "bg-gray-50"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900 truncate">
                  {habit.highlight ? (
                    <span dangerouslySetInnerHTML={{ __html: habit.highlight }} />
                  ) : (
                    habit.name
                  )}
                </div>
                {habit.category && (
                  <div className="text-xs text-gray-400">{habit.category}</div>
                )}
              </div>
              {habit.unit_type && (
                <span className="text-xs text-gray-400 flex-shrink-0">{habit.unit_type}</span>
              )}
            </button>
          ))}

          {/* Create new option */}
          {allowCreate && query.length > 0 && (
            <button
              type="button"
              onClick={handleCreateNew}
              onMouseEnter={() => setSelectedIndex(results.length)}
              className={cn(
                "w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50 border-t border-gray-100",
                selectedIndex === results.length && "bg-gray-50"
              )}
            >
              <Plus className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-blue-600">
                Create &quot;{query}&quot;
              </span>
            </button>
          )}

          {/* No results */}
          {!isLoading && results.length === 0 && !allowCreate && query.length > 0 && (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              No habits found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ================================
// INLINE AUTOCOMPLETE VARIANT
// ================================

interface InlineHabitAutocompleteProps {
  habits: Array<{ id: string; name: string; unit_type?: string }>;
  value: string;
  onChange: (value: string) => void;
  onSelect: (habit: { id: string; name: string } | null) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Simpler inline autocomplete that works with a pre-loaded habits list.
 * Used in clarification dropdowns where we don't want to make API calls.
 */
export function InlineHabitAutocomplete({
  habits,
  value,
  onChange,
  onSelect,
  placeholder = "Type habit name...",
  className,
}: InlineHabitAutocompleteProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  // Filter habits based on input
  const filteredHabits = React.useMemo(() => {
    if (!value) return habits.slice(0, 6);
    
    const query = value.toLowerCase();
    return habits
      .filter((h) => h.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [habits, value]);

  // Click outside handler
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown") setIsOpen(true);
      return;
    }
    
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredHabits.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filteredHabits[selectedIndex]) {
          onSelect(filteredHabits[selectedIndex]);
          onChange(filteredHabits[selectedIndex].name);
          setIsOpen(false);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setSelectedIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm border border-gray-300 focus:outline-none focus:border-gray-400 rounded-none"
      />

      {isOpen && filteredHabits.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 shadow-lg max-h-48 overflow-y-auto">
          {filteredHabits.map((habit, index) => (
            <button
              key={habit.id}
              type="button"
              onClick={() => {
                onSelect(habit);
                onChange(habit.name);
                setIsOpen(false);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center justify-between",
                selectedIndex === index && "bg-gray-50"
              )}
            >
              <span>{habit.name}</span>
              {habit.unit_type && (
                <span className="text-xs text-gray-400">{habit.unit_type}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
