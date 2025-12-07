'use client';

import React from 'react';
import { format, subDays, eachDayOfInterval, isSameDay, getDay } from 'date-fns';
import { Calendar } from 'lucide-react';

interface ActivityData {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  data: ActivityData[];
  days?: number; // Number of days to show (default 90)
}

export function ActivityHeatmap({ data, days = 90 }: ActivityHeatmapProps) {
  const today = new Date();
  const startDate = subDays(today, days - 1);
  
  // Generate all dates in range
  const allDates = eachDayOfInterval({ start: startDate, end: today });
  
  // Create a map of date -> count for quick lookup
  const dataMap = new Map<string, number>();
  data.forEach(item => {
    dataMap.set(item.date, item.count);
  });
  
  // Group dates by week
  const weeks: (Date | null)[][] = [];
  let currentWeek: (Date | null)[] = [];
  
  allDates.forEach((date, index) => {
    const dayOfWeek = getDay(date);
    
    // Start new week on Sunday or at the beginning
    if (dayOfWeek === 0 && currentWeek.length > 0) {
      weeks.push([...currentWeek]);
      currentWeek = [];
    }
    
    currentWeek.push(date);
    
    // Push last week at the end
    if (index === allDates.length - 1) {
      weeks.push(currentWeek);
    }
  });
  
  // Pad first week with empty cells if it doesn't start on Sunday
  if (weeks[0] && weeks[0][0] && getDay(weeks[0][0]) !== 0) {
    const firstDayOfWeek = getDay(weeks[0][0]);
    const padding: null[] = Array(firstDayOfWeek).fill(null);
    weeks[0] = [...padding, ...weeks[0]];
  }
  
  // Get max count for color scaling
  const maxCount = Math.max(...data.map(d => d.count), 1);
  
  // Get intensity level (0-4) for a count
  const getIntensity = (count: number): number => {
    if (count === 0) return 0;
    const percentage = count / maxCount;
    if (percentage >= 0.75) return 4;
    if (percentage >= 0.5) return 3;
    if (percentage >= 0.25) return 2;
    return 1;
  };
  
  // Get color for intensity level - using neutral dark colors to match design
  const getColor = (intensity: number): string => {
    const colors = [
      'bg-gray-100',           // 0 - no activity
      'bg-gray-300',           // 1 - low
      'bg-gray-400',           // 2 - medium
      'bg-gray-600',           // 3 - high
      'bg-gray-900',           // 4 - very high
    ];
    return colors[intensity];
  };
  
  // Calculate stats
  const totalActivities = data.reduce((sum, d) => sum + d.count, 0);
  const daysWithActivity = data.filter(d => d.count > 0).length;
  
  // Day labels - only show select days to keep it clean
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  
  return (
    <div className="bg-white border border-gray-300 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-gray-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Activity Overview</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {totalActivities} entries across {daysWithActivity} active days
            </p>
          </div>
        </div>
        
        {/* Legend */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Less</span>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map(level => (
              <div
                key={level}
                className={`w-3 h-3 ${getColor(level)}`}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
      
      {/* Heatmap Grid */}
      <div className="flex gap-[3px] overflow-x-auto">
        {/* Day labels */}
        <div className="flex flex-col justify-around text-[10px] text-gray-400 pr-2 py-[1px]">
          {dayLabels.map((label, i) => (
            <span key={i} className="h-[11px] leading-[11px]">{label}</span>
          ))}
        </div>
        
        {/* Weeks */}
        <div className="flex gap-[3px]">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((date, dayIndex) => {
                if (!date) {
                  // Empty cell for padding
                  return <div key={`empty-${dayIndex}`} className="w-[11px] h-[11px]" />;
                }
                
                const dateStr = format(date, 'yyyy-MM-dd');
                const count = dataMap.get(dateStr) || 0;
                const intensity = getIntensity(count);
                const isToday = isSameDay(date, today);
                
                return (
                  <div
                    key={dateStr}
                    className={`w-[11px] h-[11px] ${getColor(intensity)} hover:ring-1 hover:ring-gray-400 transition-all cursor-pointer ${
                      isToday ? 'ring-1 ring-black' : ''
                    }`}
                    title={`${format(date, 'MMM d, yyyy')}: ${count} ${count === 1 ? 'entry' : 'entries'}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      {/* Month labels */}
      <div className="flex text-[10px] text-gray-400 mt-2 ml-6">
        {weeks.map((week, index) => {
          const firstDate = week.find(d => d !== null);
          // Show month label at the start and when month changes
          const showLabel = firstDate && (index === 0 || firstDate.getDate() <= 7);
          
          return (
            <div key={index} className="w-[14px] flex-shrink-0">
              {showLabel && firstDate && format(firstDate, 'MMM')}
            </div>
          );
        })}
      </div>
    </div>
  );
}

