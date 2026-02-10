import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

type LegacySource = "apple_health" | "whoop" | "csv" | "screenshot" | "oura" | "garmin" | "fitbit";

interface LegacyCSVMapping {
  dateColumn?: string;
  valueColumn?: string;
  metricColumn?: string;
  targetHabit?: string;
}

/**
 * Legacy compatibility endpoint.
 *
 * This route now delegates imports to the robust import-run pipeline:
 * 1) create preview + staging on backend
 * 2) start background import job
 * 3) return run_id for polling
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
    const source = formData.get("source") as LegacySource | null;
    const file = formData.get("file") as File | null;

    if (!source) {
      return NextResponse.json({ error: "No source type specified" }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. This endpoint now requires file-based import through import runs." },
        { status: 400 }
      );
    }

    const options: Record<string, unknown> = {};
    const conflictPolicy = (formData.get("conflictPolicy") as string | null) || "skip_existing";

    const metricsRaw = formData.get("metrics") as string | null;
    if (metricsRaw) {
      try {
        const metrics = JSON.parse(metricsRaw);
        if (Array.isArray(metrics)) {
          options.selected_metrics = metrics;
        }
      } catch {
        // Ignore malformed legacy metrics payload.
      }
    }

    const startDate = formData.get("startDate") as string | null;
    const endDate = formData.get("endDate") as string | null;
    if (startDate) options.date_range_start = startDate;
    if (endDate) options.date_range_end = endDate;

    if (source === "csv") {
      const mappingRaw = formData.get("mapping") as string | null;
      if (mappingRaw) {
        try {
          const mapping = JSON.parse(mappingRaw) as LegacyCSVMapping;
          if (mapping.dateColumn) {
            options.date_column = mapping.dateColumn;
          }
          if (mapping.valueColumn && mapping.targetHabit) {
            options.column_mappings = [
              {
                source_column: mapping.valueColumn,
                habit_name: mapping.targetHabit,
                unit_type: "count",
              },
            ];
          }
        } catch {
          // Ignore malformed legacy mapping payload.
        }
      }
    }

    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

    const previewFormData = new FormData();
    previewFormData.append("source", source);
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
      message: "Import scheduled in background. Poll /api/import/runs/{runId} for progress.",
      preview: {
        total_rows: previewResult.summary?.total_rows ?? 0,
        parsed: previewResult.summary?.parsed ?? 0,
        errors: previewResult.summary?.errors ?? 0,
      },
    });
  } catch (error) {
    console.error("Legacy import delegation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}

