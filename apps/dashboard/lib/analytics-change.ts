export const MAX_MEANINGFUL_PERCENT_CHANGE = 999;

export function getMeaningfulChangeBaseline(unit?: string | null): number {
  const normalized = (unit || '').toLowerCase();

  if (normalized.includes('hour')) return 0.25;
  if (normalized.includes('minute')) return 5;
  if (normalized.includes('mile')) return 0.1;
  if (normalized.includes('dollar')) return 1;
  if (normalized.includes('bpm')) return 1;
  if (normalized.includes('milligram') || normalized === 'mg') return 1;
  if (normalized.includes('page')) return 1;
  if (normalized.includes('step')) return 1;
  if (normalized.includes('count')) return 1;

  return 1;
}

export function computeMeaningfulPercentChange(
  currentValue: number,
  previousValue: number,
  unit?: string | null,
  overrideBaseline?: number,
): number | undefined {
  const current = Number(currentValue) || 0;
  const previous = Number(previousValue) || 0;
  const minBaseline = overrideBaseline ?? getMeaningfulChangeBaseline(unit);

  const absCurrent = Math.abs(current);
  const absPrevious = Math.abs(previous);

  if (absPrevious < minBaseline) {
    return absCurrent < minBaseline ? 0 : undefined;
  }

  const rawChange = ((current - previous) / absPrevious) * 100;
  if (!Number.isFinite(rawChange)) return undefined;

  return Math.max(-100, Math.min(MAX_MEANINGFUL_PERCENT_CHANGE, rawChange));
}
