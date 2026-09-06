import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TasksCategoryPills } from '../app/(dashboard)/tasks/tasks-filters';
import { TaskTodoList } from '../app/(dashboard)/tasks/tasks-todo-list';
import type { Task, TaskUpdateInput } from '../lib/tasks/types';

vi.mock('@/components/ui/calendar', () => ({
  Calendar: () => <div>Calendar stub</div>,
}));

function TodoHarness({
  tasks,
  onComplete = vi.fn(),
  onUpdate = vi.fn(),
  onOpen = vi.fn(),
}: {
  tasks: Task[];
  onComplete?: (task: Task) => void;
  onUpdate?: (id: string, patch: TaskUpdateInput) => void;
  onOpen?: (task: Task) => void;
}) {
  const [menuTaskId, setMenuTaskId] = React.useState<string | null>(null);
  return (
    <TaskTodoList
      tasks={tasks}
      menuTaskId={menuTaskId}
      onMenuTaskChange={setMenuTaskId}
      onComplete={onComplete}
      onUpdate={onUpdate}
      onOpen={onOpen}
    />
  );
}

const baseTask: Task = {
  id: 'task-1',
  user_id: 'user-1',
  title: 'Brush teeth',
  notes: null,
  status: 'open',
  priority: 'high',
  due_at: '2020-01-15T14:00:00.000Z',
  completed_at: null,
  source: 'manual',
  project: 'Health',
  category: 'Health',
  tags: [],
  routine_id: null,
  routine_run_id: null,
  linked_habit_id: null,
  linked_artifact_id: null,
  client_event_id: null,
  created_at: '2026-08-20T12:00:00Z',
  updated_at: '2026-08-20T12:00:00Z',
};

describe('todo task view', () => {
  it('offers table, todo, and board layouts and hides grouping in todo', async () => {
    const user = userEvent.setup();
    const onDisplayModeChange = vi.fn();
    render(
      <TasksCategoryPills
        category="All"
        onCategoryChange={vi.fn()}
        displayMode="todo"
        onDisplayModeChange={onDisplayModeChange}
        layoutMode="list"
        onLayoutModeChange={vi.fn()}
        view="today"
        onViewChange={vi.fn()}
        priorityFilter="all"
        onPriorityFilterChange={vi.fn()}
        sortMode="smart"
        onSortModeChange={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change task view' }));
    expect(screen.getByText('Table')).toBeInTheDocument();
    expect(screen.getByText('Todo')).toBeInTheDocument();
    expect(screen.getByText('Board')).toBeInTheDocument();
    expect(screen.queryByText('Grouping')).not.toBeInTheDocument();
    expect(screen.getByText('Ordering')).toBeInTheDocument();

    await user.click(screen.getByText('Table'));
    expect(onDisplayModeChange).toHaveBeenCalledWith('list');
  });

  it('renders grouped rows and exposes schedule, complete, and delete actions', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onUpdate = vi.fn();
    const onOpen = vi.fn();

    render(
      <TodoHarness
        tasks={[baseTask]}
        onComplete={onComplete}
        onUpdate={onUpdate}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Brush teeth')).toBeInTheDocument();
    expect(screen.getByText(/Health/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More options for Brush teeth' }));
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Complete task')).toBeInTheDocument();
    expect(screen.getByText('Set deadline today')).toBeInTheDocument();
    expect(screen.getByText('Deadline...')).toBeInTheDocument();
    expect(screen.getByText('Delete task')).toBeInTheDocument();

    await user.click(screen.getByText('Complete task'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('schedules a task for today from the row menu', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <TodoHarness
        tasks={[baseTask]}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'More options for Brush teeth' }));
    await user.click(await screen.findByText('Set deadline today'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate.mock.calls[0][0]).toBe('task-1');
    expect(onUpdate.mock.calls[0][1]).toEqual({ due_at: expect.any(String) });
  });
});
