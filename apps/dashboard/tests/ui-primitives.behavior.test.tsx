import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ritual/ui';
import { describe, expect, it, vi } from 'vitest';

describe('shared floating primitives', () => {
  it('traps dialog focus, exposes its accessible name and closes with Escape', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open settings</DialogTrigger>
        <DialogContent>
          <DialogTitle>Privacy settings</DialogTitle>
          <DialogDescription>Choose what Ritual stores.</DialogDescription>
          <button>First action</button>
          <button>Last action</button>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Privacy settings' });
    expect(dialog).toHaveAttribute('aria-describedby');

    await user.tab();
    await user.tab();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });

  it('supports keyboard navigation and selection in dropdown menus', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Archive</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menu')).toBeVisible());
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes a popover on an outside pointer interaction', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Popover>
          <PopoverTrigger>Open filters</PopoverTrigger>
          <PopoverContent>Filter controls</PopoverContent>
        </Popover>
        <button>Outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Open filters' }));
    expect(screen.getByText('Filter controls')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.queryByText('Filter controls')).toBeNull());
  });

  it('selects an option with the keyboard and preserves the shared visual classes', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select defaultValue="daily">
        <SelectTrigger aria-label="Cadence">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox', { name: 'Cadence' });
    trigger.focus();
    await user.keyboard('{Enter}{ArrowDown}{Enter}');
    expect(trigger).toHaveTextContent('Weekly');
    expect(trigger.className).toContain('focus:ring-2');
    expect(container.firstChild).toMatchSnapshot();
  });
});
