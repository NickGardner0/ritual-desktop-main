import Image from "next/image";
import { Camera } from "lucide-react";

import { cn } from "@/lib/utils";

export type DataSource = "apple_health" | "whoop" | "csv" | "screenshot" | "oura" | "garmin";
export type ConflictPolicy = "skip_existing" | "overwrite_existing" | "merge_sum";
export type AggregationPeriod = "raw" | "daily" | "weekly" | "monthly";

export interface DataSourceConfig {
  id: DataSource;
  name: string;
  acceptedFiles: string;
  instructions: string[];
}

export interface ValidationMessage {
  type: "error" | "warning" | "info";
  code: string;
  message: string;
  field?: string;
  suggested_fix?: string;
  auto_fixable?: boolean;
}

export interface ConfidenceInfo {
  score: number;
  reasons: string[];
  match_type?: string;
  inferred_fields?: string[];
}

export interface ConflictDetail {
  existing_log_id: string;
  existing_value?: number;
  existing_date: string;
  incoming_value?: number;
  resolution: string;
  diff_percent?: number;
}

export interface ImportItem {
  habit_key: string;
  habit_name?: string;
  date: string;
  amount?: number;
  unit_type?: string;
  validation_status: "ok" | "warning" | "error";
  validation_messages?: ValidationMessage[];
  conflict_status?: string;
  row_index?: number;
  confidence?: ConfidenceInfo;
  original_amount?: number;
  transform_applied?: string;
  conflict_detail?: ConflictDetail;
}

export interface ImportRunSummary {
  total_rows: number;
  parsed: number;
  imported: number;
  skipped: number;
  updated: number;
  duplicates: number;
  errors: number;
  created_habit_ids?: string[];
  will_create?: number;
  will_update?: number;
  will_skip?: number;
  has_warnings?: number;
  has_errors?: number;
  auto_fixable?: number;
}

export interface ConfidenceSummary {
  high: number;
  medium: number;
  low: number;
}

export interface ValidationSummary {
  total_errors: number;
  total_warnings: number;
  auto_fixable_count: number;
}

export interface ImportPreviewResponse {
  import_run_id: string;
  source: string;
  resumed?: boolean;
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
  confidence_summary?: ConfidenceSummary;
  validation_summary?: ValidationSummary;
}

export interface ImportRun {
  id: string;
  source: string;
  status: string;
  file_name?: string;
  created_at: string;
  summary?: ImportRunSummary;
  undo_available: boolean;
}

export function DataSourceIcon({ source, className }: { source: DataSource; className?: string }) {
  switch (source) {
    case "apple_health":
      return (
        <svg className={className} viewBox="0 0 814 1000" fill="currentColor">
          <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
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

export const DATA_SOURCES: DataSourceConfig[] = [
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

export const CONFLICT_POLICIES: { value: ConflictPolicy; label: string; description: string }[] = [
  { value: "skip_existing", label: "Skip existing", description: "Don't modify existing data" },
  { value: "overwrite_existing", label: "Overwrite", description: "Replace existing values" },
  { value: "merge_sum", label: "Add together", description: "Sum with existing values" },
];

export const AGGREGATION_OPTIONS: { value: AggregationPeriod; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "raw", label: "No aggregation" },
];
