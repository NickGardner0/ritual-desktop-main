'use client';

import { useState, useCallback, useEffect } from 'react';
import type {
  KanbanBoard as KanbanBoardType,
  KanbanCard,
  KanbanColumn,
} from '@/types/kanban';
import { DEFAULT_KANBAN_COLUMNS, ENERGY_COST_POINTS, LEGACY_COLUMN_MIGRATION } from '@/types/kanban';

const STORAGE_KEY_PREFIX = 'ritual-kanban';

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function loadBoard(userId: string): KanbanBoardType {
  if (typeof window === 'undefined') {
    return { columns: DEFAULT_KANBAN_COLUMNS, cards: [] };
  }
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return { columns: DEFAULT_KANBAN_COLUMNS, cards: [] };
    const parsed = JSON.parse(raw) as KanbanBoardType;
    // Migrate legacy column IDs to v0 IDs
    const cards = (parsed.cards ?? []).map((c: KanbanCard) => ({
      ...c,
      columnId: LEGACY_COLUMN_MIGRATION[c.columnId] ?? c.columnId,
    }));
    const legacyColIds = new Set(Object.keys(LEGACY_COLUMN_MIGRATION));
    const hasLegacyColumns = (parsed.columns ?? []).some((col: KanbanColumn) => legacyColIds.has(col.id));
    const columns = hasLegacyColumns || !parsed.columns?.length
      ? DEFAULT_KANBAN_COLUMNS
      : parsed.columns.sort((a: KanbanColumn, b: KanbanColumn) => a.order - b.order);
    return { columns, cards };
  } catch {
    return { columns: DEFAULT_KANBAN_COLUMNS, cards: [] };
  }
}

