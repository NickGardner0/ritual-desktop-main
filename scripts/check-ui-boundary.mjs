import { existsSync } from "node:fs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const canonicalComponents = ["badge", "button", "card", "input", "label", "separator"];
const failures = [];

for (const component of canonicalComponents) {
  const compatibilityPath = resolve(root, `apps/dashboard/components/ui/${component}.tsx`);
  if (!existsSync(compatibilityPath)) {
    continue;
  }
  const source = await readFile(compatibilityPath, "utf8");
  if (!source.includes(`from "@ritual/ui/${component}"`)) {
    failures.push(`${compatibilityPath} must remain a compatibility export from @ritual/ui/${component}`);
  }
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", "dist", "tests"].includes(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, files);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) files.push(fullPath);
  }
  return files;
}

const dashboardRoot = resolve(root, "apps/dashboard");
const dashboardFiles = walk(dashboardRoot);
for (const component of canonicalComponents) {
  const compatibilityPath = resolve(root, `apps/dashboard/components/ui/${component}.tsx`);
  if (existsSync(compatibilityPath)) continue;
  const needle = `@/components/ui/${component}`;
  for (const file of dashboardFiles) {
    const source = readFileSync(file, "utf8");
    if (source.includes(needle)) {
      failures.push(`${file.slice(root.length + 1)} imports removed shim ${needle}; import from @ritual/ui/${component} instead`);
    }
  }
}

const tailwindConfig = await readFile(resolve(root, "apps/dashboard/tailwind.config.js"), "utf8");
if (!tailwindConfig.includes('require("@ritual/ui/tailwind-config")')) {
  failures.push("The dashboard Tailwind config must extend @ritual/ui/tailwind-config");
}

const globals = await readFile(resolve(root, "apps/dashboard/app/globals.css"), "utf8");
if (!globals.includes('@import "@ritual/ui/globals.css"')) {
  failures.push("The dashboard must import @ritual/ui/globals.css");
}

const legacyUtils = await readFile(resolve(root, "apps/dashboard/lib/utils.ts"), "utf8");
if (!legacyUtils.includes('from "@ritual/ui/cn"')) {
  failures.push("The dashboard cn helper must remain a compatibility export from @ritual/ui/cn");
}

if (failures.length > 0) {
  console.error(["UI boundary check failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log("UI boundary check passed.");
