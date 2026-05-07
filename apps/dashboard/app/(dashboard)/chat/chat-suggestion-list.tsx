'use client';

import { ArrowUpRight } from 'lucide-react';
import type { ChatSuggestion } from '@/lib/ai/chat-suggestions';
import { cn } from './chat-client.shared';

interface ChatSuggestionListProps {
  show: boolean;
  suggestions: ChatSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: ChatSuggestion) => void;
  onHoverIndex: (index: number) => void;
}

export function ChatSuggestionList({
  show,
  suggestions,
  selectedIndex,
  onSelect,
  onHoverIndex,
}: ChatSuggestionListProps) {
  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-150 ease-out',
        show ? 'max-h-[104px] opacity-100 pt-1 pb-0' : 'max-h-0 opacity-0',
      )}
    >
      <div className="max-h-[98px] overflow-y-auto border-t border-gray-200/70 pt-0.5">
        {suggestions.map((suggestion, idx) => (
          <button
            key={`${suggestion.type}-${idx}-${suggestion.text.slice(0, 24)}`}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(suggestion)}
            onMouseEnter={() => onHoverIndex(idx)}
            className={cn(
              'group flex w-full items-center justify-between gap-3 px-0 py-[7px] text-left text-[13px] transition-colors',
              idx === selectedIndex
                ? 'text-gray-950'
                : 'text-gray-500 hover:text-gray-900',
            )}
          >
            <span className="truncate leading-snug">{suggestion.text}</span>
            <ArrowUpRight
              className={cn(
                'h-3 w-3 flex-shrink-0 transition-colors',
                idx === selectedIndex
                  ? 'text-gray-500'
                  : 'text-gray-300 group-hover:text-gray-500',
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
