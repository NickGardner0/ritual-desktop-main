'use client';

import React from 'react';

/**
 * Insight agent cards — Perplexity Health "Understand Your Health" style.
 * 6 mini cards in a 3×2 grid, each with an icon, title, and description.
 */

interface InsightCard {
  icon: string;
  title: string;
  description: string;
}

const INSIGHT_CARDS: InsightCard[] = [
  {
    icon: '📊',
    title: 'Weekly Review',
    description: 'Get a summary of your habits and progress over the past week',
  },
  {
    icon: '🏋️',
    title: 'Fitness Coach',
    description: 'Workout insights based on your activity and recovery data',
  },
  {
    icon: '😴',
    title: 'Sleep Analysis',
    description: 'Understand your sleep patterns and get actionable tips',
  },
  {
    icon: '🧠',
    title: 'Focus & Productivity',
    description: 'Analyze your deep work hours and screen time habits',
  },
  {
    icon: '📈',
    title: 'Trend Detector',
    description: 'Surface meaningful trends and correlations in your data',
  },
  {
    icon: '🎯',
    title: 'Goal Planner',
    description: 'Set targets and track your progress toward them',
  },
];

interface InsightCardsGridProps {
  onCardClick?: (card: InsightCard) => void;
}

export function InsightCardsGrid({ onCardClick }: InsightCardsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-[6px] sm:grid-cols-3">
      {INSIGHT_CARDS.map((card) => (
        <button
          key={card.title}
          type="button"
          onClick={() => onCardClick?.(card)}
          className="group flex flex-col items-start rounded-xl border border-[rgba(39,37,30,0.08)] bg-white px-4 py-3.5 text-left transition-all duration-150 hover:border-[rgba(39,37,30,0.14)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
        >
          <span className="mb-2 text-[20px] leading-none">{card.icon}</span>
          <span className="text-[13px] font-medium tracking-[-0.2px] text-[#27251E]">
            {card.title}
          </span>
          <span className="mt-0.5 text-[11.5px] leading-[1.4] tracking-[-0.1px] text-[rgba(39,37,30,0.45)]">
            {card.description}
          </span>
        </button>
      ))}
    </div>
  );
}
