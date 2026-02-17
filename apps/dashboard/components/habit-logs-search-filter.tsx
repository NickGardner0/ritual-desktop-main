'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Input } from '@/components/ui/input';
import type { FilterState } from '@/app/(dashboard)/activity/activity-client';

interface Suggestion {
  type: 'habit' | 'note' | 'date';
  text: string;
  id?: string;
}

interface Props {
  filters: FilterState;
  onFilterChange: (filters: Partial<FilterState>) => void;
  habits: Array<{ id: string; name: string; category: string }>;
  categories: string[];
  sources: string[];
}

function toLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

export function HabitLogsSearchFilter({
  filters,
  onFilterChange,
  habits,
}: Props) {
  const [searchInput, setSearchInput] = useState(filters.q || '');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the search input (150ms for fast typing)
  const debouncedSearch = useDebounce(searchInput, 150);

  // Fetch suggestions from Typesense when query changes
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!debouncedSearch || debouncedSearch.length < 2) {
        setSuggestions([]);
        return;
      }
      
      setIsLoading(true);
      
      try {
        // Fetch habit suggestions
        const habitResponse = await fetch(`/api/search/habits?q=${encodeURIComponent(debouncedSearch)}&limit=4`);
        
        let habitSuggestions: Suggestion[] = [];
        if (habitResponse.ok) {
          const data = await habitResponse.json();
          habitSuggestions = (data.hits || []).map((h: any) => ({
            type: 'habit' as const,
            text: h.name,
            id: h.id,
          }));
        }
        
        // Add quick date suggestions based on common patterns
        const dateSuggestions: Suggestion[] = [];
        const searchLower = debouncedSearch.toLowerCase();
        
        if ('today'.includes(searchLower) || searchLower.includes('today')) {
          dateSuggestions.push({ type: 'date', text: 'Today' });
        }
        if ('yesterday'.includes(searchLower) || searchLower.includes('yesterday')) {
          dateSuggestions.push({ type: 'date', text: 'Yesterday' });
        }
        if ('last week'.includes(searchLower) || searchLower.includes('week')) {
          dateSuggestions.push({ type: 'date', text: 'Last 7 days' });
        }
        if ('last month'.includes(searchLower) || searchLower.includes('month')) {
          dateSuggestions.push({ type: 'date', text: 'Last 30 days' });
        }
        
        setSuggestions([...habitSuggestions, ...dateSuggestions].slice(0, 6));
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchSuggestions();
  }, [debouncedSearch]);

  // Trigger search when debounced value changes
  useEffect(() => {
    const newQuery = debouncedSearch || null;
    const currentQuery = filters.q || null;
    
    if (newQuery !== currentQuery) {
      onFilterChange({ q: newQuery });
    }
  }, [debouncedSearch, filters.q, onFilterChange]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle search input change
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
    setShowSuggestions(true);
    setSelectedIndex(-1);
  }, []);

  // Handle search submit
  const handleSearchSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    setShowSuggestions(false);
    onFilterChange({ q: searchInput || null });
  }, [searchInput, onFilterChange]);

  // Handle suggestion selection
  const handleSelectSuggestion = useCallback((suggestion: Suggestion) => {
    setShowSuggestions(false);
    
    if (suggestion.type === 'habit') {
      // Filter by specific habit
      setSearchInput(suggestion.text);
      onFilterChange({ 
        q: suggestion.text,
        habits: suggestion.id ? [suggestion.id] : null 
      });
    } else if (suggestion.type === 'date') {
      // Handle date filter
      const now = new Date();
      let start: string | null = null;
      let end: string | null = null;
      
      if (suggestion.text === 'Today') {
        start = end = toLocalDateString(now);
      } else if (suggestion.text === 'Yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        start = end = toLocalDateString(yesterday);
      } else if (suggestion.text === 'Last 7 days') {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        start = toLocalDateString(weekAgo);
        end = toLocalDateString(now);
      } else if (suggestion.text === 'Last 30 days') {
        const monthAgo = new Date(now);
        monthAgo.setDate(monthAgo.getDate() - 30);
        start = toLocalDateString(monthAgo);
        end = toLocalDateString(now);
      }
      
      setSearchInput('');
      onFilterChange({ q: null, start, end });
    } else {
      setSearchInput(suggestion.text);
      onFilterChange({ q: suggestion.text });
    }
  }, [onFilterChange]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') handleSearchSubmit();
      if (e.key === 'Escape') {
        setSearchInput('');
        onFilterChange({ q: null });
      }
      return;
    }
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelectSuggestion(suggestions[selectedIndex]);
        } else {
          handleSearchSubmit();
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
      case 'Tab':
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          e.preventDefault();
          handleSelectSuggestion(suggestions[selectedIndex]);
        }
        break;
    }
  }, [showSuggestions, suggestions, selectedIndex, handleSearchSubmit, handleSelectSuggestion, onFilterChange]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1">
      {/* Search Input with Autocomplete */}
      <div ref={containerRef} className="relative flex-1 max-w-[400px]">
        <form onSubmit={handleSearchSubmit}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
          <Input
            ref={inputRef}
            placeholder="Search logs, habits, notes..."
            className="pl-9 pr-9 rounded-none border-gray-300 focus:ring-0 focus:border-gray-400 h-10"
            value={searchInput}
            onChange={handleSearchChange}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
          />
          
          {/* Loading indicator */}
          {isLoading && (
            <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
          )}
          
          {/* Clear button */}
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                onFilterChange({ q: null });
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 shadow-sm max-h-64 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.type}-${suggestion.text}-${index}`}
                type="button"
                onClick={() => handleSelectSuggestion(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full px-3 py-1.5 text-left text-sm ${
                  selectedIndex === index ? 'text-gray-900' : 'text-gray-500'
                } hover:text-gray-900 transition-colors`}
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
