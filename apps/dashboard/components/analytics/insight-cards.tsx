'use client';

import React from 'react';
import {
  CalendarCheck,
  HeartPulse,
  Moon,
  Brain,
  TrendingUp,
  Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Insight agent cards — Perplexity Health "Understand Your Health" style.
 * 6 mini cards in a 3×2 grid with a section header.
 */

interface InsightCard {
  Icon: LucideIcon;
  title: string;
  description: string;
}

const INSIGHT_CARDS: InsightCard[] = [
  {
    Icon: CalendarCheck,
    title: 'Weekly Review',
    description: 'Get a summary of your habits and progress over the past week',
  },
  {
    Icon: HeartPulse,
    title: 'Health Review',
    description: 'A comprehensive view of your health with actionable insights',
  },
  {
    Icon: Moon,
    title: 'Sleep Analysis',
    description: 'Understand your sleep patterns and get actionable tips',
  },
  {
    Icon: Brain,
    title: 'Focus & Productivity',
    description: 'Analyze your deep work hours and screen time habits',
  },
  {
    Icon: TrendingUp,
    title: 'Trend Detector',
    description: 'Surface meaningful trends and correlations in your data',
  },
  {
    Icon: Target,
    title: 'Goal Planner',
    description: 'Set targets and track your progress toward them',
  },
];

interface InsightCardsGridProps {
  onCardClick?: (card: { title: string; description: string }) => void;
}

export function InsightCardsGrid({ onCardClick }: InsightCardsGridProps) {
  return (
    <div>
      {/* Section header */}
      <div className="mb-3">
        <h3 className="text-[15px] font-medium tracking-[-0.3px] text-[#27251E]">
          Understand Your Logs
        </h3>
        <p className="mt-0.5 text-[12px] tracking-[-0.1px] text-[rgba(39,37,30,0.45)]">
          Explore the aggregate performance of your behavior
        </p>
      </div>

      <div className="grid grid-cols-2 gap-[6px] sm:grid-cols-3">
        {INSIGHT_CARDS.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => onCardClick?.({ title: card.title, description: card.description })}
            className="group flex h-[124px] cursor-pointer flex-col items-start justify-between rounded-sm border border-[rgba(39,37,30,0.08)] bg-white px-4 py-3 text-left transition-all duration-200 ease-out hover:border-[rgba(39,37,30,0.13)] hover:bg-[rgba(39,37,30,0.015)] hover:shadow-[0_1px_6px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]"
          >
            <card.Icon className="h-[18px] w-[18px] text-[#27251E]" strokeWidth={1.5} />
            <div>
              <span className="block text-[12.5px] font-medium leading-tight tracking-[-0.2px] text-[#27251E]">
                {card.title}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-[1.35] tracking-[-0.1px] text-[rgba(39,37,30,0.45)]">
                {card.description}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