function saveBoard(userId: string, board: KanbanBoardType): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(board));
  } catch (e) {
    console.warn('Failed to save kanban board:', e);
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function useKanbanBoard(userId: string | undefined) {
  const [board, setBoard] = useState<KanbanBoardType>(() =>
    userId ? loadBoard(userId) : { columns: DEFAULT_KANBAN_COLUMNS, cards: [] }
  );

  useEffect(() => {
    if (!userId) return;
    setBoard(loadBoard(userId));
  }, [userId]);

  const persist = useCallback(
    (next: KanbanBoardType) => {
      setBoard(next);
      if (userId) saveBoard(userId, next);
    },
    [userId]
  );

  const addColumn = useCallback(
    (title: string) => {
      const id = `col-${generateId()}`;
      const order = Math.max(0, ...board.columns.map((c) => c.order + 1));
      const newCol: KanbanColumn = { id, title, order };
      persist({
        ...board,
        columns: [...board.columns, newCol].sort((a, b) => a.order - b.order),
      });
      return id;
    },
    [board, persist]
  );

  const updateColumn = useCallback(
    (columnId: string, updates: Partial<Pick<KanbanColumn, 'title' | 'order'>>) => {
      persist({
        ...board,
        columns: board.columns.map((c) =>
          c.id === columnId ? { ...c, ...updates } : c
        ),
      });
    },
    [board, persist]
  );

  const deleteColumn = useCallback(
    (columnId: string) => {
      const targetCol = board.columns.find((c) => c.id === columnId);
      const nextCol = board.columns.find(
        (c) => c.order === (targetCol?.order ?? 0) - 1
      ) ?? board.columns[0];
      const fallbackColId = nextCol?.id ?? board.columns[0]?.id;

      persist({
        ...board,
        columns: board.columns.filter((c) => c.id !== columnId),
        cards: board.cards.map((card) =>
          card.columnId === columnId ? { ...card, columnId: fallbackColId } : card
        ),
      });
    },
    [board, persist]
  );

  const reorderColumns = useCallback(
    (orderedIds: string[]) => {
      const colMap = new Map(board.columns.map((c) => [c.id, c]));
      const cols = orderedIds
        .map((id, index) => {
          const col = colMap.get(id);
          return col ? { ...col, order: index } : null;
        })
        .filter((c): c is KanbanColumn => c !== null);
      persist({ ...board, columns: cols });
    },
    [board, persist]
  );

  const addCard = useCallback(
    (
      columnId: string,
      data: Partial<Pick<KanbanCard, 'title' | 'description' | 'energyCost' | 'linkedMetricId' | 'linkedMetricTarget' | 'isRecurring' | 'recurrenceRule'>>
    ) => {
      const columnCards = board.cards.filter((c) => c.columnId === columnId);
      const order = columnCards.length
        ? Math.max(...columnCards.map((c) => c.order)) + 1
        : 0;
      const now = new Date().toISOString();
      const card: KanbanCard = {
        id: `card-${generateId()}`,
        title: data.title ?? 'Untitled',
        description: data.description,
        columnId,
        order,
        linkedMetricId: data.linkedMetricId,
        linkedMetricTarget: data.linkedMetricTarget,
        energyCost: data.energyCost ?? 'medium',
        streak: 0,
        isRecurring: data.isRecurring ?? false,
        recurrenceRule: data.recurrenceRule,
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      persist({
        ...board,
        cards: [...board.cards, card],
      });
      return card.id;
    },
    [board, persist]
  );

  const updateCard = useCallback(
    (cardId: string, updates: Partial<KanbanCard>) => {
      const now = new Date().toISOString();
      persist({
        ...board,
        cards: board.cards.map((c) =>
          c.id === cardId ? { ...c, ...updates, updatedAt: now } : c
        ),
      });
    },
    [board, persist]
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      persist({
        ...board,
        cards: board.cards.filter((c) => c.id !== cardId),
      });
    },
    [board, persist]
  );

  const moveCard = useCallback(
    (cardId: string, targetColumnId: string, newOrder?: number) => {
      const card = board.cards.find((c) => c.id === cardId);
      if (!card) return;

      const now = new Date().toISOString();
      const nextCard: KanbanCard = {
        ...card,
        columnId: targetColumnId,
        order: 0,
        updatedAt: now,
        ...(targetColumnId === 'complete' ? { completedAt: now } : {}),
      };

      const others = board.cards.filter((c) => c.id !== cardId);
      const sourceCol = others.filter((c) => c.columnId === card.columnId).sort((a, b) => a.order - b.order);
      const targetCol = others.filter((c) => c.columnId === targetColumnId).sort((a, b) => a.order - b.order);
      const otherCols = others.filter(
        (c) => c.columnId !== card.columnId && c.columnId !== targetColumnId
      );

      const insertAt = newOrder ?? targetCol.length;
      const newTargetCol = [...targetCol];
      newTargetCol.splice(Math.min(insertAt, newTargetCol.length), 0, nextCard);
      const renumberedTarget = newTargetCol.map((c, i) => ({ ...c, order: i }));

      const renumberedSource = sourceCol.map((c, i) => ({ ...c, order: i }));

      persist({
        ...board,
        cards: [...otherCols, ...renumberedSource, ...renumberedTarget],
      });
    },
    [board, persist]
  );

  const reorderCardsInColumn = useCallback(
    (columnId: string, orderedIds: string[]) => {
      const cardMap = new Map(board.cards.map((c) => [c.id, c]));
      persist({
        ...board,
        cards: board.cards.map((c) => {
          if (c.columnId !== columnId) return c;
          const idx = orderedIds.indexOf(c.id);
          if (idx < 0) return c;
          return { ...c, order: idx };
        }),
      });
    },
    [board, persist]
  );

  const getEnergyUsed = useCallback(() => {
    const activeColumnIds = ['todo', 'in-progress'];
    return board.cards
      .filter((c) => activeColumnIds.includes(c.columnId))
      .reduce((sum, c) => sum + ENERGY_COST_POINTS[c.energyCost], 0);
  }, [board.cards]);

  return {
    board,
    columns: board.columns,
    cards: board.cards,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
    reorderCardsInColumn,
    getEnergyUsed,
  };
}
