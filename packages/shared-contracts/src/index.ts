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
