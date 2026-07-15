"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { listExperiments } from "@/lib/experiments";

export function SidebarExperiments() {
  const pathname = usePathname();
  const experimentsQuery = useQuery({
    queryKey: ["experiments", "sidebar"],
    queryFn: () => listExperiments(5),
    staleTime: 30_000,
  });

  return (
    <section className="mt-4 w-full px-[var(--sidebar-row-x)]" aria-labelledby="sidebar-experiments-heading">
      <div className="flex h-7 items-center px-[6px]">
        <h2
          id="sidebar-experiments-heading"
          className="truncate text-xs font-medium text-[var(--sidebar-nav-active)]"
        >
          Recent experiments
        </h2>
      </div>

      <Link
        href="/experiments?new=1"
        className="group/sidebar-experiment relative flex h-[30px] items-center rounded-[var(--radius-row)] hover:bg-[var(--row-hover)]"
      >
        <span className="ml-[6px] flex w-[var(--sidebar-icon-box)] shrink-0 items-center justify-center text-[var(--sidebar-nav-foreground)] group-hover/sidebar-experiment:text-[var(--sidebar-nav-active)]">
          <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        <span className="min-w-0 truncate text-sm font-normal text-[var(--sidebar-nav-foreground)] group-hover/sidebar-experiment:text-[var(--sidebar-nav-active)]">
          New experiment
        </span>
      </Link>

      {(experimentsQuery.data || []).map((experiment) => {
        const href = `/experiments/${experiment.id}`;
        const active = pathname === href;
        return (
          <Link
            key={experiment.id}
            href={href}
            className={`group/sidebar-experiment relative flex h-7 items-center rounded-[var(--radius-row)] pl-[46px] pr-2 hover:bg-[var(--row-hover)] ${active ? "bg-[var(--row-active)]" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className={`min-w-0 truncate text-sm font-normal ${active ? "text-[var(--sidebar-nav-active)]" : "text-[var(--sidebar-nav-foreground)] group-hover/sidebar-experiment:text-[var(--sidebar-nav-active)]"}`}>
              {experiment.title}
            </span>
          </Link>
        );
      })}
    </section>
  );
}
