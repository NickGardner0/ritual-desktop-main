#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const budget = Number(process.env.RITUAL_RUST_FILE_LINE_BUDGET || 1000);
const warnOnly = process.env.RITUAL_RUST_LINE_BUDGET_WARN_ONLY === "1";

const files = execFileSync(
  "find",
  [
    "apps/desktop",
    "-path",
    "apps/desktop/src-tauri/target",
    "-prune",
    "-o",
    "-type",
    "f",
    "-name",
    "*.rs",
    "-print",
  ],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const allowedLarge = new Map([
  [
    "apps/desktop/src-tauri/bin/ritual-watcher/src/macos/accessibility.rs",
    "macOS Accessibility/AX observer bridge; split only with focused native QA",
  ],
  [
    "apps/desktop/src-tauri/bin/ritual-watcher/src/browser_heartbeat_server.rs",
    "browser heartbeat server retained until watcher HTTP surface is split",
  ],
  [
    "apps/desktop/src-tauri/bin/ritual-watcher/src/main_part_bootstrap.rs",
    "watcher bootstrap retained for release compatibility",
  ],
  [
    "apps/desktop/src-tauri/bin/ritual-watcher/src/main_part_loop.rs",
    "watcher main loop retained for release compatibility",
  ],
  [
    "apps/desktop/src-tauri/crates/ritual-db/src/activity.rs",
    "activity repository surface predates schema split",
  ],
  [
    "apps/desktop/src-tauri/crates/ritual-db/src/context.rs",
    "context repository surface predates schema split",
  ],
  [
    "apps/desktop/src-tauri/crates/ritual-db/src/migration.rs",
    "historical migrations intentionally kept in one ordered file",
  ],
  [
    "apps/desktop/src-tauri/crates/ritual-db/src/project_time.rs",
    "project-time repository surface predates schema split",
  ],
  [
    "apps/desktop/src-tauri/crates/ritual-db/src/recorder.rs",
    "recorder repository surface predates schema split",
  ],
  [
    "apps/desktop/src-tauri/crates/ritual-db/src/schema/sync.rs",
    "sync schema DDL retained as one ordered migration section",
  ],
  [
    "apps/desktop/src-tauri/crates/ritual-db/src/text_processing.rs",
    "text classification pipeline retained pending focused extraction",
  ],
  [
    "apps/desktop/src-tauri/src/activity_rollups.rs",
    "activity rollup projection retained pending focused extraction",
  ],
  [
    "apps/desktop/src-tauri/src/cloud_sync.rs",
    "desktop cloud sync retained pending focused extraction",
  ],
  [
    "apps/desktop/src-tauri/src/desktop_runtime/biome_outbox.rs",
    "desktop Biome drain path retained pending focused extraction",
  ],
  [
    "apps/desktop/src-tauri/src/main.rs",
    "Tauri command registration root retained until command groups are extracted",
  ],
  [
    "apps/desktop/src-tauri/src/ritual_database.rs",
    "desktop database runtime root retained pending focused extraction",
  ],
  [
    "apps/desktop/src-tauri/src/watcher/lifecycle.rs",
    "watcher lifecycle retained pending focused extraction",
  ],
]);

const offenders = files
  .map((file) => ({
    file,
    lines: readFileSync(file, "utf8").split("\n").length,
  }))
  .filter((item) => item.lines > budget && !allowedLarge.has(item.file))
  .sort((a, b) => b.lines - a.lines);

if (offenders.length) {
  const message = `Rust line budget exceeded (${budget} lines):`;
  if (warnOnly) {
    console.warn(message);
    for (const offender of offenders) {
      console.warn(`- ${offender.file}: ${offender.lines}`);
    }
    process.exit(0);
  }
  console.error(message);
  for (const offender of offenders) {
    console.error(`- ${offender.file}: ${offender.lines}`);
  }
  process.exit(1);
}

const exceptionCount = files.filter((file) => allowedLarge.has(file)).length;
console.log(
  `Rust line budget passed: ${files.length - exceptionCount} files <= ${budget} lines, ${exceptionCount} documented exception(s).`,
);
