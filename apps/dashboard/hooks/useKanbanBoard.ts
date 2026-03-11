'use client';

import { useState, useCallback, useEffect } from 'react';
import type {
  KanbanBoard as KanbanBoardType,
  KanbanCard,
  KanbanChecklist,
  KanbanChecklistItem,
  KanbanColumn,
  KanbanComment,
  KanbanLabel,
  KanbanVisibility,
} from '@/types/kanban';
import {
  DEFAULT_KANBAN_COLUMNS,
  DEFAULT_KANBAN_META,
  ENERGY_COST_POINTS,
  LEGACY_COLUMN_MIGRATION,
} from '@/types/kanban';

const STORAGE_KEY_PREFIX = 'ritual-kanban';

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function generateId(prefix = 'id'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeActivity(message: string, type: KanbanCard['activity'][number]['type']) {
  return {
    id: generateId('activity'),
    type,
    message,
    createdAt: new Date().toISOString(),
  };
}

function buildDefaultBoard(): KanbanBoardType {
  return {
    meta: { ...DEFAULT_KANBAN_META, labels: [...DEFAULT_KANBAN_META.labels] },
    columns: DEFAULT_KANBAN_COLUMNS,
    cards: [],
  };
}

function normalizeChecklist(checklist: Partial<KanbanChecklist>, index: number): KanbanChecklist {
  return {
    id: checklist.id ?? generateId('checklist'),
    title: checklist.title?.trim() || `Checklist ${index + 1}`,
    items: (checklist.items ?? []).map((item, itemIndex) => normalizeChecklistItem(item, itemIndex)),
  };
}

function normalizeChecklistItem(
  item: Partial<KanbanChecklistItem>,
  order: number
): KanbanChecklistItem {
  return {
    id: item.id ?? generateId('item'),
    title: item.title?.trim() || 'Untitled item',
    completed: Boolean(item.completed),
    order: item.order ?? order,
  };
}

function normalizeComment(comment: Partial<KanbanComment>): KanbanComment {
  return {
    id: comment.id ?? generateId('comment'),
    body: comment.body?.trim() || '',
    createdAt: comment.createdAt ?? new Date().toISOString(),
  };
}

function normalizeCard(card: Partial<KanbanCard>): KanbanCard {
  const createdAt = card.createdAt ?? new Date().toISOString();
  const updatedAt = card.updatedAt ?? createdAt;

  return {
    id: card.id ?? generateId('card'),
    title: card.title?.trim() || 'Untitled',
    description: card.description?.trim() || undefined,
    columnId: LEGACY_COLUMN_MIGRATION[card.columnId ?? 'todo'] ?? card.columnId ?? 'todo',
    order: card.order ?? 0,
    linkedMetricId: card.linkedMetricId,
    linkedMetricTarget: card.linkedMetricTarget,
    energyCost: card.energyCost ?? 'medium',
    streak: card.streak ?? 0,
    isRecurring: card.isRecurring ?? false,
    recurrenceRule: card.recurrenceRule,
    scheduledTime: card.scheduledTime,
    dueDate: card.dueDate,
    tags: card.tags ?? [],
    labelIds: card.labelIds ?? [],
    checklists: (card.checklists ?? []).map(normalizeChecklist),
    comments: (card.comments ?? []).map(normalizeComment).filter((comment) => comment.body),
    activity:
      (card.activity ?? []).length > 0
        ? (card.activity ?? []).map((entry) => ({
            id: entry.id ?? generateId('activity'),
            type: entry.type ?? 'updated',
            message: entry.message ?? 'Card updated',
            createdAt: entry.createdAt ?? updatedAt,
          }))
        : [makeActivity('Card created', 'created')],
    reflection: card.reflection,
    completedAt: card.completedAt,
    createdAt,
    updatedAt,
  };
}

function normalizeBoard(rawBoard: Partial<KanbanBoardType> | null | undefined): KanbanBoardType {
  if (!rawBoard) return buildDefaultBoard();

  const columns =
    rawBoard.columns?.length
      ? rawBoard.columns
          .map((column, index) => ({
            id: LEGACY_COLUMN_MIGRATION[column.id] ?? column.id,
            title: column.title,
            order: column.order ?? index,
          }))
          .sort((a, b) => a.order - b.order)
      : DEFAULT_KANBAN_COLUMNS;

  const meta = {
    ...DEFAULT_KANBAN_META,
    ...(rawBoard.meta ?? {}),
    labels: rawBoard.meta?.labels?.length
      ? rawBoard.meta.labels.map((label: KanbanLabel) => ({
          id: label.id ?? generateId('label'),
          name: label.name,
          color: label.color ?? '#475569',
        }))
      : [...DEFAULT_KANBAN_META.labels],
  };

  const cards = (rawBoard.cards ?? [])
    .map((card) => normalizeCard(card))
    .sort((a, b) => a.order - b.order);

  return { meta, columns, cards };
}

function loadBoard(userId: string): KanbanBoardType {
  if (typeof window === 'undefined') {
    return buildDefaultBoard();
  }

  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return buildDefaultBoard();
    return normalizeBoard(JSON.parse(raw) as Partial<KanbanBoardType>);
  } catch {
    return buildDefaultBoard();
  }
}

