#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = process.cwd();
const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.input || !values.output) {
  console.error("Usage: generate-backend-client.mjs --input <openapi.json> --output <backend-client.ts>");
  process.exit(2);
}

const openapiPath = resolve(root, values.input);
const outputPath = resolve(root, values.output);
const schema = JSON.parse(readFileSync(openapiPath, "utf8"));
const httpMethods = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const paths = Object.keys(schema.paths || {}).sort();
const hash = createHash("sha256").update(JSON.stringify(schema)).digest("hex").slice(0, 16);

function quoted(value) {
  return JSON.stringify(String(value));
}

function refName(ref) {
  return String(ref).split("/").at(-1);
}

function schemaType(node) {
  if (!node || typeof node !== "object") return "unknown";
  if (node.$ref) return `BackendSchemas[${quoted(refName(node.$ref))}]`;
  if (Array.isArray(node.enum)) {
    const union = node.enum.map((value) => JSON.stringify(value)).join(" | ") || "never";
    return node.nullable ? `${union} | null` : union;
  }
  for (const key of ["oneOf", "anyOf"]) {
    if (Array.isArray(node[key])) {
      const union = node[key].map(schemaType).join(" | ") || "unknown";
      return node.nullable ? `${union} | null` : union;
    }
  }
  if (Array.isArray(node.allOf)) {
    const intersection = node.allOf.map(schemaType).join(" & ") || "unknown";
    return node.nullable ? `(${intersection}) | null` : intersection;
  }

  let result = "unknown";
  if (node.type === "array") {
    result = `Array<${schemaType(node.items)}>`;
  } else if (node.type === "object" || node.properties || node.additionalProperties) {
    const required = new Set(node.required || []);
    const properties = Object.entries(node.properties || {}).sort(([a], [b]) => a.localeCompare(b));
    const fields = properties.map(([name, value]) => {
      return `${quoted(name)}${required.has(name) ? "" : "?"}: ${schemaType(value)};`;
    });
    if (node.additionalProperties) {
      fields.push(`[key: string]: ${node.additionalProperties === true ? "unknown" : schemaType(node.additionalProperties)};`);
    }
    result = `{ ${fields.join(" ")} }`;
  } else if (node.type === "string") {
    result = "string";
  } else if (node.type === "integer" || node.type === "number") {
    result = "number";
  } else if (node.type === "boolean") {
    result = "boolean";
  } else if (node.type === "null") {
    result = "null";
  }
  return node.nullable && result !== "null" ? `${result} | null` : result;
}

function contentSchema(content) {
  const media = content?.["application/json"] || content?.["application/problem+json"];
  return schemaType(media?.schema);
}

function parametersFor(pathItem, operation, location) {
  const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])]
    .filter((parameter) => parameter.in === location)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!parameters.length) return "Record<string, never>";
  return `{ ${parameters.map((parameter) => (
    `${quoted(parameter.name)}${parameter.required ? "" : "?"}: ${schemaType(parameter.schema)};`
  )).join(" ")} }`;
}

function responseType(operation) {
  const responses = Object.entries(operation.responses || {})
    .filter(([status]) => /^2\d\d$/.test(status))
    .sort(([a], [b]) => a.localeCompare(b));
  if (!responses.length) return "unknown";
  const types = [...new Set(responses.map(([, response]) => {
    if (response.$ref) return schemaType(response);
    if (!response.content) return "undefined";
    return contentSchema(response.content);
  }))];
  return types.join(" | ");
}

const components = Object.entries(schema.components?.schemas || {}).sort(([a], [b]) => a.localeCompare(b));
const componentMap = components.length
  ? components.map(([name, value]) => `  ${quoted(name)}: ${schemaType(value)};`).join("\n")
  : "  [name: string]: unknown;";

