"use client";

import React, { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  Upload,
  FileArchive,
  Check,
  AlertCircle,
  Loader2,
  Calendar,
  Activity,
  Heart,
  Moon,
  Footprints,
  Flame,
  Timer,
  Wind,
  Droplets,
  Brain,
  X,
} from "lucide-react";

// Apple Health record types we support
const SUPPORTED_METRICS = {
  HKQuantityTypeIdentifierStepCount: {
    label: "Steps",
    icon: Footprints,
    unit: "steps",
    habitName: "Steps",
  },
  HKQuantityTypeIdentifierHeartRate: {
    label: "Heart Rate",
    icon: Heart,
    unit: "BPM",
    habitName: "Heart Rate",
  },
  HKQuantityTypeIdentifierActiveEnergyBurned: {
    label: "Active Calories",
    icon: Flame,
    unit: "kcal",
    habitName: "Active Calories",
  },
  HKQuantityTypeIdentifierBasalEnergyBurned: {
    label: "Resting Calories",
    icon: Flame,
    unit: "kcal",
    habitName: "Resting Calories",
  },
  HKQuantityTypeIdentifierDistanceWalkingRunning: {
    label: "Walking/Running Distance",
    icon: Activity,
    unit: "miles",
    habitName: "Walking Distance",
  },
  HKQuantityTypeIdentifierFlightsClimbed: {
    label: "Flights Climbed",
    icon: Activity,
    unit: "floors",
    habitName: "Flights Climbed",
  },
  HKQuantityTypeIdentifierAppleExerciseTime: {
    label: "Exercise Minutes",
    icon: Timer,
    unit: "minutes",
    habitName: "Exercise Time",
  },
  HKQuantityTypeIdentifierAppleStandTime: {
    label: "Stand Time",
    icon: Timer,
    unit: "minutes",
    habitName: "Stand Time",
  },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    label: "Heart Rate Variability (HRV)",
    icon: Heart,
    unit: "ms",
    habitName: "HRV",
  },
  HKQuantityTypeIdentifierRestingHeartRate: {
    label: "Resting Heart Rate",
    icon: Heart,
    unit: "BPM",
    habitName: "Resting Heart Rate",
  },
  HKQuantityTypeIdentifierOxygenSaturation: {
    label: "Blood Oxygen (SpO2)",
    icon: Droplets,
    unit: "%",
    habitName: "Blood Oxygen",
  },
  HKQuantityTypeIdentifierRespiratoryRate: {
    label: "Respiratory Rate",
    icon: Wind,
    unit: "breaths/min",
    habitName: "Respiratory Rate",
  },
  HKCategoryTypeIdentifierSleepAnalysis: {
    label: "Sleep",
    icon: Moon,
    unit: "hours",
    habitName: "Sleep",
  },
  HKCategoryTypeIdentifierMindfulSession: {
    label: "Mindfulness",
    icon: Brain,
    unit: "minutes",
    habitName: "Mindfulness",
  },
} as const;

type MetricType = keyof typeof SUPPORTED_METRICS;

interface ParsedMetric {
  type: MetricType;
  count: number;
  earliestDate: string;
  latestDate: string;
}

interface ParseResult {
  success: boolean;
  metrics: ParsedMetric[];
  totalRecords: number;
  dateRange: {
    start: string;
    end: string;
  };
  error?: string;
}

interface ImportProgress {
  current: number;
  total: number;
  currentMetric: string;
}

interface ImportResult {
  success: boolean;
  imported: number;
  errors: number;
  message: string;
}

interface AppleHealthImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

type Step = "upload" | "configure" | "importing" | "complete";

