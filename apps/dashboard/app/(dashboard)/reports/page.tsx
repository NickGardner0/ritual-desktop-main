import type { Metadata } from "next";
import { Suspense } from "react";

import { ReportsClient } from "./reports-client";

export const metadata: Metadata = {
  title: "Reports | Ritual",
  description: "Durable Ritual artifacts, routines, approvals, and run history.",
};

function ReportsSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="space-y-3">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-28 animate-pulse rounded-3xl border border-[rgba(15,23,42,0.08)] bg-white/75"
          />
        ))}
      </div>
      <div className="h-[520px] animate-pulse rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/75" />
    </div>
  );
}

export default function ReportsPage() {
  return (
    <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top_left,rgba(115,191,29,0.12),transparent_28%),linear-gradient(180deg,#f8fbf5_0%,#f4f6f3_42%,#f8faf8_100%)]">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <Suspense fallback={<ReportsSkeleton />}>
          <ReportsClient />
        </Suspense>
      </div>
    </div>
  );
}
