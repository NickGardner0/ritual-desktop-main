export interface MetricContextHabit {
  id?: string;
  name?: string;
  unit_type?: string | null;
  metric_type?: string | null;
  category?: string | null;
  integration_source?: string | null;
}

export interface MetricContextDisplayStats {
  unitLabel: string;
  sumFormatted: string;
  avgFormatted: string;
  minFormatted: string;
  maxFormatted: string;
  stdDevFormatted?: string;
  daysWithData?: number;
  trackedDays?: number;
}

export interface MetricContextDailySourceRow {
  date?: string;
  day?: string;
  local_date?: string;
  habit_id?: string;
  value?: number | string | null;
  daily_value?: number | string | null;
  total_value?: number | string | null;
  current_value?: number | string | null;
  total?: number | string | null;
  total_amount?: number | string | null;
  amount?: number | string | null;
  hours?: number | string | null;
  active_hours?: number | string | null;
  active_ms?: number | string | null;
  entries_count?: number | string | null;
  total_entries?: number | string | null;
  count?: number | string | null;
}

export interface MetricContextComputerUsageRow {
  app_name?: string;
  app_bundle_id?: string;
  domain?: string;
  hours?: number;
  total_active_ms?: number;
  total_events?: number;
}

export interface MetricContextPeerRows {
  habitId: string;
  habitName: string;
  unitLabel: string;
  rows: MetricContextDailySourceRow[];
}

export interface MetricContextSnapshot {
  totalLabel: string;
  averageLabel: string;
  minLabel: string;
  maxLabel: string;
  trackedDaysLabel: string;
  daysWithData: number;
  trackedDays: number;
}

export interface MetricContextDailyRow {
  date: string;
  label: string;
  value: number;
  displayValue: string;
  entryCount: number;
}

export interface MetricContextTrend {
  currentTotal: number;
  previousTotal: number;
  absoluteChange: number;
  percentChange: number | null;
  direction: 'up' | 'down' | 'flat';
  sentence: string;
  series: MetricContextDailyRow[];
}

export interface MetricContextRelatedSignal {
  label: string;
  value: string;
  detail: string;
}

export interface MetricContextInsight {
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'up' | 'down';
}

export interface MetricContextModel {
  habitId: string;
  title: string;
  valueLabel: string;
  unitLabel: string;
  periodLabel: string;
  analysisPeriodLabel: string;
  snapshot: MetricContextSnapshot;
  insightCards: MetricContextInsight[];
  trend: MetricContextTrend;
  recentRows: MetricContextDailyRow[];
  relatedSignals: MetricContextRelatedSignal[];
  sourceSignals: MetricContextRelatedSignal[];
  topApps: MetricContextRelatedSignal[];
  topDomains: MetricContextRelatedSignal[];
  askHref: string;
  emptyState?: string;
}

export interface MetricContextFetchWindow {
  startDate: string;
  endDate: string;
  currentStartDate: string;
  currentEndDate: string;
  previousStartDate: string;
  previousEndDate: string;
  mode: 'range' | 'recent';
  days: number;
}

export interface BuildMetricContextModelInput {
  habit: MetricContextHabit;
  displayValue: string;
  displayStats?: MetricContextDisplayStats;
  dateRange?: { from?: Date | string; to?: Date | string };
  dailyRows?: MetricContextDailySourceRow[];
  peerDailyRows?: MetricContextPeerRows[];
  computerDailyRows?: MetricContextDailySourceRow[];
  computerTopApps?: MetricContextComputerUsageRow[];
  computerTopDomains?: MetricContextComputerUsageRow[];
  currentDate?: Date | string;
  isComputerTime?: boolean;
}

function toDate(value: Date | string | undefined, fallback: Date): Date {
  if (!value) return new Date(fallback);
  if (value instanceof Date) return new Date(value);
  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(fallback);
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function getInclusiveDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const days = getInclusiveDays(startDate, endDate);
  return Array.from({ length: days }, (_, index) => shiftIsoDate(startDate, index));
}

