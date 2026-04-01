/**
 * Calendar events tool executor.
 *
 * Extracted from orchestrator.ts (lines 4897-4956) during Phase 1 refactoring.
 */

import { fetchPythonApi, getTimezoneYmd } from './shared-api';

const CALENDAR_TIMEOUT_MS = 8000;

export async function executeGetCalendarEvents(
  token: string,
  params: { startDate?: string; endDate?: string },
  timezone?: string,
) {
  const today = getTimezoneYmd(new Date(), timezone);
  const startDate = params.startDate || today;
  const endDate = params.endDate || today;
  console.log('📅 getCalendarEvents called:', { startDate, endDate });

  try {
    const response = await fetchPythonApi('/api/calendar/scheduled-blocks', token, {
      start_date: startDate,
      end_date: endDate,
    }, { timeoutMs: CALENDAR_TIMEOUT_MS });

    const blocks = Array.isArray(response) ? response : (response?.data || response?.blocks || []);

    // Transform start_minutes/end_minutes to human-readable times
    const events = blocks.map((block: any) => {
      const startHour = Math.floor((block.start_minutes || 0) / 60);
      const startMin = (block.start_minutes || 0) % 60;
      const endHour = Math.floor((block.end_minutes || 0) / 60);
      const endMin = (block.end_minutes || 0) % 60;
      const fmtTime = (h: number, m: number) => {
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${h12}:${String(m).padStart(2, '0')} ${period}`;
      };

      return {
        title: block.title || 'Untitled',
        day: block.day || startDate,
        start_time: fmtTime(startHour, startMin),
        end_time: fmtTime(endHour, endMin),
        duration_minutes: (block.end_minutes || 0) - (block.start_minutes || 0),
      };
    });

    // Sort by start time
    events.sort((a: any, b: any) => {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return (a.start_time || '') < (b.start_time || '') ? -1 : 1;
    });

    return JSON.stringify({
      success: true,
      start_date: startDate,
      end_date: endDate,
      events,
      event_count: events.length,
    });
  } catch (error) {
    console.error('❌ getCalendarEvents error:', error);
    return JSON.stringify({
      success: false,
      error: 'Calendar data is currently unavailable.',
    });
  }
}
