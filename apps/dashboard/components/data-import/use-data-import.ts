"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  DATA_SOURCES,
  type AggregationPeriod,
  type ConflictPolicy,
  type DataSource,
  type ImportPreviewResponse,
  type ImportRun,
  type ImportRunSummary,
} from "../data-import-modal.config";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

export type ImportStep =
  | "select_source"
  | "upload_preview"
  | "configure"
  | "importing"
  | "complete"
  | "history";

export function useDataImport(onClose: () => void, onImportComplete: () => void) {
  // State
  const [step, setStep] = useState<ImportStep>("select_source");
  const [selectedSource, setSelectedSource] = useState<DataSource | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Preview state
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null);
  const [showAllItems, setShowAllItems] = useState(false);
  
  // Import options
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("skip_existing");
  const [aggregation, setAggregation] = useState<AggregationPeriod>("daily");
  const [dateRange, setDateRange] = useState<string>("all");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  
  // V2: Privacy controls
  const [deleteFileAfterParsing, setDeleteFileAfterParsing] = useState<boolean>(true);
  
  // CSV mapping state
  const [csvMapping, setCsvMapping] = useState<{
    dateColumn: string;
    valueColumns: { column: string; habitName: string; unit: string }[];
  }>({ dateColumn: "", valueColumns: [] });
  
  // Import progress state
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importRunId, setImportRunId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportRunSummary | null>(null);
  
  // Import history
  const [importHistory, setImportHistory] = useState<ImportRun[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount (now uses setTimeout instead of setInterval)
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
      }
    };
  }, []);

  // Reset state
  const resetState = useCallback(() => {
    setStep("select_source");
    setSelectedSource(null);
    setFile(null);
    setError(null);
    setPreviewData(null);
    setShowAllItems(false);
    setConflictPolicy("skip_existing");
    setAggregation("daily");
    setDateRange("all");
    setCustomStartDate("");
    setCustomEndDate("");
    setCsvMapping({ dateColumn: "", valueColumns: [] });
    setImportProgress({ current: 0, total: 0 });
    setImportRunId(null);
    setImportResult(null);
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
    }
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Source selection
  const handleSelectSource = useCallback((source: DataSource) => {
    setSelectedSource(source);
    setStep("upload_preview");
    setError(null);
  }, []);

  // Tauri file drop handling
  useEffect(() => {
    if (!isTauri || step !== "upload_preview") return;
    
    let unlisten: (() => void) | undefined;
    
    const setupTauriFileDrop = async () => {
      try {
        // Dynamic import of Tauri APIs
        const { listen } = await import("@tauri-apps/api/event");
        
        // Listen for file drop events
        unlisten = await listen<string[]>("tauri://file-drop", async (event) => {
          const filePaths = event.payload;
          
          if (filePaths && filePaths.length > 0) {
            const filePath = filePaths[0];
            
            // Read the file using Tauri's fs API
            try {
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || "file";
              
              // Check if it's an acceptable file type
              const acceptedExtensions = [".csv", ".xlsx", ".xls", ".xml", ".zip", ".json", ".png", ".jpg", ".jpeg"];
              const hasAcceptedExt = acceptedExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
              
              if (!hasAcceptedExt) {
                setError("Unsupported file type");
                return;
              }
              
              // Read file content
              const contents = await readFile(filePath);
              
              // Create a File object from the binary data
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
              
              const ext = acceptedExtensions.find(e => fileName.toLowerCase().endsWith(e)) || ".csv";
              const mimeType = mimeTypes[ext] || "application/octet-stream";
              
              // Create File from Uint8Array - spread to regular array for compatibility
              const droppedFile = new File([new Uint8Array(contents)], fileName, { type: mimeType });
              setFile(droppedFile);
              setError(null);
              setIsDragging(false);
            } catch (readErr) {
              console.error("Failed to read file:", readErr);
              setError("Failed to read dropped file");
            }
          }
        });
        
        // Also listen for hover state
        const unlistenHover = await listen("tauri://file-drop-hover", () => {
          setIsDragging(true);
        });
        
        const unlistenCancelled = await listen("tauri://file-drop-cancelled", () => {
          setIsDragging(false);
        });
        
        // Return combined cleanup
        const originalUnlisten = unlisten;
        unlisten = () => {
          originalUnlisten?.();
          unlistenHover?.();
          unlistenCancelled?.();
        };
        
      } catch {
        // Tauri file drop not available (running in browser)
      }
    };
    
    setupTauriFileDrop();
    
    return () => {
      unlisten?.();
    };
  }, [step]);

  // File handling - fallback for non-Tauri (browser) environments
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) {
      setIsDragging(true);
    }
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) {
      setIsDragging(false);
    }
  }, []);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    // Only handle in non-Tauri mode (browser fallback)
    if (!isTauri) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        setFile(droppedFile);
        setError(null);
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  }, []);

  // Fetch import preview (Parse → Preview)
  // OPTIMIZED: Options now in FormData body instead of header
  const handleFetchPreview = useCallback(async () => {
    if (!file || !selectedSource) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source", selectedSource);
      
      // Build options - now passed in FormData body instead of header
      const options: Record<string, unknown> = {
        aggregation,
        conflict_policy: conflictPolicy,
      };
      
      if (dateRange === "custom" && customStartDate && customEndDate) {
        options.date_range_start = customStartDate;
        options.date_range_end = customEndDate;
      }
      
      if (selectedSource === "csv" && csvMapping.dateColumn) {
        options.date_column = csvMapping.dateColumn;
        options.column_mappings = csvMapping.valueColumns.map(v => ({
          source_column: v.column,
          habit_name: v.habitName,
          unit_type: v.unit,
        }));
      }
      
      // OPTIMIZATION: Options now in FormData body (more robust than header)
      formData.append("options", JSON.stringify(options));
      
      const response = await fetch(`/api/import/preview?source=${selectedSource}`, {
        method: "POST",
        body: formData,
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        // Handle specific error codes
        if (result.detail?.code === "OPENAI_KEY_MISSING") {
          throw new Error("Screenshot import requires an OpenAI API key. Please contact your administrator.");
        }
        throw new Error(result.detail || result.error || "Failed to analyze file");
      }
      
      setPreviewData(result);
      setImportRunId(result.import_run_id);
      
      // Show if we resumed an existing run
      if (result.resumed) {
        console.log("♻️ Resumed existing import run");
      }
      
      // Auto-detect CSV columns if present
      if (result.detected_columns && selectedSource === "csv") {
        const dateCol = result.detected_columns.find((h: string) => 
          h.toLowerCase().includes("date") || h.toLowerCase().includes("time")
        );
        const valueCol = result.detected_columns.find((h: string) => 
          h.toLowerCase().includes("value") || 
          h.toLowerCase().includes("amount") || 
          h.toLowerCase().includes("count") ||
          h.toLowerCase().includes("steps")
        );
        
        if (dateCol) {
          setCsvMapping(prev => ({
            ...prev,
            dateColumn: dateCol,
            valueColumns: valueCol ? [{ column: valueCol, habitName: valueCol, unit: "" }] : [],
          }));
        }
      }
      
      setStep("configure");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze file");
    } finally {
      setIsLoading(false);
    }
  }, [file, selectedSource, aggregation, conflictPolicy, dateRange, customStartDate, customEndDate, csvMapping]);

  // Start the actual import
  // OPTIMIZED: Uses exponential backoff for polling instead of fixed 1s
  const handleStartImport = useCallback(async () => {
    if (!importRunId) {
      setError("No import run ID. Please try uploading again.");
      return;
    }
    
    setStep("importing");
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/import/runs/${importRunId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_run_id: importRunId,
          conflict_policy: conflictPolicy,
          create_habits: true,
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.detail || result.error || "Import failed");
      }
      
      // Poll for status updates if not immediately complete
      if (result.status === "completed") {
        setImportResult(result.summary);
        setStep("complete");
        onImportComplete();
      } else {
        // OPTIMIZATION: Exponential backoff polling
        // - 250ms for first 2s (fast feedback)
        // - 1s for next 10s
        // - 2s thereafter
        let pollCount = 0;
        const maxPolls = 600; // Max ~20 minutes of polling for large background imports
        
        const getPollInterval = (count: number): number => {
          if (count < 8) return 250;   // First 2s: every 250ms
          if (count < 18) return 1000; // Next 10s: every 1s
          return 2000;                  // After: every 2s
        };
        
        const pollStatus = async () => {
          if (pollCount >= maxPolls) {
            setError("Import is still running in the background. Check Import History for live status.");
            setStep("configure");
            return;
          }
          
          try {
            const statusRes = await fetch(`/api/import/runs/${importRunId}`);
            const statusData = await statusRes.json();
            
            if (statusData.progress_total > 0) {
              setImportProgress({
                current: statusData.progress_current,
                total: statusData.progress_total,
              });
            }
            
            if (statusData.status === "completed") {
              setImportResult(statusData.summary);
              setStep("complete");
              onImportComplete();
              return; // Stop polling
            } else if (statusData.status === "failed" || statusData.status === "canceled") {
              setError(statusData.errors?.[0]?.error || "Import failed");
              setStep("configure");
              return; // Stop polling
            }
            
            // Schedule next poll with exponential backoff
            pollCount++;
            pollIntervalRef.current = setTimeout(pollStatus, getPollInterval(pollCount));
          } catch {
            // On error, retry with backoff
            pollCount++;
            pollIntervalRef.current = setTimeout(pollStatus, getPollInterval(pollCount));
          }
        };
        
        // Start polling immediately
        pollIntervalRef.current = setTimeout(pollStatus, getPollInterval(0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("configure");
    } finally {
      setIsLoading(false);
    }
  }, [importRunId, conflictPolicy, onImportComplete]);

  // Cancel import
  const handleCancelImport = useCallback(async () => {
    if (!importRunId) return;
    
    try {
      await fetch(`/api/import/runs/${importRunId}/cancel`, { method: "POST" });
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
      }
      setStep("configure");
      setError("Import was canceled");
    } catch {
      // Ignore cancel errors
    }
  }, [importRunId]);

  // Undo import
  const handleUndoImport = useCallback(async (runId: string) => {
    if (!confirm("Are you sure you want to undo this import? All imported data will be deleted.")) {
      return;
    }
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/import/runs/${runId}/undo`, { method: "POST" });
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.detail || "Failed to undo import");
      }
      
      // Refresh history if on history page
      if (step === "history") {
        fetchImportHistory();
      }
      
      // Notify user
      alert(`Undo complete: ${result.logs_deleted} logs deleted`);
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to undo import");
    } finally {
      setIsLoading(false);
    }
  }, [step, onImportComplete]);

  // Fetch import history
  const fetchImportHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch("/api/import/runs?limit=20");
      const data = await response.json();
      setImportHistory(data.runs || []);
    } catch {
      // Ignore history fetch errors
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Show history
  const handleShowHistory = useCallback(() => {
    setStep("history");
    fetchImportHistory();
  }, [fetchImportHistory]);

  const sourceConfig = selectedSource ? DATA_SOURCES.find((s) => s.id === selectedSource) : null;

  return {
    step,
    setStep,
    selectedSource,
    setSelectedSource,
    file,
    setFile,
    isDragging,
    setIsDragging,
    isLoading,
    error,
    setError,
    previewData,
    setPreviewData,
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
    fetchImportHistory,
    handleShowHistory,
    sourceConfig,
  };
}

export type DataImportController = ReturnType<typeof useDataImport>;
