"use client";

import { useEffect } from "react";
import { useDesktopAssetRecovery } from "@/lib/desktop-asset-recovery";

export function RouteErrorFallback({
  error,
  reset,
  source,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  source: string;
}) {
  const { errorText, isRecoverable, mode } = useDesktopAssetRecovery(error, source);
  const isRecovering = mode === "scheduled";
  const recoveryTried = mode === "cooldown";

  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold">
        {isRecovering ? "Refreshing application" : "Something went wrong"}
      </h2>
      <p className="max-w-xl text-sm text-muted-foreground">
        {isRecovering
          ? "Ritual detected a stale desktop asset mismatch and is reloading automatically."
          : recoveryTried
            ? "Ritual already attempted one automatic refresh for a stale desktop asset mismatch. If this screen stays here, reload once more."
            : (error.message || "An unexpected error occurred")}
      </p>
      {process.env.NODE_ENV === "development" && errorText ? (
        <pre className="max-w-3xl overflow-auto rounded-md bg-red-50 p-4 text-left text-xs text-red-700">
          {errorText}
        </pre>
      ) : null}
      <button
        onClick={() => {
          if (isRecoverable) {
            window.location.reload();
            return;
          }
          reset();
        }}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
      >
        {isRecovering ? "Reload now" : "Try again"}
      </button>
    </div>
  );
}
