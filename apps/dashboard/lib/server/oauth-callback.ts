import { NextRequest, NextResponse } from "next/server";

export type OAuthCallbackProvider = "whoop" | "tesla";

function parseOAuthState(state: string | null) {
  let source = "web";
  let sessionId: string | null = null;
  let sessionToken: string | null = null;
  if (!state) {
    return { source, sessionId, sessionToken };
  }
  try {
    const stateData = JSON.parse(atob(state));
    source = stateData.source || "web";
    sessionId = stateData.sessionId || null;
    sessionToken = stateData.sessionToken || null;
  } catch {
    // Keep the web default when the provider state blob is missing or malformed.
  }
  return { source, sessionId, sessionToken };
}

function withSession(url: URL, sessionId: string | null, sessionToken: string | null) {
  if (sessionId) url.searchParams.set("sessionId", sessionId);
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
  return url;
}

export function handleOAuthCallbackRedirect(
  request: NextRequest,
  provider: OAuthCallbackProvider,
) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const { source, sessionId, sessionToken } = parseOAuthState(searchParams.get("state"));
    const errorQuery = `${provider}_error`;
    const codeQuery = `${provider}_code`;

    if (error) {
      const errorDescription = searchParams.get("error_description") || error;
      if (source === "desktop") {
        const errorUrl = withSession(
          new URL("/integrations/success", request.url),
          sessionId,
          sessionToken,
        );
        errorUrl.searchParams.set("error", errorDescription);
        return NextResponse.redirect(errorUrl);
      }
      return NextResponse.redirect(
        new URL(`/integrations?${errorQuery}=${encodeURIComponent(errorDescription)}`, request.url),
      );
    }

    if (!code) {
      if (source === "desktop") {
        const errorUrl = withSession(
          new URL("/integrations/success", request.url),
          sessionId,
          sessionToken,
        );
        errorUrl.searchParams.set("error", "no_code");
        return NextResponse.redirect(errorUrl);
      }
      return NextResponse.redirect(new URL(`/integrations?${errorQuery}=no_code`, request.url));
    }

    if (source === "desktop") {
      const successUrl = withSession(
        new URL("/integrations/success", request.url),
        sessionId,
        sessionToken,
      );
      successUrl.searchParams.set("code", code);
      successUrl.searchParams.set("provider", provider);
      return NextResponse.redirect(successUrl);
    }

    return NextResponse.redirect(new URL(`/integrations?${codeQuery}=${code}`, request.url));
  } catch (error) {
    const errorQuery = `${provider}_error`;
    return NextResponse.redirect(
      new URL(`/integrations?${errorQuery}=${encodeURIComponent(String(error))}`, request.url),
    );
  }
}
