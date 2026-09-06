'use client';

import { METRIC_CATEGORY_TABS } from '../metrics-view.shared';

interface MetricsCategoryTabsProps {
  activeCategoryTab: string | null;
  onTabChange: (tabId: string | null) => void;
}

export function MetricsCategoryTabs({ activeCategoryTab, onTabChange }: MetricsCategoryTabsProps) {
  return (
    <div className="mx-auto w-full max-w-[920px] mb-5">
      <div className="flex items-center gap-1 border-b border-[rgba(39,37,30,0.06)] pb-px">
        {METRIC_CATEGORY_TABS.map((tab) => {
          const isActive = (tab.id === 'all' && activeCategoryTab === null) || activeCategoryTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                onTabChange(tab.id === 'all' ? null : (isActive ? null : tab.id));
              }}
              className={`relative px-3.5 py-2 text-[13px] font-medium tracking-[-0.1px] ${
                isActive
                  ? 'text-[#27251E]'
                  : 'text-[rgba(39,37,30,0.4)] hover:text-[rgba(39,37,30,0.7)]'
              }`}
            >
              {tab.label}
              <span
                className={`absolute bottom-0 left-3 right-3 h-[1.5px] rounded-full ${
                  isActive ? 'bg-[#27251E] opacity-100' : 'bg-transparent opacity-0'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
