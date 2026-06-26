import { NextRequest, NextResponse } from "next/server";
import {
  canSendToCloud,
  type CloudConsent,
  type CloudDestination,
  type PrivacyDataClass,
  type PrivacyMode,
} from "@ritual/shared-contracts";

function parseMode(request: NextRequest): PrivacyMode {
  const raw = request.headers.get("x-ritual-privacy-mode")?.trim();
  return raw === "private_sync" || raw === "cloud_intelligence" ? raw : "local_only";
}

function parseConsents(request: NextRequest): Partial<Record<CloudConsent, boolean>> {
  const raw = request.headers.get("x-ritual-cloud-consents") || "";
  const consents: Partial<Record<CloudConsent, boolean>> = {};
  for (const item of raw.split(",")) {
    const consent = item.trim() as CloudConsent;
    if (consent) consents[consent] = true;
  }
  return consents;
}

export function privacyBlockResponse(
  request: NextRequest,
  input: {
    dataClass: PrivacyDataClass;
    destination: CloudDestination;
    purpose: CloudConsent;
  },
): NextResponse | null {
  const decision = canSendToCloud({
    ...input,
    mode: parseMode(request),
    consents: parseConsents(request),
  });
  if (decision.allowed) return null;
  return NextResponse.json(
    {
      error: "Cloud consent required",
      privacyBlocked: true,
      reason: decision.reason,
      requiredConsent: input.purpose,
    },
    { status: 403 },
  );
}