const operations = [];
for (const path of paths) {
  const pathItem = schema.paths[path] || {};
  for (const method of Object.keys(pathItem).filter((key) => httpMethods.has(key)).sort()) {
    const operation = pathItem[method];
    const operationId = operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`;
    operations.push({
      operationId,
      method: method.toUpperCase(),
      path,
      pathParams: parametersFor(pathItem, operation, "path"),
      query: parametersFor(pathItem, operation, "query"),
      body: operation.requestBody ? contentSchema(operation.requestBody.content) : "undefined",
      response: responseType(operation),
    });
  }
}
operations.sort((a, b) => a.operationId.localeCompare(b.operationId));
const duplicateIds = operations.filter((value, index) => operations.findIndex((item) => item.operationId === value.operationId) !== index);
if (duplicateIds.length) {
  throw new Error(`Duplicate OpenAPI operation IDs: ${[...new Set(duplicateIds.map((item) => item.operationId))].join(", ")}`);
}

const pathUnion = paths.length ? paths.map((path) => `  | ${quoted(path)}`).join("\n") : "  | string";
const methods = [...new Set(operations.map((operation) => operation.method))].sort();
const methodUnion = methods.map((method) => `  | ${quoted(method)}`).join("\n");
const pathArray = paths.map((path) => `  ${quoted(path)}`).join(",\n");
const operationConstants = operations.map((operation) => (
  `  ${quoted(operation.operationId)}: { method: ${quoted(operation.method)}, path: ${quoted(operation.path)} },`
)).join("\n");
const operationMap = operations.map((operation) => `  ${quoted(operation.operationId)}: {
    method: ${quoted(operation.method)};
    path: ${quoted(operation.path)};
    pathParams: ${operation.pathParams};
    query: ${operation.query};
    body: ${operation.body};
    response: ${operation.response};
  };`).join("\n");

const source = `// Generated by scripts/generate-backend-client.mjs. Do not edit manually.
// OpenAPI hash: ${hash}

export const BACKEND_OPENAPI_PATHS = [
${pathArray}
] as const;

export type BackendOpenApiPath =
${pathUnion};

export type BackendHttpMethod =
${methodUnion};

export type BackendSchemas = {
${componentMap}
};

export const BACKEND_OPERATIONS = {
${operationConstants}
} as const;

export interface BackendOperationMap {
${operationMap}
}

export type BackendOperationId = keyof BackendOperationMap;
export type BackendOperationRequest<TOperation extends BackendOperationId> = {
  pathParams?: BackendOperationMap[TOperation]["pathParams"];
  query?: BackendOperationMap[TOperation]["query"];
  body?: BackendOperationMap[TOperation]["body"];
  headers?: HeadersInit;
  signal?: AbortSignal;
};
export type BackendOperationResponse<TOperation extends BackendOperationId> =
  BackendOperationMap[TOperation]["response"];

export interface BackendClientRequest<TBody = unknown> {
  method?: BackendHttpMethod;
  path: BackendOpenApiPath;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: TBody;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export class BackendClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "BackendClientError";
  }
}

export interface BackendClientOptions {
  baseUrl: string;
  getAuthHeaders: () => Promise<HeadersInit> | HeadersInit;
}

const BACKEND_OPENAPI_PATH_SET = new Set<string>(BACKEND_OPENAPI_PATHS);

export function isBackendOpenApiPath(path: string): path is BackendOpenApiPath {
  return BACKEND_OPENAPI_PATH_SET.has(path);
}

export function matchBackendOpenApiPath(path: string): BackendOpenApiPath | null {
  if (isBackendOpenApiPath(path)) return path;
  const requestSegments = path.split("/").filter(Boolean);
  for (const candidate of BACKEND_OPENAPI_PATHS) {
    const candidateSegments = candidate.split("/").filter(Boolean);
    if (candidateSegments.length !== requestSegments.length) continue;
    const matches = candidateSegments.every((segment, index) => (
      segment.startsWith("{") && segment.endsWith("}")
        ? requestSegments[index].length > 0
        : segment === requestSegments[index]
    ));
    if (matches) return candidate;
  }
  return null;
}

export function matchBackendOpenApiOperation(
  method: string,
  path: string,
): BackendOperationId | null {
  const template = matchBackendOpenApiPath(path);
  if (!template) return null;
  const normalizedMethod = method.toUpperCase();
  for (const [operationId, operation] of Object.entries(BACKEND_OPERATIONS)) {
    if (operation.method === normalizedMethod && operation.path === template) {
      return operationId as BackendOperationId;
    }
  }
  return null;
}

function interpolatePath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/\\{([^}]+)\\}/g, (_, key) => {
    const value = params?.[key];
    if (value === null || value === undefined || value === "") {
      throw new Error(\`Missing path parameter: \${key}\`);
    }
    return encodeURIComponent(String(value));
  });
}

export function createBackendClient(options: BackendClientOptions) {
  async function execute<TResponse, TBody>(request: BackendClientRequest<TBody>): Promise<TResponse> {
    const method = request.method ?? "GET";
    const url = new URL(request.path, options.baseUrl);
    for (const [key, value] of Object.entries(request.query || {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    const authHeaders = await options.getAuthHeaders();
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        ...authHeaders,
        ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(request.headers || {}),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: request.signal,
    });
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new BackendClientError("Backend request failed", response.status, responseBody);
    }
    if (response.status === 204) return undefined as TResponse;
    return response.json() as Promise<TResponse>;
  }

  return {
    request<TResponse = unknown, TBody = unknown>(request: BackendClientRequest<TBody>) {
      return execute<TResponse, TBody>(request);
    },
    requestOperation<TOperation extends BackendOperationId>(
      operationId: TOperation,
      request: BackendOperationRequest<TOperation> = {},
    ): Promise<BackendOperationResponse<TOperation>> {
      const operation = BACKEND_OPERATIONS[operationId];
      const path = interpolatePath(operation.path, request.pathParams as Record<string, unknown> | undefined);
      return execute({
        method: operation.method,
        path: path as BackendOpenApiPath,
        query: request.query as Record<string, string | number | boolean | null | undefined> | undefined,
        body: request.body,
        headers: request.headers,
        signal: request.signal,
      });
    },
  };
}
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, source, "utf8");
console.log(`Wrote ${values.output} (${operations.length} operations, ${components.length} schemas, ${hash})`);
