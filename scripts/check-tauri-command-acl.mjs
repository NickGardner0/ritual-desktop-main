#!/usr/bin/env node
/**
 * Keep registered Tauri commands, ACL allow-lists, and frontend invoke sites in sync.
 * Also generates the NativeGateway command/capability/input/output triad from Rust signatures.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainRs = join(root, "apps/desktop/src-tauri/src/main.rs");
const permissionsDir = join(root, "apps/desktop/src-tauri/permissions");
const rustSrcDir = join(root, "apps/desktop/src-tauri/src");
const invokeRoots = [
  join(root, "apps/dashboard"),
  join(root, "apps/desktop/src"),
];

function walk(dir, files = [], extensions = /\.(ts|tsx|js|jsx|mjs)$/) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (["node_modules", "target", ".next", "dist"].includes(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files, extensions);
      continue;
    }
    if (extensions.test(entry) && !/\/tests\//.test(fullPath.replaceAll("\\", "/"))) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseRegisteredCommands(source) {
  const handlerStart = source.indexOf("tauri::generate_handler![");
  if (handlerStart === -1) {
    throw new Error("Could not find tauri::generate_handler! in main.rs");
  }
  const handlerEnd = source.indexOf("])", handlerStart);
  if (handlerEnd === -1) {
    throw new Error("Could not find the end of tauri::generate_handler!");
  }
  const block = source.slice(handlerStart, handlerEnd);
  const commands = new Set();
  for (const line of block.split("\n")) {
    const trimmed = line.trim().replace(/,$/, "");
    if (!trimmed || trimmed.startsWith("//") || trimmed.includes("generate_handler")) continue;
    const name = trimmed.split("::").pop();
    if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      commands.add(name);
    }
  }
  return commands;
}

function parseAllowedCommands() {
  const allowed = new Set();
  const capabilities = new Map();
  for (const entry of readdirSync(permissionsDir)) {
    if (!entry.endsWith(".toml")) continue;
    const source = readFileSync(join(permissionsDir, entry), "utf8");
    const identifier = source.match(/identifier\s*=\s*"([^"]+)"/)?.[1] || entry.replace(/\.toml$/, "");
    const matches = source.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g);
    for (const match of matches) {
      if (match[1] === "permission" || match[1].startsWith("desktop-")) continue;
      allowed.add(match[1]);
      if (!capabilities.has(match[1])) {
        capabilities.set(match[1], identifier);
      }
    }
  }
  return { allowed, capabilities };
}

function parseInvokedCommands(registered) {
  const invoked = new Set();
  const invokeCall =
    /\b(?:invoke|invokeDesktopCommand|invokeDesktopShellCommand)\s*(?:<[^>]*>)?\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  const quotedCommand = /['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  for (const file of invokeRoots.flatMap((dir) => walk(dir))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(invokeCall)) {
      invoked.add(match[1]);
    }
    for (const match of source.matchAll(quotedCommand)) {
      if (registered.has(match[1])) invoked.add(match[1]);
    }
  }
  return invoked;
}

function sorted(values) {
  return [...values].sort();
}

function rustToCamel(name) {
  return name.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function skipBalanced(source, start, open, close) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function splitTopLevel(source, delimiter) {
  const parts = [];
  let current = "";
  let angle = 0;
  let paren = 0;
  for (const char of source) {
    if (char === "<") angle += 1;
    else if (char === ">") angle -= 1;
    else if (char === "(") paren += 1;
    else if (char === ")") paren -= 1;
    if (char === delimiter && angle === 0 && paren === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function rustTypeToTs(rustType) {
  const type = rustType.replace(/\s+/g, " ").trim().replace(/^&/, "");
  if (!type) return "unknown";
  if (type === "()" || type === "unit") return "void";
  if (type.startsWith("Option<") && type.endsWith(">")) {
    return `${rustTypeToTs(type.slice("Option<".length, -1))} | null`;
  }
  if (type.startsWith("Result<") && type.endsWith(">")) {
    const inner = splitTopLevel(type.slice("Result<".length, -1), ",")[0];
    return rustTypeToTs(inner);
  }
  if (type.startsWith("Vec<") && type.endsWith(">")) {
    return `Array<${rustTypeToTs(type.slice("Vec<".length, -1))}>`;
  }
  if (type.includes("::")) {
    const last = type.split("::").pop() || "";
    return last.includes("<") ? rustTypeToTs(last) : "unknown";
  }
  if (type.startsWith("HashMap<") || type.includes("serde_json::Value") || type === "Value") {
    return "unknown";
  }
  const primitives = {
    String: "string",
    str: "string",
    bool: "boolean",
    i8: "number",
    i16: "number",
    i32: "number",
    i64: "number",
    u8: "number",
    u16: "number",
    u32: "number",
    u64: "number",
    f32: "number",
    f64: "number",
    usize: "number",
    isize: "number",
  };
  if (primitives[type]) return primitives[type];
  return "unknown";
}

function shouldSkipParam(name, type) {
  if (/^_?(app|window|state)$/i.test(name)) return true;
  return /AppHandle|State<|Window<|WebviewWindow|Runtime/.test(type);
}

function parseReturnType(raw) {
  const cleaned = raw.replace(/\bwhere\b[\s\S]*$/, "").trim();
  if (!cleaned) return "unknown";
  return rustTypeToTs(cleaned);
}

function parseTauriCommands(source) {
  const commands = new Map();
  const marker = "#[tauri::command]";
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;
    searchFrom = markerIndex + marker.length;
    const fnMatch = source.slice(searchFrom).match(/\b(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!fnMatch || fnMatch.index == null) continue;
    const name = fnMatch[1];
    let cursor = searchFrom + fnMatch.index + fnMatch[0].length;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] === "<") {
      cursor = skipBalanced(source, cursor, "<", ">");
      if (cursor === -1) continue;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    }
    if (source[cursor] !== "(") continue;
    const paramsEnd = skipBalanced(source, cursor, "(", ")");
    if (paramsEnd === -1) continue;
    const paramsSource = source.slice(cursor + 1, paramsEnd - 1);
    let afterParams = paramsEnd;
    while (afterParams < source.length && /\s/.test(source[afterParams])) afterParams += 1;
    let returnSource = "";
    if (source.startsWith("->", afterParams)) {
      afterParams += 2;
      const bodyIndex = source.indexOf("{", afterParams);
      if (bodyIndex === -1) continue;
      returnSource = source.slice(afterParams, bodyIndex);
    }
    const inputs = {};
    for (const param of splitTopLevel(paramsSource, ",")) {
      const trimmed = param.trim();
      if (!trimmed || trimmed === "self" || trimmed.startsWith("&")) continue;
      const parsed = trimmed.match(/^(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)$/);
      if (!parsed) continue;
      const rawName = parsed[1];
      const rawType = parsed[2].trim();
      if (shouldSkipParam(rawName, rawType)) continue;
      const field = rustToCamel(rawName);
      const tsType = rustTypeToTs(rawType);
      inputs[field] = rawType.replace(/\s+/g, " ").startsWith("Option<")
        ? `${tsType.replace(/ \| null$/, "")} | null`
        : tsType;
    }
    commands.set(name, {
      inputs,
      output: parseReturnType(returnSource),
    });
  }
  return commands;
}

function parseAllCommandSignatures() {
  const signatures = new Map();
  for (const file of walk(rustSrcDir, [], /\.rs$/)) {
    for (const [name, signature] of parseTauriCommands(readFileSync(file, "utf8"))) {
      signatures.set(name, signature);
    }
  }
  return signatures;
}

function renderTsType(value) {
  if (typeof value === "string") return value;
  const keys = Object.keys(value);
  if (!keys.length) return "Record<string, never>";
  return `{ ${keys.map((key) => {
    const tsType = value[key];
    const optional = tsType.includes(" | null");
    return `${key}${optional ? "?" : ""}: ${tsType}`;
  }).join("; ")} }`;
}

function generatedNativeGatewaySource(registered, capabilities, signatures) {
  const names = sorted(registered);
  const capabilityEntries = names.map((name) => {
    const capability = capabilities.get(name);
    if (!capability) {
      throw new Error(`No ACL capability identifier for command ${name}`);
    }
    return `  ${JSON.stringify(name)}: ${JSON.stringify(capability)}`;
  });
  const inputEntries = names.map((name) => {
    const signature = signatures.get(name);
    if (!signature) {
      throw new Error(`No Rust signature parsed for command ${name}`);
    }
    return `  ${name}: ${renderTsType(signature.inputs)};`;
  });
  const outputEntries = names.map((name) => {
    const signature = signatures.get(name);
    if (!signature) {
      throw new Error(`No Rust signature parsed for command ${name}`);
    }
    return `  ${name}: ${signature.output};`;
  });
  return `// Generated by scripts/check-tauri-command-acl.mjs. Do not edit.
export const NATIVE_COMMANDS = [
${names.map((name) => `  ${JSON.stringify(name)}`).join(",\n")},
] as const;

export type NativeCommandName = (typeof NATIVE_COMMANDS)[number];

export const NATIVE_COMMAND_CAPABILITIES = {
${capabilityEntries.join(",\n")},
} as const;

export type NativeCommandCapability = (typeof NATIVE_COMMAND_CAPABILITIES)[NativeCommandName];

export type NativeCommandInputs = {
${inputEntries.join("\n")}
};

export type NativeCommandOutputs = {
${outputEntries.join("\n")}
};

export type NativeCommandContract = {
  [K in NativeCommandName]: {
    capability: (typeof NATIVE_COMMAND_CAPABILITIES)[K];
    input: NativeCommandInputs[K];
    output: NativeCommandOutputs[K];
  };
};

export function isNativeCommandName(value: string): value is NativeCommandName {
  return (NATIVE_COMMANDS as readonly string[]).includes(value);
}
`;
}

function main() {
  const registered = parseRegisteredCommands(readFileSync(mainRs, "utf8"));
  const { allowed, capabilities } = parseAllowedCommands();
  const invoked = parseInvokedCommands(registered);
  const signatures = parseAllCommandSignatures();
  const errors = [];
  const generatedPath = join(root, "apps/dashboard/lib/native-gateway-commands.generated.ts");
  let generatedSource = "";
  try {
    generatedSource = generatedNativeGatewaySource(registered, capabilities, signatures);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const writeGenerated = process.argv.includes("--write");
  if (generatedSource) {
    if (writeGenerated) {
      writeFileSync(generatedPath, generatedSource);
    } else if (!existsSync(generatedPath) || readFileSync(generatedPath, "utf8") !== generatedSource) {
      errors.push("Generated NativeGateway command triad is out of date. Run: node scripts/check-tauri-command-acl.mjs --write");
    }
  }

  for (const command of sorted(allowed.difference ? allowed.difference(registered) : [...allowed].filter((item) => !registered.has(item)))) {
    errors.push(`ACL allows unregistered command: ${command}`);
  }
  for (const command of sorted(registered.difference ? registered.difference(allowed) : [...registered].filter((item) => !allowed.has(item)))) {
    errors.push(`Registered command is missing from ACL: ${command}`);
  }
  for (const command of sorted(invoked.difference ? invoked.difference(allowed) : [...invoked].filter((item) => !allowed.has(item)))) {
    errors.push(`Frontend invokes command that is not ACL-allowed: ${command}`);
  }
  for (const command of sorted(registered)) {
    if (!capabilities.has(command)) {
      errors.push(`Registered command is missing a capability identifier: ${command}`);
    }
    if (!signatures.has(command)) {
      errors.push(`Registered command is missing a parsed Rust signature: ${command}`);
    }
  }

  if (errors.length) {
    console.error("Tauri command ACL contract failed:");
    for (const error of errors) console.error(`- ${error}`);
    console.error(
      `\nRegistered=${registered.size} allowed=${allowed.size} invoked=${invoked.size} signatures=${signatures.size}`,
    );
    process.exit(1);
  }

  console.log(
    `Tauri command ACL contract passed (${registered.size} registered, ${allowed.size} allowed, ${invoked.size} frontend-invoked, ${signatures.size} typed signatures).`,
  );
}

main();
