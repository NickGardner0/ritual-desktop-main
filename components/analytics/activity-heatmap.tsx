'use client';

import React from 'react';
import { format, subDays, eachDayOfInterval, startOfWeek, endOfWeek, isSameDay, getDay } from 'date-fns';

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
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];
  
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
  if (weeks[0] && getDay(weeks[0][0]) !== 0) {
    const firstDayOfWeek = getDay(weeks[0][0]);
    const padding = Array(firstDayOfWeek).fill(null);
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
  
  // Get color for intensity level
  const getColor = (intensity: number): string => {
    const colors = [
      'bg-gray-100',      // 0 - no activity
      'bg-green-200',     // 1 - low
      'bg-green-400',     // 2 - medium
      'bg-green-600',     // 3 - high
      'bg-green-800',     // 4 - very high
    ];
    return colors[intensity];
  };
  
  // Calculate total activities and current streak
  const totalActivities = data.reduce((sum, d) => sum + d.count, 0);
  
  return (
    <div className="bg-white border border-gray-300 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Activity Overview</h3>
          <p className="text-sm text-gray-600 mt-1">
            {totalActivities} activities in the last {days} days
          </p>
        </div>
        
        {/* Legend */}
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>Less</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map(level => (
              <div
                key={level}
                className={`w-3 h-3 ${getColor(level)} border border-gray-200`}
                title={level === 0 ? 'No activity' : `${level} level`}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
      
      {/* Heatmap Grid */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {/* Day labels */}
        <div className="flex flex-col justify-around text-xs text-gray-500 pr-2">
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>
        
        {/* Weeks */}
        <div className="flex gap-1">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1">
              {week.map((date, dayIndex) => {
                if (!date) {
                  // Empty cell for padding
                  return <div key={`empty-${dayIndex}`} className="w-3 h-3" />;
                }
                
                const dateStr = format(date, 'yyyy-MM-dd');
                const count = dataMap.get(dateStr) || 0;
                const intensity = getIntensity(count);
                const isToday = isSameDay(date, today);
                
                return (
                  <div
                    key={dateStr}
                    className={`w-3 h-3 ${getColor(intensity)} border border-gray-200 hover:border-gray-400 transition-all cursor-pointer ${
                      isToday ? 'ring-2 ring-blue-500' : ''
                    }`}
                    title={`${format(date, 'MMM d, yyyy')}: ${count} ${count === 1 ? 'activity' : 'activities'}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      {/* Month labels */}
      <div className="flex gap-1 mt-2 ml-12">
        {weeks.map((week, index) => {
          if (index === 0 || (week[0] && getDay(week[0]) <= 7)) {
            const date = week.find(d => d !== null);
            if (date && (index === 0 || date.getDate() <= 7)) {
              return (
                <div key={index} className="text-xs text-gray-500 w-3" style={{ marginLeft: index === 0 ? 0 : 'auto' }}>
                  {format(date, 'MMM')}
                </div>
              );
            }
          }
          return <div key={index} className="w-3" />;
        })}
      </div>
    </div>
  );
}

