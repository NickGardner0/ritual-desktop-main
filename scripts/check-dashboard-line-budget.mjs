#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const budget = Number(process.env.RITUAL_DASHBOARD_FILE_LINE_BUDGET || 800);
const files = execFileSync("find", [
  "apps/dashboard",
  "-path",
  "apps/dashboard/.next",
  "-prune",
  "-o",
  "-type",
  "f",
  "(",
  "-name",
  "*.ts",
  "-o",
  "-name",
  "*.tsx",
  ")",
  "-print",
], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const offenders = files
  .map((file) => ({
    file,
    lines: readFileSync(file, "utf8").split("\n").length,
  }))
  .filter((item) => item.lines > budget)
  .sort((a, b) => b.lines - a.lines);

if (offenders.length) {
  console.error(`Dashboard line budget exceeded (${budget} lines):`);
  for (const offender of offenders) {
    console.error(`- ${offender.file}: ${offender.lines}`);
  }
  process.exit(1);
}

console.log(`Dashboard line budget passed: ${files.length} files <= ${budget} lines.`);
