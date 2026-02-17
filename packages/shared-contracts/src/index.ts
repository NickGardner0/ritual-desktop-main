/**
 * @ritual/shared-contracts
 * 
 * Shared types and contracts used across:
 * - Desktop app (Tauri + Next.js)
 * - iOS companion app (SwiftUI)
 * - Backend (FastAPI)
 */

// Normalized metric types
export type {
  WearableSource,
  MetricType,
  Unit,
  NormalizedMetric,
  WearableDevice,
} from "./normalized";

// Apple Health ingest contract
export type {
  AppleIngestRequest,
  AppleIngestResult,
  AppleIngestResponse,
  DeviceRegisterRequest,
  DeviceRegisterResponse,
} from "./apple_ingest";

export { buildCanonicalString } from "./apple_ingest";

// Computer activity analytics contracts
export type {
  ActivityEvent,
  SessionKind,
  SessionSegment,
  SparklinePoint,
  AttentionHeader,
  RankedBar,
  MicroMetrics,
  ComputerActivityViewModel,
  TimeRangePreset,
  TimeRange,
  DailyRollup,
  DrillDownData,
  UsageBreakdownKind,
  BreakdownPoint,
  BreakdownResponse,
} from "./computer-activity";
export {
  KIND_COLORS,
  KIND_COLORS_ACCENT,
} from "./computer-activity";