function saveBoard(userId: string, board: KanbanBoardType): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(board));
  } catch (error) {
    console.warn('Failed to save kanban board:', error);
  }
}

function reorderCards(cards: KanbanCard[], columnId: string): KanbanCard[] {
  const columnCards = cards
    .filter((card) => card.columnId === columnId)
    .sort((a, b) => a.order - b.order)
    .map((card, index) => ({ ...card, order: index }));
  const otherCards = cards.filter((card) => card.columnId !== columnId);
  return [...otherCards, ...columnCards];
}

export function useKanbanBoard(userId: string | undefined) {
  const [board, setBoard] = useState<KanbanBoardType>(() =>
    userId ? loadBoard(userId) : buildDefaultBoard()
  );

  useEffect(() => {
    if (!userId) return;
    setBoard(loadBoard(userId));
  }, [userId]);

  const updateBoardState = useCallback(
    (updater: (current: KanbanBoardType) => KanbanBoardType) => {
      setBoard((current) => {
        const next = normalizeBoard(updater(current));
        if (userId) saveBoard(userId, next);
        return next;
      });
    },
    [userId]
  );

  const updateMeta = useCallback(
    (updates: Partial<KanbanBoardType['meta']>) => {
      updateBoardState((current) => ({
        ...current,
        meta: {
          ...current.meta,
          ...updates,
          labels: updates.labels ?? current.meta.labels,
        },
      }));
    },
    [updateBoardState]
  );

  const addBoardLabel = useCallback(
    (name: string, color: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) return null;

      const newLabel: KanbanLabel = {
        id: generateId('label'),
        name: trimmedName,
        color,
      };

      updateBoardState((current) => ({
        ...current,
        meta: {
          ...current.meta,
          labels: [...current.meta.labels, newLabel],
        },
      }));

      return newLabel;
    },
    [updateBoardState]
  );

  const addColumn = useCallback(
    (title: string) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return null;
      const id = generateId('column');

      updateBoardState((current) => ({
        ...current,
        columns: [
          ...current.columns,
          { id, title: trimmedTitle, order: current.columns.length },
        ],
      }));

      return id;
    },
    [updateBoardState]
  );

  const updateColumn = useCallback(
    (columnId: string, updates: Partial<Pick<KanbanColumn, 'title' | 'order'>>) => {
      updateBoardState((current) => ({
        ...current,
        columns: current.columns
          .map((column) =>
            column.id === columnId ? { ...column, ...updates } : column
          )
          .sort((a, b) => a.order - b.order),
      }));
    },
    [updateBoardState]
  );

  const deleteColumn = useCallback(
    (columnId: string) => {
      updateBoardState((current) => {
        if (current.columns.length <= 1) return current;

        const remainingColumns = current.columns.filter((column) => column.id !== columnId);
        const fallbackColumnId = remainingColumns[0]?.id ?? current.columns[0]?.id;

        return {
          ...current,
          columns: remainingColumns.map((column, index) => ({ ...column, order: index })),
          cards: current.cards.map((card) =>
            card.columnId === columnId ? { ...card, columnId: fallbackColumnId } : card
          ),
        };
      });
    },
    [updateBoardState]
  );

  const reorderColumns = useCallback(
    (orderedIds: string[]) => {
      updateBoardState((current) => {
        const columnMap = new Map(current.columns.map((column) => [column.id, column]));
        const columns = orderedIds
          .map((id, index) => {
            const column = columnMap.get(id);
            return column ? { ...column, order: index } : null;
          })
          .filter((column): column is KanbanColumn => column !== null);

        return { ...current, columns };
      });
    },
    [updateBoardState]
  );

  const addCard = useCallback(
    (
      columnId: string,
      data: Partial<
        Pick<
          KanbanCard,
          | 'title'
          | 'description'
          | 'energyCost'
          | 'linkedMetricId'
          | 'linkedMetricTarget'
          | 'isRecurring'
          | 'recurrenceRule'
          | 'scheduledTime'
          | 'dueDate'
          | 'labelIds'
        >
      >
    ) => {
      const now = new Date().toISOString();
      const cardId = generateId('card');

      updateBoardState((current) => {
        const order = current.cards.filter((card) => card.columnId === columnId).length;
        const newCard: KanbanCard = {
          id: cardId,
          title: data.title?.trim() || 'Untitled',
          description: data.description?.trim() || undefined,
          columnId,
          order,
          linkedMetricId: data.linkedMetricId,
          linkedMetricTarget: data.linkedMetricTarget,
          energyCost: data.energyCost ?? 'medium',
          streak: 0,
          isRecurring: data.isRecurring ?? false,
          recurrenceRule: data.recurrenceRule,
          scheduledTime: data.scheduledTime,
          dueDate: data.dueDate,
          tags: [],
          labelIds: data.labelIds ?? [],
          checklists: [],
          comments: [],
          activity: [makeActivity('Card created', 'created')],
          createdAt: now,
          updatedAt: now,
        };

        return {
          ...current,
          cards: [...current.cards, newCard],
        };
      });

      return cardId;
    },
    [updateBoardState]
  );

  const updateCard = useCallback(
    (cardId: string, updates: Partial<KanbanCard>, activityMessage?: string) => {
      const now = new Date().toISOString();

      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) => {
          if (card.id !== cardId) return card;

          const nextCard = {
            ...card,
            ...updates,
            updatedAt: now,
          };

          return {
            ...nextCard,
            activity: [
              ...nextCard.activity,
              makeActivity(activityMessage ?? 'Card updated', 'updated'),
            ],
          };
        }),
      }));
    },
    [updateBoardState]
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      updateBoardState((current) => ({
        ...current,
        cards: current.cards.filter((card) => card.id !== cardId),
      }));
    },
    [updateBoardState]
  );

  const moveCard = useCallback(
    (cardId: string, targetColumnId: string, newOrder?: number) => {
      updateBoardState((current) => {
        const card = current.cards.find((item) => item.id === cardId);
        if (!card) return current;

        const now = new Date().toISOString();
        const otherCards = current.cards.filter((item) => item.id !== cardId);
        const sourceCards = otherCards
          .filter((item) => item.columnId === card.columnId)
          .sort((a, b) => a.order - b.order);
        const targetCards = otherCards
          .filter((item) => item.columnId === targetColumnId)
          .sort((a, b) => a.order - b.order);
        const insertAt = newOrder ?? targetCards.length;

        const movedCard: KanbanCard = {
          ...card,
          columnId: targetColumnId,
          updatedAt: now,
          completedAt: targetColumnId === 'complete' ? now : undefined,
          activity: [
            ...card.activity,
            makeActivity(
              `Moved to ${
                current.columns.find((column) => column.id === targetColumnId)?.title ??
                'another list'
              }`,
              targetColumnId === 'complete' ? 'completed' : 'moved'
            ),
          ],
        };

        const nextTargetCards = [...targetCards];
        nextTargetCards.splice(Math.min(insertAt, nextTargetCards.length), 0, movedCard);

        const cards = [
          ...otherCards.filter(
            (item) => item.columnId !== card.columnId && item.columnId !== targetColumnId
          ),
          ...sourceCards.map((item, index) => ({ ...item, order: index })),
          ...nextTargetCards.map((item, index) => ({ ...item, order: index })),
        ];

        return { ...current, cards };
      });
    },
    [updateBoardState]
  );

  const reorderCardsInColumn = useCallback(
    (columnId: string, orderedIds: string[]) => {
      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) => {
          if (card.columnId !== columnId) return card;
          const order = orderedIds.indexOf(card.id);
          return order < 0 ? card : { ...card, order };
        }),
      }));
    },
    [updateBoardState]
  );

  const addComment = useCallback(
    (cardId: string, body: string) => {
      const trimmedBody = body.trim();
      if (!trimmedBody) return;

      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                comments: [
                  ...card.comments,
                  {
                    id: generateId('comment'),
                    body: trimmedBody,
                    createdAt: new Date().toISOString(),
                  },
                ],
                updatedAt: new Date().toISOString(),
                activity: [...card.activity, makeActivity('Added a comment', 'comment')],
              }
            : card
        ),
      }));
    },
    [updateBoardState]
  );

  const deleteComment = useCallback(
    (cardId: string, commentId: string) => {
      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                comments: card.comments.filter((comment) => comment.id !== commentId),
                updatedAt: new Date().toISOString(),
                activity: [...card.activity, makeActivity('Removed a comment', 'comment')],
              }
            : card
        ),
      }));
    },
    [updateBoardState]
  );

  const addChecklist = useCallback(
    (cardId: string, title: string) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return null;

      const checklistId = generateId('checklist');

      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklists: [
                  ...card.checklists,
                  { id: checklistId, title: trimmedTitle, items: [] },
                ],
                updatedAt: new Date().toISOString(),
                activity: [...card.activity, makeActivity('Added a checklist', 'checklist')],
              }
            : card
        ),
      }));

      return checklistId;
    },
    [updateBoardState]
  );

  const updateChecklistTitle = useCallback(
    (cardId: string, checklistId: string, title: string) => {
      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklists: card.checklists.map((checklist) =>
                  checklist.id === checklistId
                    ? { ...checklist, title: title.trim() || checklist.title }
                    : checklist
                ),
              }
            : card
        ),
      }));
    },
    [updateBoardState]
  );

  const deleteChecklist = useCallback(
    (cardId: string, checklistId: string) => {
      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklists: card.checklists.filter((checklist) => checklist.id !== checklistId),
                updatedAt: new Date().toISOString(),
                activity: [...card.activity, makeActivity('Removed a checklist', 'checklist')],
              }
            : card
        ),
      }));
    },
    [updateBoardState]
  );

  const addChecklistItem = useCallback(
    (cardId: string, checklistId: string, title: string) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return null;

      const itemId = generateId('item');

      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklists: card.checklists.map((checklist) =>
                  checklist.id === checklistId
                    ? {
                        ...checklist,
                        items: [
                          ...checklist.items,
                          {
                            id: itemId,
                            title: trimmedTitle,
                            completed: false,
                            order: checklist.items.length,
                          },
                        ],
                      }
                    : checklist
                ),
                updatedAt: new Date().toISOString(),
                activity: [...card.activity, makeActivity('Added a checklist item', 'checklist')],
              }
            : card
        ),
      }));

      return itemId;
    },
    [updateBoardState]
  );

  const toggleChecklistItem = useCallback(
    (cardId: string, checklistId: string, itemId: string) => {
      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklists: card.checklists.map((checklist) =>
                  checklist.id === checklistId
                    ? {
                        ...checklist,
                        items: checklist.items.map((item) =>
                          item.id === itemId
                            ? { ...item, completed: !item.completed }
                            : item
                        ),
                      }
                    : checklist
                ),
                updatedAt: new Date().toISOString(),
                activity: [...card.activity, makeActivity('Updated checklist progress', 'checklist')],
              }
            : card
        ),
      }));
    },
    [updateBoardState]
  );

  const deleteChecklistItem = useCallback(
    (cardId: string, checklistId: string, itemId: string) => {
      updateBoardState((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklists: card.checklists.map((checklist) =>
                  checklist.id === checklistId
                    ? {
                        ...checklist,
                        items: checklist.items
                          .filter((item) => item.id !== itemId)
                          .map((item, index) => ({ ...item, order: index })),
                      }
                    : checklist
                ),
                updatedAt: new Date().toISOString(),
                activity: [...card.activity, makeActivity('Removed a checklist item', 'checklist')],
              }
            : card
        ),
      }));
    },
    [updateBoardState]
  );

  const getEnergyUsed = useCallback(() => {
    const activeColumnIds = ['todo', 'in-progress', 'in-review'];
    return board.cards
      .filter((card) => activeColumnIds.includes(card.columnId))
      .reduce((sum, card) => sum + ENERGY_COST_POINTS[card.energyCost], 0);
  }, [board.cards]);

  return {
    board,
    meta: board.meta,
    columns: board.columns,
    cards: board.cards,
    updateMeta,
    addBoardLabel,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
    reorderCardsInColumn,
    addComment,
    deleteComment,
    addChecklist,
    updateChecklistTitle,
    deleteChecklist,
    addChecklistItem,
    toggleChecklistItem,
    deleteChecklistItem,
    getEnergyUsed,
  };
}
