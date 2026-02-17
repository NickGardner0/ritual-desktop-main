'use client';

import React, { useState, useEffect } from 'react';
import { Monitor, Clock, Repeat, TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';

interface TopApp {
  app_bundle_id: string;
  app_name: string;
  total_active_ms: number;
  total_events: number;
  hours: number;
}

interface DailySummary {
  day: string;
  total_active_ms: number;
  total_events: number;
  apps: {
    app_bundle_id: string;
    app_name: string;
    active_ms: number;
    events_count: number;
  }[];
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatHours(hours: number): string {
  if (hours >= 1) {
    return `${hours.toFixed(1)}h`;
  }
  return `${Math.round(hours * 60)}m`;
}

// App icon mapping (common apps)
const APP_ICONS: Record<string, string> = {
  'com.apple.Safari': '🌐',
  'com.google.Chrome': '🌐',
  'org.mozilla.firefox': '🦊',
  'com.microsoft.VSCode': '💻',
  'com.apple.Terminal': '⌨️',
  'com.apple.mail': '📧',
  'com.apple.iCal': '📅',
  'com.apple.Notes': '📝',
  'com.slack.Slack': '💬',
  'com.microsoft.teams': '👥',
  'com.zoom.us': '📹',
  'com.spotify.client': '🎵',
  'com.apple.Music': '🎵',
  'com.figma.Desktop': '🎨',
  'com.adobe.Photoshop': '🖼️',
  'default': '📱',
};

function getAppIcon(bundleId: string): string {
  return APP_ICONS[bundleId] || APP_ICONS['default'];
}

interface ComputerTimeCardProps {
  className?: string;
  onViewDetails?: () => void;
}

function toLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

export function ComputerTimeCard({ className = '', onViewDetails }: ComputerTimeCardProps) {
  const { getToken } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [todayData, setTodayData] = useState<DailySummary | null>(null);
  const [topApps, setTopApps] = useState<TopApp[]>([]);
  const [yesterdayMs, setYesterdayMs] = useState<number>(0);

  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);

        const token = await getToken();
        const now = new Date();
        const today = toLocalDateString(now);
        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = toLocalDateString(yesterdayDate);

        // Fetch today's summary
        const summaryRes = await fetch(
          `/api/watcher/daily?start_date=${today}&end_date=${today}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          if (summaryData.days && summaryData.days.length > 0) {
            setTodayData(summaryData.days[0]);
          }
        }

        // Fetch yesterday for comparison
        const yesterdayRes = await fetch(
          `/api/watcher/daily?start_date=${yesterday}&end_date=${yesterday}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (yesterdayRes.ok) {
          const yesterdayData = await yesterdayRes.json();
          if (yesterdayData.days && yesterdayData.days.length > 0) {
            setYesterdayMs(yesterdayData.days[0].total_active_ms);
          }
        }

        // Fetch top apps for the week
        const weekAgoDate = new Date(now);
        weekAgoDate.setDate(weekAgoDate.getDate() - 7);
        const weekAgo = toLocalDateString(weekAgoDate);
        const topAppsRes = await fetch(
          `/api/watcher/top-apps?start_date=${weekAgo}&end_date=${today}&limit=5`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (topAppsRes.ok) {
          const topAppsData = await topAppsRes.json();
          setTopApps(topAppsData.apps || []);
        }
      } catch (e) {
        console.error('Failed to fetch computer time data:', e);
        setError('Failed to load data');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [getToken]);

  const todayMs = todayData?.total_active_ms || 0;
  const todayEvents = todayData?.total_events || 0;
  
  // Calculate change percentage
  const changePercent = yesterdayMs > 0 
    ? Math.round(((todayMs - yesterdayMs) / yesterdayMs) * 100)
    : 0;

  if (isLoading) {
    return (
      <div className={`bg-white border border-gray-200 p-4 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/2" />
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (error || !todayData) {
    return (
      <div className={`bg-white border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-500">
          <Monitor className="w-5 h-5" />
          <span className="text-sm">No computer tracking data yet</span>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Enable Computer Tracking in Settings to see your screen time
        </p>
      </div>
    );
  }

  return (
    <div 
      className={`bg-white border border-gray-200 p-4 hover:bg-gray-50 transition-colors cursor-pointer ${className}`}
      onClick={onViewDetails}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-indigo-600" />
          <h3 className="text-sm font-medium text-gray-900">Computer Time Today</h3>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </div>

      {/* Main Stat */}
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-3xl font-semibold text-gray-900">
          {formatDuration(todayMs)}
        </span>
        {changePercent !== 0 && (
          <span className={`flex items-center gap-1 text-sm ${
            changePercent > 0 ? 'text-amber-600' : 'text-green-600'
          }`}>
            {changePercent > 0 ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            {Math.abs(changePercent)}% vs yesterday
          </span>
        )}
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-6 mb-4 text-sm text-gray-600">
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-gray-400" />
          <span>{todayData.apps?.length || 0} apps used</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Repeat className="w-4 h-4 text-gray-400" />
          <span>{todayEvents} switches</span>
        </div>
      </div>

      {/* Top Apps */}
      {topApps.length > 0 && (
        <div className="border-t border-gray-200 pt-3">
          <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            Top Apps This Week
          </h4>
          <div className="space-y-2">
            {topApps.slice(0, 3).map((app, index) => (
              <div key={app.app_bundle_id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">{getAppIcon(app.app_bundle_id)}</span>
                  <span className="text-sm text-gray-700 truncate max-w-[140px]">
                    {app.app_name}
                  </span>
                </div>
                <span className="text-sm text-gray-500 font-medium">
                  {formatHours(app.hours)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact version for smaller cards
export function ComputerTimeMiniCard({ className = '' }: { className?: string }) {
  const { getToken } = useAuth();
  const [todayMs, setTodayMs] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = await getToken();
        const today = toLocalDateString(new Date());

        const res = await fetch(
          `/api/watcher/daily?start_date=${today}&end_date=${today}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        if (res.ok) {
          const data = await res.json();
          if (data.days && data.days.length > 0) {
            setTodayMs(data.days[0].total_active_ms);
          }
        }
      } catch (e) {
        console.error('Failed to fetch:', e);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [getToken]);

  if (isLoading) {
    return (
      <div className={`bg-white border border-gray-200 p-3 ${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#FAFAF9] border border-gray-300 p-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Monitor className="w-4 h-4 text-indigo-600" />
        <span className="text-sm text-gray-700">Screen Time</span>
        <span className="ml-auto text-sm font-semibold text-gray-900">
          {formatDuration(todayMs)}
        </span>
      </div>
    </div>
  );
}
