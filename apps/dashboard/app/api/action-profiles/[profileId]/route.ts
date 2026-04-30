import { NextRequest } from "next/server";

import { forwardProxyRequest } from "@/lib/server/proxy-helper";

interface RouteParams {
  params: Promise<{
    profileId: string;
  }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { profileId } = await params;
  return forwardProxyRequest(request, `/api/action-profiles/${profileId}`, {
    tag: "action-profile-update",
    timeout: 20_000,
  });
}
