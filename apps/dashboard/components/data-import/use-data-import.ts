"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type React from "react";
import { useAuth } from "@clerk/nextjs";
import { apiOperationWithAuth } from "@/lib/api/client";
import { BackendClientError } from "@/lib/api/generated/backend-client";
import {
  DATA_SOURCES,
  type AggregationPeriod,
  type ConflictPolicy,
  type DataSource,
  type ImportPreviewResponse,
  type ImportRun,
  type ImportRunSummary,
} from "../data-import-modal.config";
import {
  importWorkflowReducer,
  initialImportWorkflowState,
} from "./import-workflow";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

function messageFromImportError(error: unknown, fallback: string) {
  if (error instanceof BackendClientError) {
    try {
      const parsed = JSON.parse(error.responseBody) as { detail?: unknown; error?: string };
      if (typeof parsed.detail === "string" && parsed.detail) return parsed.detail;
      if (parsed.error) return parsed.error;
    } catch {
      // Keep the caller-facing fallback.
    }
    return fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export type ImportStep =
  | "select_source"
  | "upload_preview"
  | "configure"
  | "importing"
  | "complete"
  | "history";

const stepByState = {
  selecting: "select_source",
  uploading: "upload_preview",
  configuring: "configure",
  importing: "importing",
  complete: "complete",
  history: "history",
} as const satisfies Record<string, ImportStep>;

export function useDataImport(onClose: () => void, onImportComplete: () => void) {
  const { getToken } = useAuth();
  const [workflow, dispatch] = useReducer(importWorkflowReducer, initialImportWorkflowState);
  const [isDragging, setIsDragging] = useState(false);
  const [auxLoading, setAuxLoading] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("skip_existing");
  const [aggregation, setAggregation] = useState<AggregationPeriod>("daily");
  const [dateRange, setDateRange] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [deleteFileAfterParsing, setDeleteFileAfterParsing] = useState(true);
  const [csvMapping, setCsvMapping] = useState<{
    dateColumn: string;
    valueColumns: { column: string; habitName: string; unit: string }[];
  }>({ dateColumn: "", valueColumns: [] });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const operationAbortRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);

  const cancelActiveAttempt = useCallback(() => {
    attemptRef.current += 1;
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  useEffect(() => cancelActiveAttempt, [cancelActiveAttempt]);

  const resetState = useCallback(() => {
    cancelActiveAttempt();
    dispatch({ type: "RESET" });
    setShowAllItems(false);
    setConflictPolicy("skip_existing");
    setAggregation("daily");
    setDateRange("all");
    setCustomStartDate("");
    setCustomEndDate("");
    setCsvMapping({ dateColumn: "", valueColumns: [] });
    setIsDragging(false);
  }, [cancelActiveAttempt]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleSelectSource = useCallback((source: DataSource) => {
    dispatch({ type: "SELECT_SOURCE", source });
  }, []);

  const handleChooseFile = useCallback((file: File | null) => {
    dispatch({ type: "SET_FILE", file });
  }, []);

  const step = stepByState[workflow.kind];
  const selectedSource = "source" in workflow ? workflow.source : null;
  const file = "file" in workflow ? workflow.file : null;
  const previewData = "preview" in workflow ? workflow.preview : null;
  const importRunId = "runId" in workflow ? workflow.runId : null;
  const importResult = workflow.kind === "complete" ? workflow.result : null;
  const importProgress = workflow.kind === "importing" ? workflow.progress : { current: 0, total: 0 };
  const importHistory = workflow.kind === "history" ? workflow.runs : [];
  const isLoadingHistory = workflow.kind === "history" && workflow.request === "pending";
  const error = "error" in workflow ? workflow.error : null;
  const isLoading = auxLoading || ("request" in workflow && workflow.request === "pending");

  useEffect(() => {
    if (!isTauri || workflow.kind !== "uploading") return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlistenDrop = await listen<string[]>("tauri://file-drop", async (event) => {
          const filePath = event.payload?.[0];
          if (!filePath) return;
          try {
            const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || "file";
            const acceptedExtensions = [".csv", ".xlsx", ".xls", ".xml", ".zip", ".json", ".png", ".jpg", ".jpeg"];
            const ext = acceptedExtensions.find((value) => fileName.toLowerCase().endsWith(value));
            if (!ext) {
              dispatch({ type: "REQUEST_FAILED", error: "Unsupported file type" });
              return;
            }
            const { readFile } = await import("@tauri-apps/plugin-fs");
            const contents = await readFile(filePath);
            const mimeTypes: Record<string, string> = {
              ".csv": "text/csv",
              ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              ".xls": "application/vnd.ms-excel",
              ".xml": "application/xml",
              ".zip": "application/zip",
              ".json": "application/json",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
            };
            handleChooseFile(new File([new Uint8Array(contents)], fileName, { type: mimeTypes[ext] }));
            setIsDragging(false);
          } catch (error) {
            console.error("Failed to read dropped file:", error);
            dispatch({ type: "REQUEST_FAILED", error: "Failed to read dropped file" });
          }
        });
        const unlistenHover = await listen("tauri://file-drop-hover", () => setIsDragging(true));
        const unlistenCancelled = await listen("tauri://file-drop-cancelled", () => setIsDragging(false));
        cleanup = () => {
          unlistenDrop();
          unlistenHover();
          unlistenCancelled();
        };
        if (disposed) cleanup();
      } catch {
        // Browser builds do not expose Tauri file-drop events.
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [handleChooseFile, workflow.kind]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isTauri) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isTauri) setIsDragging(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (!isTauri) handleChooseFile(event.dataTransfer.files[0] ?? null);
  }, [handleChooseFile]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    handleChooseFile(event.target.files?.[0] ?? null);
  }, [handleChooseFile]);

  const handleFetchPreview = useCallback(async () => {
    if (workflow.kind !== "uploading" || !workflow.file) return;
    cancelActiveAttempt();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    dispatch({ type: "REQUEST_PREVIEW" });

    try {
      const formData = new FormData();
      formData.append("file", workflow.file);
      formData.append("source", workflow.source);
      const options: Record<string, unknown> = { aggregation, conflict_policy: conflictPolicy };
      if (dateRange === "custom" && customStartDate && customEndDate) {
        options.date_range_start = customStartDate;
        options.date_range_end = customEndDate;
      }
      if (workflow.source === "csv" && csvMapping.dateColumn) {
        options.date_column = csvMapping.dateColumn;
        options.column_mappings = csvMapping.valueColumns.map((value) => ({
          source_column: value.column,
          habit_name: value.habitName,
          unit_type: value.unit,
        }));
      }
      formData.append("options", JSON.stringify(options));
      const response = await fetch(`/api/import/preview?source=${workflow.source}`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.detail?.code === "OPENAI_KEY_MISSING") {
          throw new Error("Screenshot import requires an OpenAI API key. Please contact your administrator.");
        }
        throw new Error(result.detail || result.error || "Failed to analyze file");
      }

      const preview = result as ImportPreviewResponse;
      if (preview.detected_columns && workflow.source === "csv") {
        const dateColumn = preview.detected_columns.find((heading: string) => /date|time/i.test(heading));
        const valueColumn = preview.detected_columns.find((heading: string) => /value|amount|count|steps/i.test(heading));
        if (dateColumn) {
          setCsvMapping((current) => ({
            ...current,
            dateColumn,
            valueColumns: valueColumn ? [{ column: valueColumn, habitName: valueColumn, unit: "" }] : [],
          }));
        }
      }
      dispatch({ type: "PREVIEW_SUCCEEDED", preview });
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({ type: "REQUEST_FAILED", error: error instanceof Error ? error.message : "Failed to analyze file" });
      }
    }
  }, [aggregation, cancelActiveAttempt, conflictPolicy, csvMapping, customEndDate, customStartDate, dateRange, workflow]);

  const handleStartImport = useCallback(async () => {
    if (workflow.kind !== "configuring") return;
    cancelActiveAttempt();
    const attempt = attemptRef.current;
    const controller = new AbortController();
    operationAbortRef.current = controller;
    dispatch({ type: "IMPORT_STARTED", attempt });

    const fail = (message: string) => dispatch({ type: "IMPORT_FAILED", attempt, error: message });
    try {
      const result = await apiOperationWithAuth(
        "start_import_api_import_runs__run_id__start_post",
        getToken,
        {
          pathParams: { run_id: workflow.runId },
          body: { import_run_id: workflow.runId, conflict_policy: conflictPolicy, create_habits: true },
          signal: controller.signal,
        },
      ) as { status?: string; summary?: ImportRunSummary };
      if (result.status === "completed") {
        dispatch({ type: "IMPORT_COMPLETED", attempt, result: result.summary as ImportRunSummary });
        onImportComplete();
        return;
      }

      let pollCount = 0;
      const interval = (count: number) => (count < 8 ? 250 : count < 18 ? 1000 : 2000);
      const poll = async (): Promise<void> => {
        if (controller.signal.aborted || attempt !== attemptRef.current) return;
        if (pollCount >= 600) {
          fail("Import is still running in the background. Check Import History for live status.");
          return;
        }
        try {
          const status = await apiOperationWithAuth(
            "get_import_run_api_import_runs__run_id__get",
            getToken,
            { pathParams: { run_id: workflow.runId }, signal: controller.signal },
          ) as {
            progress_total?: number;
            progress_current?: number;
            status?: string;
            summary?: ImportRunSummary;
            errors?: Array<{ error?: string }>;
          };
          if ((status.progress_total || 0) > 0) {
            dispatch({
              type: "IMPORT_PROGRESS",
              attempt,
              current: status.progress_current || 0,
              total: status.progress_total || 0,
            });
          }
          if (status.status === "completed") {
            dispatch({ type: "IMPORT_COMPLETED", attempt, result: status.summary as ImportRunSummary });
            onImportComplete();
            return;
          }
          if (status.status === "failed" || status.status === "canceled") {
            fail(status.errors?.[0]?.error || "Import failed");
            return;
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn("Import status poll failed; retrying", error);
        }
        pollCount += 1;
        pollTimerRef.current = setTimeout(poll, interval(pollCount));
      };
      pollTimerRef.current = setTimeout(poll, interval(0));
    } catch (error) {
      if (!controller.signal.aborted) fail(messageFromImportError(error, "Import failed"));
    }
  }, [cancelActiveAttempt, conflictPolicy, getToken, onImportComplete, workflow]);

  const handleCancelImport = useCallback(async () => {
    if (workflow.kind !== "importing") return;
    const { runId, attempt } = workflow;
    cancelActiveAttempt();
    try {
      await apiOperationWithAuth(
        "cancel_import_api_import_runs__run_id__cancel_post",
        getToken,
        { pathParams: { run_id: runId } },
      );
    } finally {
      dispatch({ type: "IMPORT_FAILED", attempt, error: "Import was canceled" });
    }
  }, [cancelActiveAttempt, getToken, workflow]);

  const fetchImportHistory = useCallback(async () => {
    try {
      const data = await apiOperationWithAuth(
        "list_import_runs_api_import_runs_get",
        getToken,
        { query: { limit: 20 } },
      ) as { runs?: ImportRun[] };
      dispatch({ type: "HISTORY_LOADED", runs: data.runs || [] });
    } catch {
      dispatch({ type: "HISTORY_LOADED", runs: [] });
    }
  }, [getToken]);

  const handleShowHistory = useCallback(() => {
    cancelActiveAttempt();
    dispatch({ type: "SHOW_HISTORY" });
    void fetchImportHistory();
  }, [cancelActiveAttempt, fetchImportHistory]);

  const handleUndoImport = useCallback(async (runId: string) => {
    if (!confirm("Are you sure you want to undo this import? All imported data will be deleted.")) return;
    setAuxLoading(true);
    try {
      const result = await apiOperationWithAuth(
        "undo_import_run_api_import_runs__run_id__undo_post",
        getToken,
        { pathParams: { run_id: runId } },
      ) as { logs_deleted?: number };
      if (workflow.kind === "history") void fetchImportHistory();
      alert(`Undo complete: ${result.logs_deleted} logs deleted`);
      onImportComplete();
    } catch (error) {
      console.error(messageFromImportError(error, "Failed to undo import"));
    } finally {
      setAuxLoading(false);
    }
  }, [fetchImportHistory, getToken, onImportComplete, workflow.kind]);

  const handleAutoFix = useCallback(async (runId: string) => {
    await apiOperationWithAuth(
      "auto_fix_import_items_api_import_runs__run_id__auto_fix_post",
      getToken,
      { pathParams: { run_id: runId } },
    );
    await handleFetchPreview();
  }, [getToken, handleFetchPreview]);

  const handleBack = useCallback(() => {
    if (workflow.kind === "importing") {
      void handleCancelImport();
      return;
    }
    cancelActiveAttempt();
    dispatch({ type: "BACK" });
  }, [cancelActiveAttempt, handleCancelImport, workflow.kind]);

  const sourceConfig = selectedSource ? DATA_SOURCES.find((source) => source.id === selectedSource) : null;

  return {
    step,
    selectedSource,
    file,
    isDragging,
    isLoading,
    error,
    previewData,
    showAllItems,
    setShowAllItems,
    conflictPolicy,
    setConflictPolicy,
    aggregation,
    setAggregation,
    dateRange,
    setDateRange,
    customStartDate,
    setCustomStartDate,
    customEndDate,
    setCustomEndDate,
    deleteFileAfterParsing,
    setDeleteFileAfterParsing,
    csvMapping,
    setCsvMapping,
    importProgress,
    importRunId,
    importResult,
    importHistory,
    isLoadingHistory,
    fileInputRef,
    isTauri,
    resetState,
    handleBack,
    handleChooseFile,
    handleClose,
    handleSelectSource,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileSelect,
    handleFetchPreview,
    handleStartImport,
    handleCancelImport,
    handleUndoImport,
    handleAutoFix,
    fetchImportHistory,
    handleShowHistory,
    sourceConfig,
  };
}

export type DataImportController = ReturnType<typeof useDataImport>;
