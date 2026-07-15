import { Suspense } from "react";

import { ExperimentsClient } from "./experiments-client";

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--text-muted)]">Loading experiments…</div>}>
      <ExperimentsClient />
    </Suspense>
  );
}