export function AppleHealthImportModal({
  isOpen,
  onClose,
  onImportComplete,
}: AppleHealthImportModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<MetricType>>(new Set());
  const [dateRange, setDateRange] = useState<string>("all");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal closes
  const handleClose = useCallback(() => {
    setStep("upload");
    setFile(null);
    setParseResult(null);
    setSelectedMetrics(new Set());
    setDateRange("all");
    setCustomStartDate("");
    setCustomEndDate("");
    setError(null);
    setImportProgress(null);
    setImportResult(null);
    onClose();
  }, [onClose]);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith(".zip") || droppedFile.name.endsWith(".xml"))) {
      setFile(droppedFile);
      setError(null);
    } else {
      setError("Please upload a .zip or .xml file exported from Apple Health");
    }
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith(".zip") || selectedFile.name.endsWith(".xml")) {
        setFile(selectedFile);
        setError(null);
      } else {
        setError("Please upload a .zip or .xml file exported from Apple Health");
      }
    }
  }, []);

  // Parse the uploaded file
  const handleParseFile = useCallback(async () => {
    if (!file) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/import/apple-health/parse", {
        method: "POST",
        body: formData,
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to parse file");
      }
      
      setParseResult(result);
      // Pre-select all metrics
      setSelectedMetrics(new Set(result.metrics.map((m: ParsedMetric) => m.type)));
      setStep("configure");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setIsLoading(false);
    }
  }, [file]);

  // Toggle metric selection
  const toggleMetric = useCallback((metric: MetricType) => {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(metric)) {
        next.delete(metric);
      } else {
        next.add(metric);
      }
      return next;
    });
  }, []);

  // Calculate date filter based on selection
  const getDateFilter = useCallback(() => {
    const now = new Date();
    switch (dateRange) {
      case "30days":
        const d30 = new Date(now);
        d30.setDate(d30.getDate() - 30);
        return { start: d30.toISOString().split("T")[0], end: now.toISOString().split("T")[0] };
      case "90days":
        const d90 = new Date(now);
        d90.setDate(d90.getDate() - 90);
        return { start: d90.toISOString().split("T")[0], end: now.toISOString().split("T")[0] };
      case "1year":
        const d1y = new Date(now);
        d1y.setFullYear(d1y.getFullYear() - 1);
        return { start: d1y.toISOString().split("T")[0], end: now.toISOString().split("T")[0] };
      case "custom":
        return { start: customStartDate, end: customEndDate };
      default:
        return null; // All time
    }
  }, [dateRange, customStartDate, customEndDate]);

  // Start import
  const handleImport = useCallback(async () => {
    if (!file || selectedMetrics.size === 0) return;
    
    setStep("importing");
    setIsLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("metrics", JSON.stringify(Array.from(selectedMetrics)));
      
      const dateFilter = getDateFilter();
      if (dateFilter) {
        formData.append("startDate", dateFilter.start);
        formData.append("endDate", dateFilter.end);
      }
      
      const response = await fetch("/api/import/apple-health/import", {
        method: "POST",
        body: formData,
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Import failed");
      }
      
      setImportResult(result);
      setStep("complete");
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("configure");
    } finally {
      setIsLoading(false);
    }
  }, [file, selectedMetrics, getDateFilter, onImportComplete]);

  // Calculate estimated records based on date filter
  const getEstimatedRecords = useCallback(() => {
    if (!parseResult) return 0;
    
    const dateFilter = getDateFilter();
    if (!dateFilter) {
      return parseResult.metrics
        .filter((m) => selectedMetrics.has(m.type))
        .reduce((sum, m) => sum + m.count, 0);
    }
    
    // Rough estimate based on date range proportion
    const totalDays = Math.ceil(
      (new Date(parseResult.dateRange.end).getTime() - new Date(parseResult.dateRange.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const selectedDays = Math.ceil(
      (new Date(dateFilter.end).getTime() - new Date(dateFilter.start).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const ratio = Math.min(1, selectedDays / totalDays);
    
    return Math.round(
      parseResult.metrics
        .filter((m) => selectedMetrics.has(m.type))
        .reduce((sum, m) => sum + m.count, 0) * ratio
    );
  }, [parseResult, selectedMetrics, getDateFilter]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5 text-red-500" />
            Import Apple Health Data
          </DialogTitle>
          <DialogDescription>
            Import your health data from an Apple Health export file
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-amber-800 mb-2">How to export your Apple Health data:</p>
              <ol className="list-decimal list-inside text-amber-700 space-y-1">
                <li>Open the <strong>Health</strong> app on your iPhone</li>
                <li>Tap your profile picture in the top right</li>
                <li>Scroll down and tap <strong>Export All Health Data</strong></li>
                <li>Wait for the export to complete (this may take a few minutes)</li>
                <li>Save or share the .zip file to your computer</li>
              </ol>
            </div>

            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400",
                file && "border-green-500 bg-green-50"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.xml"
                className="hidden"
                onChange={handleFileSelect}
              />
              
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <Check className="h-10 w-10 text-green-500" />
                  <p className="font-medium text-green-700">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                  >
                    Choose different file
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-10 w-10 text-gray-400" />
                  <p className="font-medium">Drop your Apple Health export here</p>
                  <p className="text-sm text-gray-500">or click to browse</p>
                  <p className="text-xs text-gray-400">Accepts .zip or .xml files</p>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleParseFile} disabled={!file || isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Configure */}
        {step === "configure" && parseResult && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600">
                Found <strong>{parseResult.totalRecords.toLocaleString()}</strong> records across{" "}
                <strong>{parseResult.metrics.length}</strong> metrics
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Data from {new Date(parseResult.dateRange.start).toLocaleDateString()} to{" "}
                {new Date(parseResult.dateRange.end).toLocaleDateString()}
              </p>
            </div>

            {/* Metric Selection */}
            <div>
              <Label className="text-sm font-medium mb-3 block">Select metrics to import:</Label>
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {parseResult.metrics.map((metric) => {
                  const info = SUPPORTED_METRICS[metric.type];
                  const Icon = info?.icon || Activity;
                  return (
                    <div
                      key={metric.type}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedMetrics.has(metric.type)
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      )}
                      onClick={() => toggleMetric(metric.type)}
                    >
                      <Checkbox
                        checked={selectedMetrics.has(metric.type)}
                        onCheckedChange={() => toggleMetric(metric.type)}
                      />
                      <Icon className="h-4 w-4 text-gray-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {info?.label || metric.type}
                        </p>
                        <p className="text-xs text-gray-500">
                          {metric.count.toLocaleString()} records
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMetrics(new Set(parseResult.metrics.map((m) => m.type)))}
                >
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMetrics(new Set())}
                >
                  Clear All
                </Button>
              </div>
            </div>

            {/* Date Range */}
            <div>
              <Label className="text-sm font-medium mb-3 block">Date range:</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="30days">Last 30 days</SelectItem>
                  <SelectItem value="90days">Last 90 days</SelectItem>
                  <SelectItem value="1year">Last year</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>

              {dateRange === "custom" && (
                <div className="flex gap-4 mt-3">
                  <div className="flex-1">
                    <Label className="text-xs text-gray-500">Start date</Label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-gray-500">End date</Label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Estimated Import */}
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <Calendar className="h-4 w-4 inline mr-2" />
                Estimated import: <strong>~{getEstimatedRecords().toLocaleString()}</strong> records
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={selectedMetrics.size === 0 || isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `Import ${selectedMetrics.size} metric${selectedMetrics.size !== 1 ? "s" : ""}`
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Importing */}
        {step === "importing" && (
          <div className="py-8 text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
            <div>
              <p className="font-medium">Importing your health data...</p>
              <p className="text-sm text-gray-500 mt-1">This may take a few minutes for large exports</p>
            </div>
            {importProgress && (
              <div className="space-y-2">
                <Progress value={(importProgress.current / importProgress.total) * 100} />
                <p className="text-xs text-gray-500">
                  {importProgress.currentMetric}: {importProgress.current.toLocaleString()} /{" "}
                  {importProgress.total.toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Complete */}
        {step === "complete" && importResult && (
          <div className="py-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <p className="text-xl font-medium text-green-700">Import Complete!</p>
              <p className="text-gray-600 mt-2">
                Successfully imported <strong>{importResult.imported.toLocaleString()}</strong> records
              </p>
              {importResult.errors > 0 && (
                <p className="text-sm text-amber-600 mt-1">
                  {importResult.errors} records skipped due to errors
                </p>
              )}
            </div>
            <Button onClick={handleClose} className="mt-4">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

