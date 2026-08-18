"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardPlus,
  FileText,
  FlaskConical,
  ListTodo,
  Repeat2,
  SquarePen,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/ritual-system";

type CreateMenuItem = {
  id: string;
  label: string;
  shortcut: string;
  href: string;
  icon: LucideIcon;
};

const CREATE_MENU_ITEMS: CreateMenuItem[] = [
  {
    id: "log",
    label: "Log",
    shortcut: "L",
    href: "/dashboard?view=overview&compose=log",
    icon: ClipboardPlus,
  },
  {
    id: "task",
    label: "Task",
    shortcut: "T",
    href: "/tasks?create=1",
    icon: ListTodo,
  },
  {
    id: "routine",
    label: "Routine",
    shortcut: "R",
    href: "/routines?create=1",
    icon: Repeat2,
  },
  {
    id: "experiment",
    label: "Experiment",
    shortcut: "E",
    href: "/experiments?new=1",
    icon: FlaskConical,
  },
  {
    id: "report",
    label: "Report",
    shortcut: "P",
    href: "/reports?create=1",
    icon: FileText,
  },
];

export function CreateMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const selectItem = (item: CreateMenuItem) => {
    setOpen(false);
    router.push(item.href);
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const item = CREATE_MENU_ITEMS.find(
        (candidate) => candidate.shortcut.toLowerCase() === event.key.toLowerCase(),
      );
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();
      selectItem(item);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, router]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton
          type="button"
          className="ml-2 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-control)] text-[var(--icon-default)] shadow-sm hover:bg-[var(--surface-control-hover)] data-[state=open]:bg-[var(--surface-control-hover)]"
          aria-label="Create"
          title="Create"
        >
          <SquarePen className="h-[17px] w-[17px]" strokeWidth={1.9} />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[236px]"
        aria-label="Create"
      >
        {CREATE_MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.id}
              className="gap-2.5"
              onSelect={() => selectItem(item)}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--icon-default)]">
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="flex-1">{item.label}</span>
              <DropdownMenuShortcut className="ml-6 inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-1.5 text-[12px]">
                {item.shortcut}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
