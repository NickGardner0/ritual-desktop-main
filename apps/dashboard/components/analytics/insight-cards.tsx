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
  compact?: boolean;
}

export function InsightCardsGrid({ onCardClick, compact = false }: InsightCardsGridProps) {
  return (
    <div className={`w-full ${compact ? 'max-w-none' : 'max-w-[708px]'}`}>
      {/* Section header */}
      <div className={compact ? 'mb-2' : 'mb-3'}>
        <h3 className={`${compact ? 'text-[14px]' : 'text-[15px]'} font-medium tracking-[-0.3px] text-[#27251E]`}>
          Understand Your Logs
        </h3>
        <p className={`mt-0.5 ${compact ? 'text-[11px] leading-[14px]' : 'text-[12px]'} tracking-[-0.1px] text-[rgba(39,37,30,0.45)]`}>
          Explore the aggregate performance of your behavior
        </p>
      </div>

      <div className={`grid grid-cols-2 ${compact ? 'gap-1' : 'gap-[6px]'} sm:grid-cols-3`}>
        {INSIGHT_CARDS.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => onCardClick?.({ title: card.title, description: card.description })}
            className={`group flex cursor-pointer flex-col justify-between overflow-hidden rounded-sm border border-[rgba(39,37,30,0.08)] bg-white text-left duration-200 ease-out hover:border-[rgba(39,37,30,0.13)] hover:bg-[rgba(39,37,30,0.015)] hover:shadow-[0_1px_6px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] ${
              compact ? 'h-[90px] px-2.5 py-2' : 'h-[124px] px-4 py-4'
            }`}
            style={{ transition: 'border-color 200ms ease-out, background-color 200ms ease-out, box-shadow 200ms ease-out' }}
          >
            <card.Icon className={`${compact ? 'h-[14px] w-[14px]' : 'h-[18px] w-[18px]'} text-[#27251E]`} strokeWidth={1.5} />
            <div className="min-w-0">
              <span className={`block truncate font-medium tracking-[-0.24px] text-[#27251E] ${
                compact ? 'text-[11px] leading-[13px]' : 'text-[12.75px] leading-[17px]'
              }`}>
                {card.title}
              </span>
              <span className={`mt-1 block tracking-[-0.18px] text-[rgba(39,37,30,0.62)] ${
                compact ? 'text-[9.5px] leading-[11px]' : 'text-[11px] leading-[14px]'
              }`}>
                {card.description}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
