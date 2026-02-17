# macOS Sidebar Transparency PR Notes

## Plan Shipped
Plan A: single-window transparency (transparent `NSWindow` + disabled `WKWebView` background + vibrancy + sidebar-only translucent CSS).

## Step 1 Audit: Background Sources
- `apps/desktop/src-tauri/tauri.conf.json:144` `transparent: true`
- `apps/desktop/src-tauri/tauri.conf.json:145` `titleBarStyle: "Overlay"`
- `apps/desktop/src-tauri/tauri.conf.json:10` `macOSPrivateApi: true`
- `apps/dashboard/app/globals.css:295` desktop body defaults to opaque `hsl(var(--background))`
- `apps/dashboard/app/globals.css:365` macOS body forced transparent
- `apps/dashboard/app/globals.css:372` macOS sidebar wrapper background (translucent in this PR)
- `apps/dashboard/app/globals.css:380` macOS sidebar header background (translucent in this PR)
- `apps/dashboard/app/globals.css:387` macOS app container forced transparent
- `apps/dashboard/app/globals.css:393` macOS main content forced opaque (`--content-bg`)
- `apps/dashboard/components/sidebar.tsx:16` sidebar has `bg-background` class (overridden by macOS CSS gate)
- `apps/dashboard/components/sidebar.tsx:25` sidebar header has `bg-background` class (overridden by macOS CSS gate)
- `apps/dashboard/components/dashboard-layout.tsx:115` app container has `bg-white`
- `apps/dashboard/components/dashboard-layout.tsx:135` main content container has `bg-white`
- `apps/dashboard/components/dashboard-layout.tsx:138` header has `bg-white`
- `apps/dashboard/components/dashboard-layout.tsx:183` main area toggles `bg-white` / `bg-[#fbfbf9]`

## Transparency Probe
- Enable with: `RITUAL_TRANSPARENCY_PROBE=1`
- Startup app URL gets `?ritual_transparency_probe=1`
- Probe UI renders a simple translucent panel on otherwise transparent web content
- Probe mode sets `html[data-transparency-probe="1"]` for transparent root/background CSS

## Native Logging Targets
- `✅ NSWindow transparent configured`
- `✅ WKWebView drawsBackground disabled`
- `✅ Vibrancy applied (material: Sidebar)` (or fallback `UnderWindowBackground` / `HudWindow`)

## Testing Checklist
1. Probe mode with Finder/VS Code behind app: background visible through probe panel.
2. Normal mode: sidebar reveals desktop/other windows behind app.
3. Normal mode: main content remains opaque.
4. Sidebar collapsed: still glass.
5. Sidebar expanded: still glass.
6. No crashes during startup.
7. Windows/Linux behavior unchanged.
