import { COLUMN_SIZES, COLUMN_ORDER_STORAGE_KEY, COLUMN_RESIZE_STORAGE_KEY, DEFAULT_COLUMN_ORDER } from './constants';

// ── localStorage Helpers ───────────────────────────────────

export function readStoredColumnWidths(): Record<string, number> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(COLUMN_RESIZE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, number>;
    const next: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const sizes = COLUMN_SIZES[key];
      if (!sizes || !Number.isFinite(value)) continue;
      const clamped = Math.max(sizes.minSize, Math.min(sizes.maxSize, value));
      if (clamped !== sizes.size) {
        next[key] = clamped;
      }
    }

    return next;
  } catch {
    return {};
  }
}

export function readStoredColumnOrder(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(COLUMN_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Ensure all columns are included (safety net for new columns)
    const inOrder = new Set(parsed);
    const result = [...parsed];
    for (const id of DEFAULT_COLUMN_ORDER) {
      if (!inOrder.has(id)) result.push(id);
    }
    return result;
  } catch {
    return null;
  }
}
