import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBackendAuthHeaders } from "@/lib/server/backend-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || "http://127.0.0.1:8000";

function isValidDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  
  while (current <= endDate) {
    dates.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

function formatLocalTime(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const date = new Date(ms);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const kind = searchParams.get("kind");
    const key = searchParams.get("key");
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const source = searchParams.get("source") || "desktop";

    if (kind !== "app" && kind !== "website") {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }

    if (source !== "desktop" && source !== "iphone") {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }

    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

    if (!isValidDateString(start) || !isValidDateString(end)) {
      return NextResponse.json({ error: "Invalid start/end date" }, { status: 400 });
    }

    const token = await getToken();
    const queryString = new URLSearchParams({
      kind,
      key,
      start_date: start,
      end_date: end,
    }).toString();

    const upstreamPath = source === "iphone" ? "/api/screen-time/breakdown" : "/api/watcher/breakdown";
    const url = `${BACKEND_URL}${upstreamPath}?${queryString}`;

    const response = await fetch(url, {
      method: "GET",
      headers: buildBackendAuthHeaders({ userId, token }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch usage breakdown" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    const valueByDate = new Map<string, { activeMs: number; seconds: number; startTime: string | null; endTime: string | null }>(
      rows.map((row: { day: string; active_ms?: number; first_start_ms?: number; last_end_ms?: number }) => {
        const activeMs = Math.max(0, Number(row.active_ms || 0));
        return [
          row.day,
          {
            activeMs,
            seconds: Math.round(activeMs / 1000),
            startTime: formatLocalTime(row.first_start_ms),
            endTime: formatLocalTime(row.last_end_ms),
          },
        ];
      })
    );

    const points = buildDateRange(start, end).map((date) => {
      const entry = valueByDate.get(date);
      return {
        date,
        activeMs: entry?.activeMs || 0,
        seconds: entry?.seconds || 0,
        startTime: entry?.startTime || null,
        endTime: entry?.endTime || null,
      };
    });

    const totalMs = points.reduce((sum, point) => sum + point.activeMs, 0);
    const totalSeconds = Math.round(totalMs / 1000);

    return NextResponse.json({
      source,
      kind,
      key,
      start,
      end,
      points,
      totalSeconds,
      totalMs,
    });
  } catch (error) {
    console.error("Error fetching usage breakdown:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