export function getMetricContextFetchWindow(
  dateRange?: { from?: Date | string; to?: Date | string },
  currentDate: Date | string = new Date(),
): MetricContextFetchWindow {
  const now = toDate(currentDate, new Date());

  if (dateRange?.from) {
    const currentStartDate = toIsoDate(toDate(dateRange.from, now));
    const currentEndDate = toIsoDate(toDate(dateRange.to ?? dateRange.from, now));
    const days = getInclusiveDays(currentStartDate, currentEndDate);
    const previousEndDate = shiftIsoDate(currentStartDate, -1);
    const previousStartDate = shiftIsoDate(previousEndDate, -(days - 1));
    return {
      startDate: previousStartDate,
      endDate: currentEndDate,
      currentStartDate,
      currentEndDate,
      previousStartDate,
      previousEndDate,
      mode: 'range',
      days,
    };
  }

  const currentEndDate = toIsoDate(now);
  const currentStartDate = shiftIsoDate(currentEndDate, -6);
  const previousEndDate = shiftIsoDate(currentStartDate, -1);
  const previousStartDate = shiftIsoDate(previousEndDate, -6);
  return {
    startDate: previousStartDate,
    endDate: currentEndDate,
    currentStartDate,
    currentEndDate,
    previousStartDate,
    previousEndDate,
    mode: 'recent',
    days: 7,
  };
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getRowDate(row: MetricContextDailySourceRow): string | null {
  const raw = row.date || row.day || row.local_date;
  if (!raw) return null;
  return String(raw).slice(0, 10);
}

function getRowValue(row: MetricContextDailySourceRow): number {
  const direct = coerceNumber(
    row.value
      ?? row.daily_value
      ?? row.total_value
      ?? row.current_value
      ?? row.total
      ?? row.total_amount
      ?? row.amount
      ?? row.hours
      ?? row.active_hours,
  );
  if (direct !== null) return Math.max(0, direct);

  const activeMs = coerceNumber(row.active_ms);
  return activeMs !== null ? Math.max(0, activeMs / 3_600_000) : 0;
}

function getEntryCount(row: MetricContextDailySourceRow): number {
  return Math.max(0, Math.round(coerceNumber(row.entries_count ?? row.total_entries ?? row.count) ?? 0));
}

function buildDailyRows(
  sourceRows: MetricContextDailySourceRow[],
  startDate: string,
  endDate: string,
  unitLabel: string,
): MetricContextDailyRow[] {
  const byDate = new Map<string, { value: number; entryCount: number }>();

  for (const row of sourceRows) {
    const date = getRowDate(row);
    if (!date || date < startDate || date > endDate) continue;
    const previous = byDate.get(date) || { value: 0, entryCount: 0 };
    byDate.set(date, {
      value: previous.value + getRowValue(row),
      entryCount: previous.entryCount + getEntryCount(row),
    });
  }

  return enumerateDates(startDate, endDate).map((date) => {
    const entry = byDate.get(date) || { value: 0, entryCount: 0 };
    return {
      date,
      label: formatShortDate(date),
      value: entry.value,
      displayValue: formatValue(entry.value, unitLabel),
      entryCount: entry.entryCount,
    };
  });
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatShortDate(startDate);
  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

function formatUnitSuffix(unitLabel: string): string {
  const normalized = unitLabel.trim().toLowerCase();
  if (!normalized || normalized === 'count' || normalized === 'sessions') return '';
  if (normalized === 'hours') return ' Hours';
  if (normalized === 'minutes') return ' Minutes';
  if (normalized === 'bpm') return ' BPM';
  if (normalized === 'mg') return ' MG';
  if (normalized === 'percentage' || normalized === 'percent' || normalized === '%') return '%';
  return ` ${unitLabel}`;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) >= 1000) {
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (Number.isInteger(rounded)) return rounded.toLocaleString();
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatValue(value: number, unitLabel: string): string {
  return `${formatNumber(value)}${formatUnitSuffix(unitLabel)}`;
}

function summarizeRows(rows: MetricContextDailyRow[], unitLabel: string): MetricContextSnapshot {
  const values = rows.map((row) => row.value).filter((value) => Number.isFinite(value));
  const positiveValues = values.filter((value) => value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = positiveValues.length > 0 ? total / positiveValues.length : 0;
  const min = positiveValues.length > 0 ? Math.min(...positiveValues) : 0;
  const max = positiveValues.length > 0 ? Math.max(...positiveValues) : 0;
  const daysWithData = positiveValues.length;
  const trackedDays = rows.length;

  return {
    totalLabel: formatValue(total, unitLabel),
    averageLabel: formatValue(average, unitLabel),
    minLabel: formatValue(min, unitLabel),
    maxLabel: formatValue(max, unitLabel),
    trackedDaysLabel: `${daysWithData.toLocaleString()} / ${trackedDays.toLocaleString()}`,
    daysWithData,
    trackedDays,
  };
}

function getPositiveRows(rows: MetricContextDailyRow[]): MetricContextDailyRow[] {
  return rows.filter((row) => Number.isFinite(row.value) && row.value > 0);
}

function snapshotFromDisplayStats(
  displayStats: MetricContextDisplayStats | undefined,
  fallbackUnit: string,
): MetricContextSnapshot {
  return {
    totalLabel: displayStats?.sumFormatted || formatValue(0, fallbackUnit),
    averageLabel: displayStats?.avgFormatted || formatValue(0, fallbackUnit),
    minLabel: displayStats?.minFormatted || formatValue(0, fallbackUnit),
    maxLabel: displayStats?.maxFormatted || formatValue(0, fallbackUnit),
    trackedDaysLabel: `${Number(displayStats?.daysWithData || 0).toLocaleString()} / ${Number(displayStats?.trackedDays || displayStats?.daysWithData || 0).toLocaleString()}`,
    daysWithData: Number(displayStats?.daysWithData || 0),
    trackedDays: Number(displayStats?.trackedDays || displayStats?.daysWithData || 0),
  };
}

function buildTrend(
  title: string,
  currentRows: MetricContextDailyRow[],
  previousRows: MetricContextDailyRow[],
  unitLabel: string,
  window: MetricContextFetchWindow,
): MetricContextTrend {
  const currentTotal = currentRows.reduce((sum, row) => sum + row.value, 0);
  const previousTotal = previousRows.reduce((sum, row) => sum + row.value, 0);
  const absoluteChange = currentTotal - previousTotal;
  const percentChange = previousTotal > 0 ? (absoluteChange / previousTotal) * 100 : null;
  const tolerance = Math.max(Math.abs(currentTotal), Math.abs(previousTotal), 1) * 0.01;
  const direction: MetricContextTrend['direction'] =
    Math.abs(absoluteChange) <= tolerance ? 'flat' : absoluteChange > 0 ? 'up' : 'down';
  const currentLabel = window.mode === 'recent' ? 'past 7 days' : formatRangeLabel(window.currentStartDate, window.currentEndDate);
  const previousLabel = window.mode === 'recent' ? 'previous 7 days' : formatRangeLabel(window.previousStartDate, window.previousEndDate);

  let sentence: string;
  if (currentTotal === 0 && previousTotal === 0) {
    sentence = `No ${title} data in the ${currentLabel} or ${previousLabel}.`;
  } else if (previousTotal === 0) {
    sentence = `${title} is ${formatValue(currentTotal, unitLabel)} in the ${currentLabel}; there is no matching data in the ${previousLabel}.`;
  } else if (direction === 'flat') {
    sentence = `${title} is roughly flat: ${formatValue(currentTotal, unitLabel)} in the ${currentLabel} vs ${formatValue(previousTotal, unitLabel)} in the ${previousLabel}.`;
  } else {
    const pct = percentChange === null ? '' : ` (${percentChange > 0 ? '+' : ''}${Math.round(percentChange)}%)`;
    sentence = `${title} is ${direction === 'up' ? 'up' : 'down'}${pct}: ${formatValue(currentTotal, unitLabel)} in the ${currentLabel} vs ${formatValue(previousTotal, unitLabel)} in the ${previousLabel}.`;
  }

  return {
    currentTotal,
    previousTotal,
    absoluteChange,
    percentChange,
    direction,
    sentence,
    series: currentRows,
  };
}

function buildUsageSignals(
  rows: MetricContextComputerUsageRow[] | undefined,
  kind: 'app' | 'domain',
): MetricContextRelatedSignal[] {
  return (rows || [])
    .slice(0, 5)
    .map((row) => {
      const hours = Number(row.hours ?? (row.total_active_ms ? row.total_active_ms / 3_600_000 : 0));
      const name = kind === 'app'
        ? row.app_name || row.app_bundle_id || 'Unknown'
        : row.domain || 'Unknown';
      return {
        label: name,
        value: formatValue(Math.max(0, hours), 'Hours'),
        detail: `${Math.max(0, Number(row.total_events || 0)).toLocaleString()} events`,
      };
    });
}

function normalizeSourceLabel(value?: string | null): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Manual';
  const known: Record<string, string> = {
    apple_health: 'Apple Health',
    whoop: 'WHOOP',
    oura: 'Oura',
    garmin: 'Garmin',
    fitbit: 'Fitbit',
    watcher: 'Ritual Watcher',
    browser_extension: 'Browser Extension',
    manual: 'Manual',
  };
  return known[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildSourceSignals(
  input: BuildMetricContextModelInput,
  currentRows: MetricContextDailyRow[],
  isComputerTime: boolean,
): MetricContextRelatedSignal[] {
  const positiveRows = getPositiveRows(currentRows);
  const rawRows = isComputerTime ? input.computerDailyRows || [] : input.dailyRows || [];
  const source = isComputerTime
    ? 'Ritual Watcher'
    : normalizeSourceLabel(input.habit.integration_source);
  const sourceDetail = isComputerTime
    ? 'Desktop activity snapshots'
    : input.habit.integration_source
      ? 'Connected source'
      : 'Habit logs and imports';

  return [
    {
      label: 'Source',
      value: source,
      detail: sourceDetail,
    },
    {
      label: 'Rows',
      value: rawRows.length.toLocaleString(),
      detail: `${positiveRows.length.toLocaleString()} days with data in view`,
    },
    {
      label: 'Window',
      value: `${currentRows.length.toLocaleString()} days`,
      detail: currentRows.length === 1 ? 'Single-day context' : 'Analysis range',
    },
  ];
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function buildInsightCards(
  title: string,
  currentRows: MetricContextDailyRow[],
  previousRows: MetricContextDailyRow[],
  trend: MetricContextTrend,
): MetricContextInsight[] {
  const positiveRows = getPositiveRows(currentRows);
  const previousPositiveRows = getPositiveRows(previousRows);
  const trackedDays = currentRows.length;
  const coveragePct = trackedDays > 0 ? (positiveRows.length / trackedDays) * 100 : 0;
  const highest = positiveRows.length > 0
    ? positiveRows.reduce((best, row) => (row.value > best.value ? row : best), positiveRows[0]!)
    : null;
  const latest = positiveRows[positiveRows.length - 1] || null;
  const cards: MetricContextInsight[] = [];

  const changeLabel = trend.percentChange === null
    ? trend.absoluteChange === 0 ? 'No change' : trend.direction === 'up' ? 'New data' : 'No prior data'
    : formatPercent(trend.percentChange);
  cards.push({
    label: 'Change',
    value: changeLabel,
    detail: previousPositiveRows.length > 0
      ? `${trend.direction === 'flat' ? 'Roughly flat' : trend.direction === 'up' ? 'Higher' : 'Lower'} than the prior matching window`
      : 'No prior matching rows to compare',
    tone: trend.direction === 'flat' ? 'neutral' : trend.direction,
  });

  cards.push({
    label: 'Consistency',
    value: `${positiveRows.length} / ${trackedDays}`,
    detail: `${Math.round(coveragePct)}% of days in this window have ${title} data`,
    tone: coveragePct >= 70 ? 'up' : coveragePct <= 30 ? 'down' : 'neutral',
  });

  cards.push({
    label: 'Peak Day',
    value: highest ? highest.displayValue : 'None',
    detail: highest ? highest.label : 'No logged peak in this window',
    tone: 'neutral',
  });

  cards.push({
    label: 'Latest',
    value: latest ? latest.displayValue : 'None',
    detail: latest ? latest.label : 'No recent logged day in this window',
    tone: 'neutral',
  });

  return cards;
}

function buildRelatedSignals(
  currentRows: MetricContextDailyRow[],
  peerDailyRows: MetricContextPeerRows[] | undefined,
  unitLabel: string,
  title: string,
  window: MetricContextFetchWindow,
): MetricContextRelatedSignal[] {
  const positiveRows = getPositiveRows(currentRows);
  const signals: MetricContextRelatedSignal[] = [];

  const highest = positiveRows.length > 0
    ? positiveRows.reduce((best, row) => (row.value > best.value ? row : best), positiveRows[0]!)
    : null;

  if (highest) {
    signals.push({
      label: 'Highest day',
      value: highest.displayValue,
      detail: highest.label,
    });
  }

  if (positiveRows.length > 1) {
    const lowest = positiveRows.reduce((best, row) => (row.value < best.value ? row : best), positiveRows[0]!);
    signals.push({
      label: 'Lowest logged day',
      value: lowest.displayValue,
      detail: lowest.label,
    });
  }

  signals.push({
    label: 'Coverage',
    value: `${positiveRows.length.toLocaleString()} days`,
    detail: `${currentRows.length.toLocaleString()} day window`,
  });

  if (peerDailyRows?.length) {
    const sortedPositiveRows = [...positiveRows].sort((left, right) => right.value - left.value);
    const sampleSize = Math.max(1, Math.ceil(sortedPositiveRows.length / 3));
    const highDateSet = new Set(sortedPositiveRows.slice(0, sampleSize).map((row) => row.date));
    const lowDateSet = new Set(sortedPositiveRows.slice(-sampleSize).map((row) => row.date));

    for (const peer of peerDailyRows) {
      const peerRows = buildDailyRows(peer.rows, window.currentStartDate, window.currentEndDate, peer.unitLabel);
      const peerRowsByDate = new Map(peerRows.map((row) => [row.date, row]));
      const overlappingDays = positiveRows.filter((row) => (peerRowsByDate.get(row.date)?.value || 0) > 0);

      if (highest) {
        const peerHighestDay = peerRowsByDate.get(highest.date);
        if (peerHighestDay && peerHighestDay.value > 0) {
          signals.push({
            label: peer.habitName,
            value: peerHighestDay.displayValue,
            detail: `Also logged on ${title}'s highest day (${highest.label})`,
          });
        }
      }

      if (signals.length >= 7) break;
      if (overlappingDays.length >= 2) {
        signals.push({
          label: peer.habitName,
          value: `${overlappingDays.length.toLocaleString()} days`,
          detail: `Appeared on logged ${title} days in this window`,
        });
      }

      if (signals.length >= 7 || highDateSet.size === 0 || lowDateSet.size === 0) break;
      const highPeerValues = peerRows
        .filter((row) => highDateSet.has(row.date) && row.value > 0)
        .map((row) => row.value);
      const lowPeerValues = peerRows
        .filter((row) => lowDateSet.has(row.date) && row.value > 0)
        .map((row) => row.value);
      if (highPeerValues.length === 0 || lowPeerValues.length === 0) continue;

      const highAvg = highPeerValues.reduce((sum, value) => sum + value, 0) / highPeerValues.length;
      const lowAvg = lowPeerValues.reduce((sum, value) => sum + value, 0) / lowPeerValues.length;
      const larger = Math.max(highAvg, lowAvg);
      const smaller = Math.min(highAvg, lowAvg);
      if (larger <= 0 || (larger - smaller) / larger < 0.2) continue;

      signals.push({
        label: peer.habitName,
        value: formatValue(highAvg, peer.unitLabel),
        detail: highAvg > lowAvg
          ? `Higher on ${title}'s higher days than lower days`
          : `Lower on ${title}'s higher days than lower days`,
      });
      if (signals.length >= 5) break;
    }
  }

  return signals.slice(0, 7);
}

function getHabitTitle(habit: MetricContextHabit): string {
  return String(habit.name || 'Metric').trim() || 'Metric';
}

function getUnitLabel(habit: MetricContextHabit, displayStats?: MetricContextDisplayStats, isComputerTime?: boolean): string {
  if (isComputerTime) return 'Hours';
  return habit.unit_type || displayStats?.unitLabel || 'sessions';
}

function buildAskHref(title: string, periodLabel: string, analysisPeriodLabel: string): string {
  const question = periodLabel === 'All time'
    ? `Analyze my ${title}. Use the all-time total as context and focus on what changed in the ${analysisPeriodLabel}.`
    : `Analyze my ${title} for ${periodLabel}. Focus on what changed, recent trend, and related signals.`;
  return `/chat?q=${encodeURIComponent(question)}`;
}

export function buildMetricContextModel(input: BuildMetricContextModelInput): MetricContextModel {
  const title = getHabitTitle(input.habit);
  const habitId = String(input.habit.id || '');
  const isComputerTime = Boolean(input.isComputerTime);
  const unitLabel = getUnitLabel(input.habit, input.displayStats, isComputerTime);
  const window = getMetricContextFetchWindow(input.dateRange, input.currentDate);
  const sourceRows = isComputerTime ? input.computerDailyRows || [] : input.dailyRows || [];
  const currentRows = buildDailyRows(sourceRows, window.currentStartDate, window.currentEndDate, unitLabel);
  const previousRows = buildDailyRows(sourceRows, window.previousStartDate, window.previousEndDate, unitLabel);
  const hasSelectedRange = Boolean(input.dateRange?.from);
  const periodLabel = hasSelectedRange
    ? formatRangeLabel(window.currentStartDate, window.currentEndDate)
    : 'All time';
  const analysisPeriodLabel = window.mode === 'recent'
    ? 'past 7 days'
    : formatRangeLabel(window.currentStartDate, window.currentEndDate);
  const useDisplaySnapshot = !hasSelectedRange && input.displayStats;
  const snapshot = useDisplaySnapshot
    ? snapshotFromDisplayStats(input.displayStats, unitLabel)
    : summarizeRows(currentRows, unitLabel);
  const trend = buildTrend(title, currentRows, previousRows, unitLabel, window);
  const recentRows = currentRows
    .filter((row) => row.value > 0)
    .slice()
    .reverse()
    .slice(0, 7);
  const emptyState = currentRows.every((row) => row.value <= 0)
    ? `No ${title} rows found for the ${analysisPeriodLabel}.`
    : undefined;

  return {
    habitId,
    title,
    valueLabel: input.displayValue || snapshot.totalLabel,
    unitLabel,
    periodLabel,
    analysisPeriodLabel,
    snapshot,
    insightCards: buildInsightCards(title, currentRows, previousRows, trend),
    trend,
    recentRows,
    relatedSignals: buildRelatedSignals(currentRows, input.peerDailyRows, unitLabel, title, window),
    sourceSignals: buildSourceSignals(input, currentRows, isComputerTime),
    topApps: isComputerTime ? buildUsageSignals(input.computerTopApps, 'app') : [],
    topDomains: isComputerTime ? buildUsageSignals(input.computerTopDomains, 'domain') : [],
    askHref: buildAskHref(title, periodLabel, analysisPeriodLabel),
    emptyState,
  };
}
