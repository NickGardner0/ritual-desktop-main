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
  AppleIngestRequestV2,
  AppleIngestResponseV2,
  DeleteResult,
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
  ActivityBreakdownSource,
  ActivityBreakdownCapabilities,
  ComputerActivityViewModel,
  ActivityBreakdownViewModel,
  TimeRangePreset,
  TimeRange,
  DailyRollup,
  DrillDownData,
  UsageBreakdownKind,
  BreakdownPoint,
  BreakdownResponse,
  ComputerActivityRangeParams,
  ComputerSummaryResponse,
  ComputerDailyResponseRow,
  TopAppResponseRow,
  TopDomainResponseRow,
  AggregatedComputerStatsResponse,
} from "./computer-activity";
export {
  KIND_COLORS,
  KIND_COLORS_ACCENT,
} from "./computer-activity";

export type {
  WearableProvider,
  WearableAuthMethod,
  WearableConnectionStatus,
  WearableCapability,
  WearableConnection,
  WearableSample,
  WearableEvent,
  WearableSyncRun,
  WearableConnectionsResponse,
  WearableConnectionActionResponse,
  WearableSyncResponse,
} from "./wearables-unified";

export type { CreateHabitInput, HabitRecord } from "./habits";
