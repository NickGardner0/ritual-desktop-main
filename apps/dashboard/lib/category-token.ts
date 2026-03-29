export type CategoryFilterGroup = {
  id: string;
  label: string;
  rawValues: string[];
};

const CATEGORY_FILL_CLASS_MAP: Record<string, string> = {
  productivity: 'bg-slate-500',
  fitness: 'bg-stone-600',
  'fitness & health': 'bg-stone-600',
  education: 'bg-zinc-400',
  learning: 'bg-zinc-400',
  experiments: 'bg-neutral-500',
  health: 'bg-stone-400',
  wellness: 'bg-slate-400',
  custom: 'bg-neutral-300',
  manual: 'bg-stone-500',
  default: 'bg-neutral-300',
};

export function normalizeCategoryLabel(value: string | null | undefined): string {
  const normalizedValue = (value || 'custom').trim();
  if (!normalizedValue) return 'Custom';

  if (normalizedValue.toLowerCase() === 'fitness & health') {
    return 'Health';
  }

  return normalizedValue
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      if (token === '&') return '&';
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}

export function getCategoryFillClass(value: string | null | undefined): string {
  const normalizedValue = (value || 'default').trim().toLowerCase();
  return CATEGORY_FILL_CLASS_MAP[normalizedValue] || CATEGORY_FILL_CLASS_MAP.default;
}

export function groupCategoriesByLabel(values: string[]): CategoryFilterGroup[] {
  const groups = new Map<string, CategoryFilterGroup>();

  values.forEach((value) => {
    const normalizedValue = (value || 'custom').trim();
    if (!normalizedValue) return;

    const label = normalizeCategoryLabel(normalizedValue);
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

export function isCategoryGroupSelected(
  rawValues: string[],
  selectedValues: string[] | null | undefined,
): boolean {
  if (!selectedValues?.length) return false;
  return rawValues.some((value) => selectedValues.includes(value));
}

export function toggleCategoryGroup(
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
