#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const budget = Number(process.env.RITUAL_DASHBOARD_FILE_LINE_BUDGET || 800);
const generatedBudget = Number(process.env.RITUAL_DASHBOARD_GENERATED_FILE_LINE_BUDGET || 5000);
const generatedPrefix = "apps/dashboard/lib/api/generated/";
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
  .filter((file) => !file.startsWith(generatedPrefix))
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

const generatedOffenders = files
  .filter((file) => file.startsWith(generatedPrefix))
  .map((file) => ({
    file,
    lines: readFileSync(file, "utf8").split("\n").length,
  }))
  .filter((item) => item.lines > generatedBudget)
  .sort((a, b) => b.lines - a.lines);

if (generatedOffenders.length) {
  console.error(`Generated dashboard line budget exceeded (${generatedBudget} lines):`);
  for (const offender of generatedOffenders) {
    console.error(`- ${offender.file}: ${offender.lines}`);
  }
  process.exit(1);
}

console.log(
  `Dashboard line budget passed: source files <= ${budget} lines; generated files <= ${generatedBudget} lines.`,
);
