import { NextRequest, NextResponse } from "next/server";

const CODE_TTL_MS = 5 * 60 * 1000;
const codeStore = new Map<string, { code: string; sessionToken: string; timestamp: number }>();

function pruneExpiredCodes() {
  const now = Date.now();
  for (const [sessionId, data] of codeStore.entries()) {
    if (now - data.timestamp > CODE_TTL_MS) {
      codeStore.delete(sessionId);
    }
  }
}

export async function storeOAuthCode(request: NextRequest) {
  try {
    const { code, sessionId, sessionToken } = await request.json();
    if (!code || !sessionId || !sessionToken) {
      return NextResponse.json(
        { error: "Missing code, sessionId, or sessionToken" },
        { status: 400 },
      );
    }
    pruneExpiredCodes();
    codeStore.set(sessionId, { code, sessionToken, timestamp: Date.now() });
    return NextResponse.json({ success: true, message: "Code stored successfully" });
  } catch {
    return NextResponse.json({ error: "Failed to store code" }, { status: 500 });
  }
}

export async function takeOAuthCode(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    const sessionToken = request.nextUrl.searchParams.get("sessionToken");
    if (!sessionId || !sessionToken) {
      return NextResponse.json(
        { error: "Missing sessionId or sessionToken" },
        { status: 400 },
      );
    }
    pruneExpiredCodes();
    const stored = codeStore.get(sessionId);
    if (!stored || stored.sessionToken !== sessionToken) {
      return NextResponse.json({ found: false });
    }
    codeStore.delete(sessionId);
    return NextResponse.json({ found: true, code: stored.code });
  } catch {
    return NextResponse.json({ error: "Failed to retrieve code" }, { status: 500 });
  }
}
