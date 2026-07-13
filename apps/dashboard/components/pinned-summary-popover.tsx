"use client";

import { CalendarCheck, Pin, Plus, Repeat2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

const panelStyle: CSSProperties = {
  position: "fixed",
  top: 58,
  right: 24,
  zIndex: 70,
};

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
    <section className="border-t border-[rgba(31,35,40,0.075)] py-1.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-0.5 flex h-6 items-center justify-between">
        <div className="flex items-center gap-2 text-[13.5px] font-medium leading-none text-[#30302e]">
          <span className="flex h-4 w-4 items-center justify-center text-[#565855]">{icon}</span>
          <span>{title}</span>
          <span className="text-[13px] font-normal text-[#9b9a96]">{count}</span>
        </div>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded-sm text-[#a5a39e] hover:bg-[#f2f1ee] hover:text-[#6d6b66]"
          aria-label={`Add ${title.toLowerCase()}`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
      <div>{children}</div>
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
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-0.5 text-left",
        "hover:bg-[#f1f0ed] focus-visible:bg-[#f1f0ed] focus-visible:outline-none",
      )}
    >
      <span className="min-w-0">
        <span className={cn("block truncate text-[12.75px] font-medium leading-[15px]", muted ? "text-[#6f6e69]" : "text-[#2f302d]")}>
          {title}
        </span>
        <span className="block truncate text-[11.75px] leading-[13px] text-[#9b9a96]">{detail}</span>
      </span>
      <Pin className="h-[11px] w-[11px] text-[#b5b2ab]" strokeWidth={1.85} />
    </button>
  );
}

export function PinnedSummaryPopover() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <ToolbarButton
        type="button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="app-toolbar-icon-button"
        aria-label="Toggle pinned summary"
        aria-expanded={open}
        title="Toggle pinned summary"
      >
        <CodexPinnedSummaryIcon className="h-[18px] w-[18px]" />
      </ToolbarButton>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className={cn(
                "no-drag w-[292px] rounded-md border border-[rgba(31,35,40,0.1)]",
                "bg-white p-0 text-[#30302e] shadow-[0_18px_42px_rgba(28,25,18,0.13),0_3px_12px_rgba(28,25,18,0.08)]",
              )}
              style={panelStyle}
              role="dialog"
              aria-label="Pinned summary"
            >
              <div className="px-3.5 pb-2.5 pt-2.5">
                <div className="mb-1 flex h-8 items-start justify-between">
                  <div>
                    <h2 className="text-[14px] font-medium leading-[17px] text-[#2d2d2b]">Pinned</h2>
                    <p className="text-[12px] leading-[14px] text-[#9b9a96]">Today</p>
                  </div>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-sm text-[#a5a39e] hover:bg-[#f2f1ee] hover:text-[#6d6b66]"
                    aria-label="Add pinned item"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                </div>

                <div className="space-y-1">
                  <SummarySection title="Tasks" count={0} icon={<CodexPinnedSummaryIcon className="h-3.5 w-3.5" />}>
                    {taskRows.map((row) => (
                      <SummaryRow key={row.title} {...row} />
                    ))}
                  </SummarySection>

                  <SummarySection title="Routines" count={0} icon={<Repeat2 className="h-3.5 w-3.5" strokeWidth={1.9} />}>
                    {routineRows.map((row) => (
                      <SummaryRow key={row.title} {...row} />
                    ))}
                  </SummarySection>

                  <SummarySection title="Upcoming" count={0} icon={<CalendarCheck className="h-3.5 w-3.5" strokeWidth={1.9} />}>
                    <SummaryRow title="No pinned events" detail="Nothing scheduled" muted />
                  </SummarySection>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
