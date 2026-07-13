"use client";

import { CalendarCheck, Pin, Plus, Repeat2 } from "lucide-react";
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

function CodexPinnedSummaryIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="5" cy="5" r="1.35" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 5h6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="5" cy="10" r="1.35" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 10h6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="5" cy="15" r="1.35" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 15h6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

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
    <section className="border-t border-[rgba(31,35,40,0.075)] py-2 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[14px] font-medium leading-[18px] text-[#30302e]">
          <span className="flex h-[18px] w-[18px] items-center justify-center text-[#565855]">{icon}</span>
          <span>{title}</span>
          <span className="text-[13px] font-normal leading-[18px] text-[#9b9a96]">{count}</span>
        </div>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-sm text-[#a5a39e] hover:bg-[rgba(31,35,40,0.045)] hover:text-[#6d6b66]"
          aria-label={`Add ${title.toLowerCase()}`}
        >
          <Plus className="h-[15px] w-[15px]" strokeWidth={1.8} />
        </button>
      </div>
      <div className="space-y-px">{children}</div>
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
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-left",
        "hover:bg-[#f2f1ee] focus-visible:bg-[#f2f1ee] focus-visible:outline-none",
      )}
    >
      <span className="min-w-0">
        <span className={cn("block truncate text-[13px] font-medium leading-[16px]", muted ? "text-[#6f6e69]" : "text-[#2f302d]")}>
          {title}
        </span>
        <span className="block truncate text-[12px] leading-[14px] text-[#9b9a96]">{detail}</span>
      </span>
      <Pin className="h-3 w-3 text-[#b5b2ab]" strokeWidth={1.85} />
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
          <CodexPinnedSummaryIcon className="h-[18px] w-[18px]" />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          "no-drag !fixed !right-6 !top-[58px] !left-auto !translate-x-0 !translate-y-0 w-[292px] rounded-md border border-[rgba(31,35,40,0.1)]",
          "bg-white p-0 text-[#30302e] shadow-[0_18px_42px_rgba(28,25,18,0.13),0_3px_12px_rgba(28,25,18,0.08)]",
          "data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="px-3.5 pb-2.5 pt-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <div>
              <h2 className="text-[14.5px] font-medium leading-[18px] text-[#2d2d2b]">Pinned</h2>
              <p className="text-[12px] leading-[15px] text-[#9b9a96]">Today</p>
            </div>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded-sm text-[#a5a39e] hover:bg-[rgba(31,35,40,0.045)] hover:text-[#6d6b66]"
              aria-label="Add pinned item"
            >
              <Plus className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          </div>

          <div className="space-y-1.5">
            <SummarySection title="Tasks" count={0} icon={<CodexPinnedSummaryIcon className="h-[15px] w-[15px]" />}>
              {taskRows.map((row) => (
                <SummaryRow key={row.title} {...row} />
              ))}
            </SummarySection>

            <SummarySection title="Routines" count={0} icon={<Repeat2 className="h-[15px] w-[15px]" strokeWidth={1.9} />}>
              {routineRows.map((row) => (
                <SummaryRow key={row.title} {...row} />
              ))}
            </SummarySection>

            <SummarySection title="Upcoming" count={0} icon={<CalendarCheck className="h-[15px] w-[15px]" strokeWidth={1.9} />}>
              <SummaryRow title="No pinned events" detail="Nothing scheduled" muted />
            </SummarySection>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
