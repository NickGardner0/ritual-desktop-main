"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Upload,
  Check,
  AlertCircle,
  Loader2,
  X,
  ChevronLeft,
  Camera,
  RotateCcw,
  AlertTriangle,
  ChevronDown,
  History,
} from "lucide-react";

// Check if we're in Tauri environment
const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

// =====================
// TYPES
// =====================

type DataSource = "apple_health" | "whoop" | "csv" | "screenshot" | "oura" | "garmin";
type ConflictPolicy = "skip_existing" | "overwrite_existing" | "merge_sum";
type AggregationPeriod = "raw" | "daily" | "weekly" | "monthly";

interface DataSourceConfig {
  id: DataSource;
  name: string;
  acceptedFiles: string;
  instructions: string[];
}

interface ImportItem {
  habit_key: string;
  habit_name?: string;
  date: string;
  amount?: number;
  unit_type?: string;
  validation_status: "ok" | "warning" | "error";
  validation_messages?: { type: string; code: string; message: string }[];
  conflict_status?: string;
  row_index?: number;
}

interface ImportRunSummary {
  total_rows: number;
  parsed: number;
  imported: number;
  skipped: number;
  updated: number;
  duplicates: number;
  errors: number;
  created_habit_ids?: string[];
}

interface ImportPreviewResponse {
  import_run_id: string;
  source: string;
  summary: ImportRunSummary;
  sample_items: ImportItem[];
  validation_issues: ImportItem[];
  dedupe_estimate: {
    total_items: number;
    new_items: number;
    duplicates: number;
    conflicts: number;
  };
  detected_columns?: string[];
  detected_metrics?: { name: string; value: number; unit: string; confidence: number }[];
}

interface ImportRun {
  id: string;
  source: string;
  status: string;
  file_name?: string;
  created_at: string;
  summary?: ImportRunSummary;
  undo_available: boolean;
}

// Icon component for each data source
function DataSourceIcon({ source, className }: { source: DataSource; className?: string }) {
  switch (source) {
    case "apple_health":
      return (
        <svg className={className} viewBox="0 0 814 1000" fill="currentColor">
          <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
        </svg>
      );
    case "screenshot":
      return <Camera className={className} />;
    case "csv":
      return <Image src="/images/Google_Sheets_logo_(2014-2020).svg" alt="Spreadsheet" width={24} height={24} className={cn("object-contain", className)} />;
    case "whoop":
      return <Image src="/images/whoop.svg" alt="Whoop" width={64} height={24} className={cn("object-contain", className)} />;
    case "oura":
      return <Image src="/images/oura.svg" alt="Oura Ring" width={80} height={32} className={cn("object-contain", className)} />;
    case "garmin":
      return <Image src="/images/garmin.svg" alt="Garmin" width={64} height={24} className={cn("object-contain", className)} />;
    default:
      return null;
  }
}

// Ordered: CSV, Screenshot, Apple Health, Whoop, Oura, Garmin
const DATA_SOURCES: DataSourceConfig[] = [
  {
    id: "csv",
    name: "CSV / Spreadsheet",
    acceptedFiles: ".csv,.xlsx,.xls",
    instructions: [
      "Prepare your data in CSV or Excel format",
      "Include columns for: Date, Value, and optionally Metric Name",
      "Upload your file",
      "Map columns to the right fields",
    ],
  },
  {
    id: "screenshot",
    name: "Screenshot / Image",
    acceptedFiles: ".png,.jpg,.jpeg,.webp,.heic",
    instructions: [
      "Take a screenshot of your health/fitness data",
      "Upload the image here",
      "Our AI will extract the relevant data",
      "Review and confirm the extracted values",
    ],
  },
  {
    id: "apple_health",
    name: "Apple Health",
    acceptedFiles: ".zip,.xml",
    instructions: [
      "Open the Health app on your iPhone",
      "Tap your profile picture in the top right",
      "Scroll down and tap Export All Health Data",
      "Wait for the export to complete",
      "Save or share the .zip file to your computer",
    ],
  },
  {
    id: "whoop",
    name: "Whoop",
    acceptedFiles: ".csv,.zip",
    instructions: [
      "Open the Whoop app",
      "Go to Settings > Data Export",
      "Request your data export",
      "Download the CSV file when ready",
    ],
  },
  {
    id: "oura",
    name: "Oura Ring",
    acceptedFiles: ".csv,.json",
    instructions: [
      "Log into cloud.ouraring.com",
      "Go to Settings > Data Export",
      "Download your data as CSV or JSON",
    ],
  },
  {
    id: "garmin",
    name: "Garmin",
    acceptedFiles: ".csv,.fit,.zip",
    instructions: [
      "Log into connect.garmin.com",
      "Go to your profile and export data",
      "Download the CSV or FIT files",
    ],
  },
];

