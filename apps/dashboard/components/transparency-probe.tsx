"use client";

export function TransparencyProbe() {
  return (
    <div className="transparency-probe-root">
      <div className="transparency-probe-panel">
        <h1 className="transparency-probe-title">Transparency Probe</h1>
        <p className="transparency-probe-body">
          Place Finder or VS Code behind this window. You should see it through this panel.
        </p>
        <ul className="transparency-probe-list">
          <li>NSWindow: non-opaque with clear background</li>
          <li>WKWebView: drawsBackground disabled</li>
          <li>Vibrancy: Sidebar / fallback material applied</li>
          <li>Web layer: root background forced transparent</li>
        </ul>
      </div>
    </div>
  );
}
