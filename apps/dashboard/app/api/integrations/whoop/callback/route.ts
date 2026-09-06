import { NextRequest } from "next/server";

import { handleOAuthCallbackRedirect } from "@/lib/server/oauth-callback";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleOAuthCallbackRedirect(request, "whoop");
}