const CONFLICT_POLICIES: { value: ConflictPolicy; label: string; description: string }[] = [
  { value: "skip_existing", label: "Skip existing", description: "Don't modify existing data" },
  { value: "overwrite_existing", label: "Overwrite", description: "Replace existing values" },
  { value: "merge_sum", label: "Add together", description: "Sum with existing values" },
];

const AGGREGATION_OPTIONS: { value: AggregationPeriod; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "raw", label: "No aggregation" },
];

// =====================
// COMPONENT
// =====================

interface DataImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

type Step = "select_source" | "upload_preview" | "configure" | "importing" | "complete" | "history";

export function DataImportModal({
  isOpen,
  onClose,
  onImportComplete,
}: DataImportModalProps) {
  // State
  const [step, setStep] = useState<Step>("select_source");
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

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
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
      clearInterval(pollIntervalRef.current);
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
              const { readBinaryFile, BaseDirectory } = await import("@tauri-apps/api/fs");
              const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || "file";
              
              // Check if it's an acceptable file type
              const acceptedExtensions = [".csv", ".xlsx", ".xls", ".xml", ".zip", ".json", ".png", ".jpg", ".jpeg"];
              const hasAcceptedExt = acceptedExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
              
              if (!hasAcceptedExt) {
                setError("Unsupported file type");
                return;
              }
              
              // Read file content
              const contents = await readBinaryFile(filePath);
              
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
  const handleFetchPreview = useCallback(async () => {
    if (!file || !selectedSource) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      // Build options
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
      
      const response = await fetch(`/api/import/preview?source=${selectedSource}`, {
        method: "POST",
        body: formData,
        headers: {
          "X-Import-Options": JSON.stringify(options),
        },
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
        // Start polling for progress
        pollIntervalRef.current = setInterval(async () => {
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
              clearInterval(pollIntervalRef.current!);
              setImportResult(statusData.summary);
              setStep("complete");
              onImportComplete();
            } else if (statusData.status === "failed" || statusData.status === "canceled") {
              clearInterval(pollIntervalRef.current!);
              setError(statusData.errors?.[0]?.error || "Import failed");
              setStep("configure");
            }
          } catch {
            // Ignore polling errors
          }
        }, 1000);
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
        clearInterval(pollIntervalRef.current);
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

  // Get current source config
  const sourceConfig = selectedSource ? DATA_SOURCES.find(s => s.id === selectedSource) : null;

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-[#f6f6f3]/60 dark:bg-[#121212]/80" 
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div 
        className="relative bg-white w-[90vw] max-w-xl flex flex-col shadow-xl border border-gray-300 z-10 rounded-none max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {step !== "select_source" && step !== "complete" && step !== "history" && (
              <button
                onClick={() => {
                  if (step === "upload_preview") {
                    setStep("select_source");
                    setSelectedSource(null);
                    setFile(null);
                    setPreviewData(null);
                  } else if (step === "configure") {
                    setStep("upload_preview");
                    setPreviewData(null);
                  } else if (step === "importing") {
                    handleCancelImport();
                  }
                }}
                className="p-1 hover:bg-[#F3F3F3] transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
            )}
            {step === "history" && (
              <button
                onClick={() => setStep("select_source")}
                className="p-1 hover:bg-[#F3F3F3] transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
            )}
            <h2 className="text-lg font-medium text-gray-900">
              {step === "select_source" && "Import Data"}
              {step === "upload_preview" && sourceConfig?.name}
              {step === "configure" && "Review & Import"}
              {step === "importing" && "Importing..."}
              {step === "complete" && "Import Complete"}
              {step === "history" && "Import History"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {step === "select_source" && (
              <button
                onClick={handleShowHistory}
                className="p-1.5 hover:bg-[#F3F3F3] transition-colors text-gray-500 hover:text-gray-700"
                title="Import History"
              >
                <History className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={cn(
          "flex-1 overflow-y-auto px-5 py-4",
          (step === "select_source" || step === "upload_preview") && "min-h-[360px]"
        )}>
          {/* Step 1: Select Source */}
          {step === "select_source" && (
            <div className="space-y-0">
              {DATA_SOURCES.map((source) => (
                <div
                  key={source.id}
                  className="flex justify-between items-center h-11"
                >
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <DataSourceIcon 
                        source={source.id} 
                        className={cn(
                          "text-gray-900",
                          source.id === "oura" ? "h-7 w-auto" :
                          source.id === "whoop" || source.id === "garmin" ? "h-5 w-auto" :
                          source.id === "csv" ? "h-5 w-5" :
                          "w-5 h-5"
                        )} 
                      />
                    </div>
                    <span className="text-sm font-normal text-gray-900 ml-2.5">{source.name}</span>
                  </div>
                  <button
                    onClick={() => handleSelectSource(source.id)}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Import
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Step 2: Upload & Preview */}
          {step === "upload_preview" && sourceConfig && (
            <div className="space-y-4">
              {/* File Upload */}
              <div
                className={cn(
                  "border border-dashed p-8 text-center transition-colors cursor-pointer min-h-[180px] flex items-center justify-center",
                  isDragging ? "border-gray-400 bg-[#F3F3F3]" : "border-gray-300 hover:border-gray-400",
                  file && "border-gray-400 bg-[#F3F3F3]"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={sourceConfig.acceptedFiles}
                  className="hidden"
                  onChange={handleFileSelect}
                />
                
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <Check className="w-6 h-6 text-gray-600" />
                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); setFile(null); }}
                      className="text-xs text-gray-500 hover:text-gray-700 underline mt-1"
                    >
                      Choose different file
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-6 h-6 text-gray-400" />
                    <p className="text-sm font-medium text-gray-700">Drop your file here</p>
                    <p className="text-xs text-gray-500">or click to browse</p>
                    <p className="text-xs text-gray-400 mt-2">Accepts {sourceConfig.acceptedFiles}</p>
                  </div>
                )}
              </div>

              {/* Instructions */}
              <details className="group">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 list-none flex items-center gap-1">
                  <ChevronDown className="w-3 h-3 -rotate-90 group-open:rotate-0 transition-transform" />
                  How to export from {sourceConfig.name}
                </summary>
                <ol className="list-decimal list-inside space-y-0.5 text-xs text-gray-500 mt-2 pl-4">
                  {sourceConfig.instructions.map((instruction, i) => (
                    <li key={i}>{instruction}</li>
                  ))}
                </ol>
              </details>

              {error && (
                <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 p-3 border border-red-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-normal text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFetchPreview}
                  disabled={!file || isLoading}
                  className="px-5 py-2 text-sm font-normal text-white bg-black hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </span>
                  ) : (
                    "Analyze & Preview"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Configure & Review */}
          {step === "configure" && previewData && (
            <div className="space-y-5">
              {/* Summary - compact inline */}
              <div className="flex items-center justify-between text-sm py-1">
                <div className="flex items-center gap-4">
                  <span className="text-gray-500">{previewData.summary.total_rows} rows</span>
                  <span className="text-gray-300">•</span>
                  <span className="text-green-600 font-medium">{previewData.dedupe_estimate.new_items} new</span>
                  {previewData.dedupe_estimate.duplicates > 0 && (
                    <>
                      <span className="text-gray-300">•</span>
                      <span className="text-gray-400">{previewData.dedupe_estimate.duplicates} duplicates</span>
                    </>
                  )}
                </div>
                {previewData.dedupe_estimate.conflicts > 0 && (
                  <div className="flex items-center gap-1.5 text-red-600 text-xs">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{previewData.dedupe_estimate.conflicts} conflicts</span>
                  </div>
                )}
              </div>

              {/* Conflict Policy */}
              <div>
                <Label className="text-sm font-medium text-gray-900 mb-2 block">When data already exists</Label>
                <Select value={conflictPolicy} onValueChange={(v: ConflictPolicy) => setConflictPolicy(v)}>
                  <SelectTrigger className="border-gray-300 h-11 rounded-none [&>span]:text-left [&>span]:pl-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[10000] rounded-none">
                    {CONFLICT_POLICIES.map((policy) => (
                      <SelectItem key={policy.value} value={policy.value}>
                        <div className="flex flex-col items-start">
                          <span>{policy.label}</span>
                          <span className="text-xs text-gray-500">{policy.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Aggregation */}
              <div>
                <Label className="text-sm font-medium text-gray-900 mb-2 block">Aggregate data by</Label>
                <Select value={aggregation} onValueChange={(v: AggregationPeriod) => setAggregation(v)}>
                  <SelectTrigger className="border-gray-300 h-11 rounded-none [&>span]:text-left [&>span]:pl-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[10000] rounded-none">
                    {AGGREGATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Advanced Options - Collapsed by default */}
              {selectedSource === "csv" && previewData.detected_columns && (
                <details className="group">
                  <summary className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer hover:text-gray-700 select-none">
                    <ChevronDown className="w-3 h-3 -rotate-90 group-open:rotate-0 transition-transform" />
                    <span>Advanced Options</span>
                    <span className="text-xs text-gray-400">(Column mapping usually not needed)</span>
                  </summary>
                  
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                    <p className="text-xs text-gray-400 italic">
                      Smart matching will automatically map CSV columns to your existing habits. 
                      Only use these options if you need to override the automatic detection.
                    </p>
                    
                    <div>
                      <Label className="text-xs text-gray-500 mb-1 block">Date Column</Label>
                      <Select 
                        value={csvMapping.dateColumn} 
                        onValueChange={(v) => setCsvMapping(prev => ({ ...prev, dateColumn: v }))}
                      >
                        <SelectTrigger className="border-gray-300 h-9 text-sm rounded-none">
                          <SelectValue placeholder="Auto-detected" />
                        </SelectTrigger>
                        <SelectContent className="z-[10000] rounded-none">
                          {previewData.detected_columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {csvMapping.valueColumns.length > 0 && csvMapping.valueColumns.map((vc, i) => (
                      <div key={i} className="grid grid-cols-3 gap-2">
                        <Select 
                          value={vc.column}
                          onValueChange={(v) => {
                            const updated = [...csvMapping.valueColumns];
                            updated[i] = { ...updated[i], column: v, habitName: v };
                            setCsvMapping(prev => ({ ...prev, valueColumns: updated }));
                          }}
                        >
                          <SelectTrigger className="border-gray-300 h-8 text-sm rounded-none">
                            <SelectValue placeholder="Column" />
                          </SelectTrigger>
                          <SelectContent className="z-[10000] rounded-none">
                            {previewData.detected_columns?.map((col) => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <input
                          type="text"
                          value={vc.habitName}
                          onChange={(e) => {
                            const updated = [...csvMapping.valueColumns];
                            updated[i] = { ...updated[i], habitName: e.target.value };
                            setCsvMapping(prev => ({ ...prev, valueColumns: updated }));
                          }}
                          placeholder="Habit name"
                          className="px-3 py-1.5 border border-gray-300 text-sm h-8 focus:outline-none focus:border-gray-400"
                        />
                        <input
                          type="text"
                          value={vc.unit}
                          onChange={(e) => {
                            const updated = [...csvMapping.valueColumns];
                            updated[i] = { ...updated[i], unit: e.target.value };
                            setCsvMapping(prev => ({ ...prev, valueColumns: updated }));
                          }}
                          placeholder="Unit"
                          className="px-3 py-1.5 border border-gray-300 text-sm h-8 focus:outline-none focus:border-gray-400"
                        />
                      </div>
                    ))}
                    
                    <button
                      onClick={() => setCsvMapping(prev => ({
                        ...prev,
                        valueColumns: [...prev.valueColumns, { column: "", habitName: "", unit: "" }]
                      }))}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      + Add column override
                    </button>
                  </div>
                </details>
              )}

              {/* Sample Data Preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium text-gray-900">Sample Data</Label>
                  {previewData.sample_items.length > 5 && (
                    <button
                      onClick={() => setShowAllItems(!showAllItems)}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      {showAllItems ? "Show less" : `Show all ${previewData.sample_items.length}`}
                    </button>
                  )}
                </div>
                <div className="border border-gray-200 max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#FAFAF9] sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Habit</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Value</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllItems ? previewData.sample_items : previewData.sample_items.slice(0, 5)).map((item, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-900">{item.habit_name || item.habit_key}</td>
                          <td className="px-3 py-2 text-gray-600">{item.date}</td>
                          <td className="px-3 py-2 text-right text-gray-900">
                            {item.amount?.toLocaleString()}{item.unit_type && <span className="text-gray-400 ml-1">{item.unit_type}</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {item.validation_status === "ok" ? (
                              <Check className="w-3.5 h-3.5 text-green-500 mx-auto" />
                            ) : item.validation_status === "warning" ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400 mx-auto" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Validation Issues */}
              {previewData.validation_issues.length > 0 && (
                <div className="bg-red-50 border border-red-200 p-3 rounded-none">
                  <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    {previewData.validation_issues.length} items have issues
                  </div>
                  <ul className="text-xs text-red-600 space-y-1">
                    {previewData.validation_issues.slice(0, 3).map((item, i) => (
                      <li key={i}>
                        Row {item.row_index}: {item.validation_messages?.[0]?.message || "Invalid data"}
                      </li>
                    ))}
                    {previewData.validation_issues.length > 3 && (
                      <li className="text-red-500">...and {previewData.validation_issues.length - 3} more</li>
                    )}
                  </ul>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 p-3 border border-red-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-normal text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartImport}
                  disabled={isLoading || previewData.dedupe_estimate.new_items === 0}
                  className="px-5 py-2 text-sm font-normal text-white bg-black hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Import {previewData.dedupe_estimate.new_items.toLocaleString()} Records
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Importing Progress */}
          {step === "importing" && (
            <div className="py-8 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
              <div>
                <p className="text-sm font-medium text-gray-900">Importing your data...</p>
                {importProgress.total > 0 && (
                  <>
                    <div className="w-full bg-gray-200 h-2 mt-3 mb-2">
                      <div 
                        className="bg-black h-2 transition-all duration-300"
                        style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {importProgress.current.toLocaleString()} of {importProgress.total.toLocaleString()}
                    </p>
                  </>
                )}
              </div>
              <button
                onClick={handleCancelImport}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Step 5: Complete */}
          {step === "complete" && importResult && (
            <div className="py-8 text-center space-y-4">
              <div className="w-12 h-12 border-2 border-green-500 flex items-center justify-center mx-auto rounded-full">
                <Check className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-lg font-medium text-gray-900">Import Complete!</p>
                <div className="mt-3 text-sm text-gray-600 space-y-1">
                  <p><span className="font-medium text-gray-900">{importResult.imported.toLocaleString()}</span> records imported</p>
                  {importResult.updated > 0 && (
                    <p><span className="font-medium text-gray-900">{importResult.updated.toLocaleString()}</span> records updated</p>
                  )}
                  {importResult.skipped > 0 && (
                    <p className="text-gray-500">{importResult.skipped.toLocaleString()} skipped (duplicates)</p>
                  )}
                  {importResult.errors > 0 && (
                    <p className="text-red-500">{importResult.errors.toLocaleString()} errors</p>
                  )}
                </div>
              </div>
              <div className="flex justify-center gap-3 pt-2">
                {importRunId && (
                  <button
                    onClick={() => handleUndoImport(importRunId)}
                    disabled={isLoading}
                    className="px-4 py-2 text-sm font-normal text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Undo
                  </button>
                )}
                <button
                  onClick={handleClose}
                  className="px-5 py-2 text-sm font-normal text-white bg-black hover:bg-gray-800 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Import History */}
          {step === "history" && (
            <div className="space-y-3">
              {isLoadingHistory ? (
                <div className="py-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                </div>
              ) : importHistory.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm">No import history yet</p>
                </div>
              ) : (
                importHistory.map((run) => (
                  <div key={run.id} className="border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <DataSourceIcon source={run.source as DataSource} className="w-4 h-4 text-gray-600" />
                        <span className="text-sm font-medium text-gray-900">{run.file_name || run.source}</span>
                      </div>
                      <span className={cn(
                        "text-xs px-2 py-0.5",
                        run.status === "completed" ? "bg-green-100 text-green-700" :
                        run.status === "failed" ? "bg-red-100 text-red-700" :
                        run.status === "undone" ? "bg-gray-100 text-gray-600" :
                        "bg-gray-100 text-gray-600"
                      )}>
                        {run.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>{new Date(run.created_at).toLocaleDateString()} at {new Date(run.created_at).toLocaleTimeString()}</p>
                      {run.summary && (
                        <p>{run.summary.imported} imported, {run.summary.skipped} skipped</p>
                      )}
                    </div>
                    {run.undo_available && run.status === "completed" && (
                      <button
                        onClick={() => handleUndoImport(run.id)}
                        disabled={isLoading}
                        className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Undo import
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
