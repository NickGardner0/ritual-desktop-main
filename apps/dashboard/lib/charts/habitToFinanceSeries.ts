import type { FinancePoint } from "@/components/charts/PerplexityExpandedHabitChart";
import { parse, parseISO } from "date-fns";

/**
 * Input format from the existing chart data structure
 * This matches what getExpandedData() returns in metrics-view.tsx
 */
export type HabitChartPoint = {
  date: string; // "MMM d, yyyy" format
  shortDate: string; // "MMM d" format
  value: number;
  compValue?: number | null;
  unit?: string;
  compUnit?: string;
  sleepOnset?: string;
  sleepEnd?: string;
  time?: string;
  upValue?: number | null;
  downValue?: number | null;
};

/**
 * Simple habit point format (alternative input)
 */
export type SimpleHabitPoint = {
  t: number; // unix ms
  value: number;
  compValue?: number | null;
  volume?: number;
  sleepOnset?: string;
  sleepEnd?: string;
  time?: string;
};

/**
 * Parse a date string in "MMM d, yyyy" format to unix timestamp
 */
function parseDateString(dateStr: string): number {
  try {
    // Try parsing "MMM d, yyyy" format (e.g., "Jan 15, 2024")
    const parsed = parse(dateStr, "MMM d, yyyy", new Date());
    if (!isNaN(parsed.getTime())) {
      return parsed.getTime();
    }

    // Try ISO format as fallback
    const isoParsed = parseISO(dateStr);
    if (!isNaN(isoParsed.getTime())) {
      return isoParsed.getTime();
    }

    // Last resort: native Date parsing
    const nativeParsed = new Date(dateStr);
    if (!isNaN(nativeParsed.getTime())) {
      return nativeParsed.getTime();
    }

    return Date.now();
  } catch {
    return Date.now();
  }
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Convert habit chart data to finance-style OHLC format
 *
 * @param series - Array of habit chart points from getExpandedData()
 * @returns Array of FinancePoint for the Perplexity chart
 */
export function habitToFinanceSeries(series: HabitChartPoint[]): FinancePoint[] {
  if (!series || !series.length) return [];

  // Sort by date to ensure correct order
  const sorted = [...series].sort((a, b) => {
    const tA = parseDateString(a.date);
    const tB = parseDateString(b.date);
    return tA - tB;
  });

  return sorted.map((p, idx) => {
    const prev = sorted[idx - 1];
    const t = parseDateString(p.date);
    const close = p.value ?? 0;
    const open = prev ? (prev.value ?? close) : close;

    // High/low are derived from open/close
    // In a more sophisticated version, you could use intra-day data
    const high = Math.max(open, close);
    const low = Math.min(open, close);

    // Volume could be derived from duration, count, or other metrics
    // For now, we use 0 as habits don't have volume data
    const volume = 0;

    return {
      t,
      open,
      high,
      low,
      close,
      compareClose: toOptionalNumber(p.compValue),
      volume,
      sleepOnset: p.sleepOnset,
      sleepEnd: p.sleepEnd,
      time: p.time,
      unit: p.unit,
    };
  });
}

/**
 * Convert simple habit points to finance series
 * Use this when you have raw timestamp + value data
 */
export function simpleHabitToFinanceSeries(
  series: SimpleHabitPoint[]
): FinancePoint[] {
  if (!series || !series.length) return [];

  const sorted = [...series].sort((a, b) => a.t - b.t);

  return sorted.map((p, idx) => {
    const prev = sorted[idx - 1];
    const open = prev ? prev.value : p.value;
    const close = p.value;
    const high = Math.max(open, close);
    const low = Math.min(open, close);

    return {
      t: p.t,
      open,
      high,
      low,
      close,
      compareClose: toOptionalNumber(p.compValue),
      volume: p.volume ?? 0,
      sleepOnset: p.sleepOnset,
      sleepEnd: p.sleepEnd,
      time: p.time,
    };
  });
}

export default habitToFinanceSeries;
