import { NextResponse } from "next/server";
import { createProxiedSuccessInit } from "./proxy-response-init.mjs";

export { createProxiedSuccessInit };

export function createProxiedSuccessResponse(upstream: Response): NextResponse {
  const init = createProxiedSuccessInit(upstream);
  return new NextResponse(init.body, {
    status: init.status,
    statusText: init.statusText,
    headers: init.headers,
  });
}
