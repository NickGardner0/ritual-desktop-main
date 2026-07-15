"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Plus } from "lucide-react";

import { listExperiments } from "@/lib/experiments";

export function SidebarExperiments() {
  const pathname = usePathname();
  const experimentsQuery = useQuery({
    queryKey: ["experiments", "sidebar"],
    queryFn: () => listExperiments(5),
    staleTime: 30_000,
  });

  return (
    <section className="flex w-full flex-col gap-1 px-[15px]" aria-label="Experiment shortcuts">
      <Link
        href="/experiments?new=1"
        className="group/sidebar-experiment relative flex h-[30px] items-center rounded-[var(--sidebar-row-radius)] hover:bg-[var(--row-hover)]"
      >
        <span className="flex w-10 shrink-0 items-center justify-center text-[var(--sidebar-nav-foreground)] group-hover/sidebar-experiment:text-[var(--sidebar-nav-active)]">
          <Plus className="h-[17px] w-[17px]" strokeWidth={2} />
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
            className="group/sidebar-experiment relative flex h-[30px] items-center rounded-[var(--sidebar-row-radius)] hover:bg-[var(--row-hover)]"
            aria-current={active ? "page" : undefined}
          >
            <span className="flex w-10 shrink-0 items-center justify-center text-[var(--sidebar-nav-foreground)] group-hover/sidebar-experiment:text-[var(--sidebar-nav-active)]">
              <FlaskConical className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <span className={`min-w-0 truncate text-sm font-normal ${active ? "text-[var(--sidebar-nav-active)]" : "text-[var(--sidebar-nav-foreground)] group-hover/sidebar-experiment:text-[var(--sidebar-nav-active)]"}`}>
              {experiment.title}
            </span>
          </Link>
        );
      })}
    </section>
  );
}
