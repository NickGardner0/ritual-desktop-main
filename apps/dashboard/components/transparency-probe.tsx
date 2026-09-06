"use client";

import { useEffect, useState } from "react";
import { Button } from "@ritual/ui/button";

import { getDesktopDiagnostics, type DesktopDiagnostics } from "@/lib/native-gateway";

export function TransparencyProbe() {
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [hitCount, setHitCount] = useState(0);

  useEffect(() => {
    void getDesktopDiagnostics().then(setDiagnostics);
  }, []);

  return (
    <div className="transparency-probe-root" data-qa-probe="opaque-main-surface">
      <div className="transparency-probe-panel" data-qa-probe="decorative-glass-region">
        <h1 className="transparency-probe-title">Window Correctness Probe</h1>
        <p className="transparency-probe-body">
          The main surface must remain opaque and interactive; only this declared panel may use decorative translucency.
        </p>
        <ul className="transparency-probe-list">
          <li>Channel: {diagnostics?.runtime.channel ?? "loading"}</li>
          <li>Main content opaque: {String(diagnostics?.window.mainContentOpaque ?? false)}</li>
          <li>Ignores mouse events: {String(diagnostics?.window.ignoresMouseEvents ?? "unknown")}</li>
          <li>Normal window level: {diagnostics?.window.windowLevel ?? "unknown"}</li>
          <li>Native hit-testable: {String(diagnostics?.window.hitTestable ?? false)}</li>
          <li>Probe clicks: {hitCount}</li>
        </ul>
        <Button
          className="mt-4"
          data-qa-probe="hit-test-target"
          onClick={() => {
            setHitCount((current) => {
              const next = current + 1;
              const title = `Ritual Window Hit Test ${next}`;
              document.title = title;
              void import('@tauri-apps/api/window')
                .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
                .catch(() => undefined);
              return next;
            });
          }}
        >
          Test click target
        </Button>
      </div>
    </div>
  );
}
