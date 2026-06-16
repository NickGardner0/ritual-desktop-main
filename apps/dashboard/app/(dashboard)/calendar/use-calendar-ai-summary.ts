import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  aggregateTooltipMetrics,
  formatTooltipMetricName,
  formatTooltipMetricValue,
} from './calendar-client.helpers';
import type { HabitLog } from './tracker-events';

export function useCalendarAiSummary(
  selectedDate: string | null,
  logsPending: boolean,
  logsByDate: Map<string, HabitLog[]>,
) {
  const { getToken } = useAuth();
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Abort any previous stream
    aiAbortRef.current?.abort();
    queueMicrotask(() => {
      setAiSummary('');
      setAiSummaryLoading(false);
    });

    if (!selectedDate || logsPending) return;

    const controller = new AbortController();
    aiAbortRef.current = controller;

    const dayLogs = logsByDate.get(selectedDate) || [];
    const dayMetrics = aggregateTooltipMetrics(dayLogs);

    // Build simple metrics array for the API
    const metricsPayload = dayMetrics.map((m) => ({
      name: formatTooltipMetricName(m),
      value: formatTooltipMetricValue(m),
    }));

    queueMicrotask(() => setAiSummaryLoading(true));

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/calendar/summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            date: selectedDate,
            habitMetrics: metricsPayload,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          console.error('AI summary fetch failed:', res.status, res.statusText);
          setAiSummary('');
          setAiSummaryLoading(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setAiSummary(full);
        }

        setAiSummaryLoading(false);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('AI summary error:', err);
        }
        setAiSummaryLoading(false);
      }
    })();

    return () => controller.abort();
  }, [getToken, logsByDate, logsPending, selectedDate]);

  return { aiSummary, aiSummaryLoading };
}
