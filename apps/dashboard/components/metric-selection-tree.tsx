'use client';

import { useState, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

interface MetricEntry {
  type: string;
  name: string;
  unit: string;
}

interface CategoryEntry {
  category: string;
  metrics: MetricEntry[];
}

interface MetricSelectionTreeProps {
  categories: CategoryEntry[];
  selected: Set<string>;
  onSave: (selected: string[]) => Promise<void>;
}

export function MetricSelectionTree({ categories, selected: initialSelected, onSave }: MetricSelectionTreeProps) {
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isDirty = useMemo(() => {
    if (selected.size !== initialSelected.size) return true;
    for (const t of selected) if (!initialSelected.has(t)) return true;
    return false;
  }, [selected, initialSelected]);

  const totalMetrics = useMemo(() => categories.reduce((n, c) => n + c.metrics.length, 0), [categories]);

  const filtered = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories
      .map(cat => ({
        ...cat,
        metrics: cat.metrics.filter(
          m => m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q) || cat.category.toLowerCase().includes(q),
        ),
      }))
      .filter(cat => cat.metrics.length > 0);
  }, [categories, search]);

  const toggleMetric = useCallback((type: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    setSaveResult(null);
  }, []);

  const toggleCategory = useCallback((cat: CategoryEntry) => {
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = cat.metrics.every(m => next.has(m.type));
      for (const m of cat.metrics) {
        if (allSelected) next.delete(m.type);
        else next.add(m.type);
      }
      return next;
    });
    setSaveResult(null);
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(categories.flatMap(c => c.metrics.map(m => m.type))));
    setSaveResult(null);
  }, [categories]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
    setSaveResult(null);
  }, []);

  const toggleCollapse = useCallback((category: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      await onSave(Array.from(selected));
      setSaveResult({ type: 'success', message: `Saved ${selected.size} metrics` });
    } catch (err: any) {
      setSaveResult({ type: 'error', message: err.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Header summary */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selected.size} of {totalMetrics} metrics selected
        </span>
        <div className="flex gap-2">
          <button onClick={selectAll} className="text-xs text-muted-foreground underline hover:text-foreground">
            Select all
          </button>
          <button onClick={deselectAll} className="text-xs text-muted-foreground underline hover:text-foreground">
            Deselect all
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-300"
          style={{ width: `${totalMetrics > 0 ? (selected.size / totalMetrics) * 100 : 0}%` }}
        />
      </div>

      {/* Search */}
      <Input
        type="text"
        placeholder="Search metrics..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="h-8 text-sm"
      />

      {/* Category tree */}
      <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
        {filtered.map(cat => {
          const catSelected = cat.metrics.filter(m => selected.has(m.type)).length;
          const allCatSelected = catSelected === cat.metrics.length;
          const someCatSelected = catSelected > 0 && !allCatSelected;
          const isCollapsed = collapsed.has(cat.category);

          return (
            <div key={cat.category} className="rounded-sm border border-border">
              {/* Category header */}
              <button
                onClick={() => toggleCollapse(cat.category)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f7f7f6]"
              >
                <span className="text-xs text-muted-foreground">{isCollapsed ? '▶' : '▼'}</span>
                <input
                  type="checkbox"
                  checked={allCatSelected}
                  ref={el => { if (el) el.indeterminate = someCatSelected; }}
                  onChange={e => { e.stopPropagation(); toggleCategory(cat); }}
                  onClick={e => e.stopPropagation()}
                  className="h-3.5 w-3.5 rounded-sm border-input text-foreground focus:ring-0"
                />
                <span className="flex-1 text-sm font-medium text-foreground">{cat.category}</span>
                <span className="text-xs text-muted-foreground">
                  {catSelected}/{cat.metrics.length}
                </span>
              </button>

              {/* Metric list */}
              {!isCollapsed && (
                <div className="border-t border-border px-3 py-1">
                  {cat.metrics.map(m => (
                    <label
                      key={m.type}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 hover:bg-[#f7f7f6]"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(m.type)}
                        onChange={() => toggleMetric(m.type)}
                        className="h-3.5 w-3.5 rounded-sm border-input text-foreground focus:ring-0"
                      />
                      <span className="flex-1 text-sm text-foreground">{m.name}</span>
                      {m.unit && <span className="text-xs text-muted-foreground">{m.unit}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save button */}
      <Button
        onClick={handleSave}
        disabled={saving || !isDirty}
        className="w-full"
      >
        {saving ? (
          <span className="flex items-center gap-2">
            <BrailleSpinner />
            Saving…
          </span>
        ) : isDirty ? (
          `Save (${selected.size} metrics)`
        ) : (
          'Saved'
        )}
      </Button>

      {/* Result */}
      {saveResult && (
        <p className={`text-xs ${saveResult.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
          {saveResult.message}
        </p>
      )}
    </div>
  );
}
