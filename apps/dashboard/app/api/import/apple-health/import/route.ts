import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * Legacy Apple Health import endpoint.
 *
 * Delegates work to import-run pipeline:
 * 1) Parse + stage via /api/import/preview
 * 2) Start background job via /api/import/runs/{id}/start
 * 3) Return run_id for polling
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Failed to get auth token" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const metricsRaw = formData.get("metrics") as string | null;
    const startDate = formData.get("startDate") as string | null;
    const endDate = formData.get("endDate") as string | null;
    const conflictPolicy = (formData.get("conflictPolicy") as string | null) || "skip_existing";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!metricsRaw) {
      return NextResponse.json({ error: "No metrics selected" }, { status: 400 });
    }

    let selectedMetrics: string[] = [];
    try {
      const parsed = JSON.parse(metricsRaw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return NextResponse.json({ error: "No metrics selected" }, { status: 400 });
      }
      selectedMetrics = parsed;
    } catch {
      return NextResponse.json({ error: "Invalid metrics payload" }, { status: 400 });
    }

    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

    const options: Record<string, unknown> = {
      selected_metrics: selectedMetrics,
    };
    if (startDate) options.date_range_start = startDate;
    if (endDate) options.date_range_end = endDate;

    const previewFormData = new FormData();
    previewFormData.append("source", "apple_health");
    previewFormData.append("file", file);
    previewFormData.append("options", JSON.stringify(options));

    const previewResponse = await fetch(`${backendUrl}/api/import/preview`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: previewFormData,
    });

    const previewResult = await previewResponse.json();
    if (!previewResponse.ok) {
      return NextResponse.json(
        { error: previewResult.detail || previewResult.error || "Preview failed" },
        { status: previewResponse.status }
      );
    }

    const runId = previewResult.import_run_id as string | undefined;
    if (!runId) {
      return NextResponse.json(
        { error: "Preview did not return an import run id" },
        { status: 500 }
      );
    }

    const startResponse = await fetch(`${backendUrl}/api/import/runs/${runId}/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        import_run_id: runId,
        conflict_policy: conflictPolicy,
        create_habits: true,
      }),
    });

    const startResult = await startResponse.json();
    if (!startResponse.ok) {
      return NextResponse.json(
        { error: startResult.detail || startResult.error || "Failed to start import job" },
        { status: startResponse.status }
      );
    }

    return NextResponse.json({
      success: true,
      status: startResult.status || "importing",
      import_run_id: runId,
      message: "Apple Health import scheduled in background. Poll /api/import/runs/{runId} for progress.",
      preview: {
        total_rows: previewResult.summary?.total_rows ?? 0,
        parsed: previewResult.summary?.parsed ?? 0,
        errors: previewResult.summary?.errors ?? 0,
      },
    });
  } catch (error) {
    console.error("Apple Health import delegation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
