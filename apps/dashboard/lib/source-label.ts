const SOURCE_LABEL_MAP: Record<string, string> = {
  ai_log_v2: 'Chat Log',
  ai_log_v2_fast: 'Chat Log',
  apple_health: 'Apple Health',
  csv_import: 'CSV Import',
  manual: 'Manual',
  ritual_watcher: 'Watcher',
  ritual_watcher_projection: 'Watcher',
  ritual_watcher_projection_v1: 'Watcher',
  whoop: 'Whoop',
};

const DEMO_SOURCE_BY_HABIT: Record<string, string> = {
  steps: 'Apple Health',
  'heart rate': 'Apple Health',
  'daily walk': 'Apple Health',
  'morning workout': 'Apple Health',
  'screen time': 'Apple Health',
  'sleep duration': 'Whoop',
  coding: 'Watcher',
  'computer time': 'Watcher',
  'daily reading': 'Manual',
  spending: 'Manual',
};

export type SourceFilterGroup = {
  id: string;
  label: string;
  rawValues: string[];
};

export function formatSourceLabel(
  value: string | null | undefined,
  habitName?: string,
): string {
  const normalizedValue = (value || 'manual').trim();
  const lookupKey = normalizedValue.toLowerCase();

  if (lookupKey === 'demo_seed_v1' && habitName) {
    const habitKey = habitName.trim().toLowerCase();
    return DEMO_SOURCE_BY_HABIT[habitKey] || 'Manual';
  }

  if (SOURCE_LABEL_MAP[lookupKey]) {
    return SOURCE_LABEL_MAP[lookupKey];
  }

  return normalizedValue
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower === 'ai') return 'AI';
      if (lower === 'csv') return 'CSV';
      if (lower === 'api') return 'API';
      if (lower === 'v1') return 'v1';
      if (lower === 'v2') return 'v2';
      if (lower === 'v3') return 'v3';
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}

export function groupSourcesByLabel(values: string[]): SourceFilterGroup[] {
  const groups = new Map<string, SourceFilterGroup>();

  values.forEach((value) => {
    const normalizedValue = (value || 'manual').trim();
    if (!normalizedValue) return;

    const label = formatSourceLabel(normalizedValue);
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = groups.get(id);

    if (existing) {
      if (!existing.rawValues.includes(normalizedValue)) {
        existing.rawValues.push(normalizedValue);
      }
      return;
    }

    groups.set(id, {
      id,
      label,
      rawValues: [normalizedValue],
    });
  });

  return Array.from(groups.values()).sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
  );
}

export function isSourceGroupSelected(
  rawValues: string[],
  selectedValues: string[] | null | undefined,
): boolean {
  if (!selectedValues?.length) return false;
  return rawValues.some((value) => selectedValues.includes(value));
}

export function toggleSourceGroup(
  rawValues: string[],
  selectedValues: string[] | null | undefined,
): string[] | null {
  const nextValues = new Set(selectedValues ?? []);
  const hasSelectedValue = rawValues.some((value) => nextValues.has(value));

  if (hasSelectedValue) {
    rawValues.forEach((value) => nextValues.delete(value));
  } else {
    rawValues.forEach((value) => nextValues.add(value));
  }

  return nextValues.size > 0 ? Array.from(nextValues) : null;
}
