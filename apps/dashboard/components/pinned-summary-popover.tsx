"use client";

import { CalendarCheck, ListTodo, Pin, Plus, Repeat2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolbarButton } from "@/components/ui/ritual-system";
import { cn } from "@/lib/utils";

const taskRows = [
  { title: "Review today", detail: "Nothing pinned", muted: true },
  { title: "Next up", detail: "No active task", muted: true },
];

const routineRows = [
  { title: "Morning check-in", detail: "No pinned run", muted: true },
  { title: "Evening review", detail: "No pinned run", muted: true },
];

function SummarySection({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[rgba(31,35,40,0.075)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[15px] font-medium leading-none text-[#30302e]">
          <span className="flex h-6 w-6 items-center justify-center text-[#565855]">{icon}</span>
          <span>{title}</span>
          <span className="text-[13px] font-normal text-[#9b9a96]">{count}</span>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-[#a5a39e] hover:bg-[rgba(31,35,40,0.045)] hover:text-[#6d6b66]"
          aria-label={`Add ${title.toLowerCase()}`}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SummaryRow({
  title,
  detail,
  muted,
}: {
  title: string;
  detail: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2.5 py-2 text-left",
        "hover:bg-[rgba(31,35,40,0.045)] focus-visible:bg-[rgba(31,35,40,0.055)] focus-visible:outline-none",
      )}
    >
      <span className="min-w-0">
        <span className={cn("block truncate text-[14px] font-medium leading-5", muted ? "text-[#706f6a]" : "text-[#2f302d]")}>
          {title}
        </span>
        <span className="block truncate text-[12.5px] leading-4 text-[#9b9a96]">{detail}</span>
      </span>
      <Pin className="h-[14px] w-[14px] text-[#b5b2ab]" strokeWidth={1.9} />
    </button>
  );
}

export function PinnedSummaryPopover() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarButton
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="app-toolbar-icon-button"
          aria-label="Toggle pinned summary"
          title="Toggle pinned summary"
        >
          <ListTodo className="h-[17px] w-[17px]" strokeWidth={2} />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          "no-drag w-[336px] rounded-[22px] border border-[rgba(31,35,40,0.08)]",
          "bg-[#fbfaf7] p-0 text-[#30302e] shadow-[0_22px_58px_rgba(28,25,18,0.16),0_4px_16px_rgba(28,25,18,0.08)]",
          "data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="px-5 pb-4 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[18px] font-medium leading-6 text-[#2d2d2b]">Pinned</h2>
              <p className="text-[13px] leading-5 text-[#9b9a96]">Today</p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-sm text-[#a5a39e] hover:bg-[rgba(31,35,40,0.045)] hover:text-[#6d6b66]"
              aria-label="Add pinned item"
            >
              <Plus className="h-5 w-5" strokeWidth={1.8} />
            </button>
          </div>

          <div className="space-y-3">
            <SummarySection title="Tasks" count={0} icon={<ListTodo className="h-[17px] w-[17px]" strokeWidth={1.9} />}>
              {taskRows.map((row) => (
                <SummaryRow key={row.title} {...row} />
              ))}
            </SummarySection>

            <SummarySection title="Routines" count={0} icon={<Repeat2 className="h-[17px] w-[17px]" strokeWidth={1.9} />}>
              {routineRows.map((row) => (
                <SummaryRow key={row.title} {...row} />
              ))}
            </SummarySection>

            <SummarySection title="Upcoming" count={0} icon={<CalendarCheck className="h-[17px] w-[17px]" strokeWidth={1.9} />}>
              <SummaryRow title="No pinned events" detail="Nothing scheduled" muted />
            </SummarySection>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
