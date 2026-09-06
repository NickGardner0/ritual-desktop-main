import { NextRequest } from "next/server";

import { storeOAuthCode, takeOAuthCode } from "@/lib/server/oauth-code-store";

export async function POST(request: NextRequest) {
  return storeOAuthCode(request);
}

export async function GET(request: NextRequest) {
  return takeOAuthCode(request);
}
