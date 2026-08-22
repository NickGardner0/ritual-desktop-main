#!/usr/bin/env node
import { readFileSync } from "node:fs";

const EVENT_RE =
  /^(?<ts>\S+)\s+INFO .* desktop\.shell event="(?<event>[^"]+)" payload=(?<payload>\{.*\})\s*$/;

export function parseDesktopLaunchLog(text, { sinceTs } = {}) {
  const events = [];
  for (const line of text.split("\n")) {
    const match = line.match(EVENT_RE);
    if (!match) continue;
    const { ts, event, payload } = match.groups;
    if (sinceTs && ts < sinceTs) continue;
    if (!event.startsWith("launch:")) continue;
    let data = null;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }
    events.push({ ts, event, data });
  }
  return events;
}

export function trialsFromLaunchEvents(events) {
  const trials = [];
  for (const event of events) {
    if (event.event !== "launch:summary") continue;
    const milestones = event.data?.milestones || {};
    const nativeReady = events.find(
      (item) => item.event === "launch:native_ready" && item.ts === event.ts,
    ) || events.filter((item) => item.event === "launch:native_ready" && item.ts <= event.ts).at(-1);
    const extra = nativeReady?.data || {};
    trials.push({
      ts: event.ts,
      kind: event.data?.kind === "warm" ? "warm" : "cold",
      providers_mounted: milestones.providers_mounted?.last_ms ?? null,
      native_ready: milestones.native_ready?.last_ms ?? extra.elapsed_ms ?? null,
      shell_bootstrap: milestones.shell_bootstrap?.last_ms ?? null,
      webview_rss_bytes: extra.webview_rss_bytes ?? null,
      watcher_rss_bytes: extra.watcher_rss_bytes ?? null,
    });
  }
  return trials;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: parse-desktop-launch-log.mjs <ritual-desktop.log>");
    process.exit(2);
  }
  const events = parseDesktopLaunchLog(readFileSync(path, "utf8"));
  console.log(JSON.stringify(trialsFromLaunchEvents(events), null, 2));
}
