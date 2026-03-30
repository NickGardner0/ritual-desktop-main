/**
 * Screen time (iPhone) tool executor.
 *
 * Extracted from orchestrator.ts (lines 4850-4895) during Phase 1 refactoring.
 */

import { fetchPythonApi, getTimezoneYmd, shiftYmd } from './shared-api';

export async function executeGetScreenTimeSummary(
  token: string,
  params: { startDate?: string; endDate?: string; daysBack?: number; appLimit?: number },
  timezone?: string,
) {
  const today = getTimezoneYmd(new Date(), timezone);
  const daysBack = params.daysBack ?? 1;
  const startDate = params.startDate || shiftYmd(today, -(daysBack - 1));
  const endDate = params.endDate || today;
  const appLimit = params.appLimit ?? 10;
  console.log('📱 getScreenTimeSummary called:', { startDate, endDate, appLimit });

  try {
    const [summaryRes, appsRes] = await Promise.all([
      fetchPythonApi('/api/screen-time/stats/summary', token, {
        start_date: startDate,
        end_date: endDate,
      }),
      fetchPythonApi('/api/screen-time/stats/top-apps', token, {
        start_date: startDate,
        end_date: endDate,
        limit: appLimit,
      }),
    ]);

    const summaryData = summaryRes?.data || summaryRes || {};
    const appsData = appsRes?.data || appsRes || [];

    return JSON.stringify({
      success: true,
      start_date: startDate,
      end_date: endDate,
      total_active_ms: summaryData.total_active_ms ?? 0,
      is_connected: summaryData.is_connected ?? false,
      has_data: summaryData.has_data ?? false,
      daily: summaryData.daily || [],
      top_apps: Array.isArray(appsData) ? appsData : [],
    });
  } catch (error) {
    console.error('❌ getScreenTimeSummary error:', error);
    return JSON.stringify({
      success: false,
      error: 'Screen time data is currently unavailable. iPhone screen time may not be connected.',
    });
  }
}
