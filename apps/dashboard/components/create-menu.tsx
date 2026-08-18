"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SquarePen } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/ritual-system";
import {
  SidebarExperimentIcon,
  SidebarLogIcon,
  SidebarReportIcon,
  SidebarRoutineIcon,
  SidebarTaskIcon,
  type SidebarIconProps,
} from "@/components/sidebar-icons";
import { cn } from "@/lib/utils";

type CreateMenuItem = {
  id: string;
  label: string;
  shortcut: string;
  href: string;
  icon: React.ComponentType<SidebarIconProps>;
};

const CREATE_MENU_ITEMS: CreateMenuItem[] = [
  {
    id: "log",
    label: "Log",
    shortcut: "L",
    href: "/dashboard?view=overview&compose=log",
    icon: SidebarLogIcon,
  },
  {
    id: "task",
    label: "Task",
    shortcut: "T",
    href: "/tasks?create=1",
    icon: SidebarTaskIcon,
  },
  {
    id: "routine",
    label: "Routine",
    shortcut: "R",
    href: "/routines?create=1",
    icon: SidebarRoutineIcon,
  },
  {
    id: "experiment",
    label: "Experiment",
    shortcut: "E",
    href: "/experiments?new=1",
    icon: SidebarExperimentIcon,
  },
  {
    id: "report",
    label: "Report",
    shortcut: "P",
    href: "/reports?create=1",
    icon: SidebarReportIcon,
  },
];

type CreateMenuProps = {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  triggerClassName?: string;
};

export function CreateMenu({ align = "start", side = "bottom", triggerClassName }: CreateMenuProps) {
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
          className={cn(
            "ml-2 rounded-[9px] border border-[var(--border-subtle)] bg-[var(--surface-control)] text-[var(--icon-default)] shadow-sm hover:bg-[var(--surface-control-hover)] data-[state=open]:bg-[var(--surface-control-hover)]",
            triggerClassName,
          )}
          aria-label="Create"
          title="Create"
        >
          <SquarePen className="h-[17px] w-[17px]" strokeWidth={1.9} />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={6}
        collisionPadding={8}
        className="w-[248px]"
        aria-label="Create"
      >
        {CREATE_MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.id}
              className="gap-3"
              onSelect={() => selectItem(item)}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--icon-default)]">
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} aria-hidden="true" />
              </span>
              <span className="flex-1">{item.label}</span>
              <DropdownMenuShortcut className="ml-6 inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-[var(--border-floating)] bg-transparent px-1 text-[11px] text-[var(--text-muted)]">
                {item.shortcut}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
