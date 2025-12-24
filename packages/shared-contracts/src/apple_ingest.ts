/**
 * Apple Health Ingest API Contract
 * 
 * Defines the request/response shapes for the iOS companion app
 * to send normalized metrics to the backend.
 */

import type { NormalizedMetric } from "./normalized";

/**
 * Request payload for ingesting Apple Health metrics
 */
export interface AppleIngestRequest {
  /** Device ID from registration */
  device_id: string;
  /** Client-generated UUID for idempotency */
  client_event_id: string;
  /** ISO8601 timestamp when data was captured on device */
  captured_at: string;
  /** Array of normalized metrics to ingest */
  metrics: NormalizedMetric[];
  /** Optional: HealthKit anchor token for incremental sync */
  hk_anchor?: string;
  /** Schema version for forward compatibility (start at 1) */
  schema_version: number;
  /** HMAC-SHA256 signature for request verification */
  signature: string;
}

/**
 * Per-metric result in the ingest response
 */
export interface AppleIngestResult {
  /** Index of the metric in the request array */
  index: number;
  /** Whether this metric was successfully stored */
  success: boolean;
  /** Backend-assigned ID if stored successfully */
  stored_id?: string;
  /** Error message if ingestion failed */
  error?: string;
}

/**
 * Response from the ingest endpoint
 */
export interface AppleIngestResponse {
  /** Overall success (true if at least one metric stored) */
  success: boolean;
  /** Per-metric results */
  results: AppleIngestResult[];
  /** ISO8601 server time when request was processed */
  server_time: string;
  /** Suggested seconds until next poll (for rate limiting) */
  next_poll_seconds?: number;
}

/**
 * Request to register a new device
 */
export interface DeviceRegisterRequest {
  /** User-friendly device name (e.g., "Nick's iPhone") */
  device_name: string;
  /** Platform identifier */
  platform: "ios" | "android";
}

/**
 * Response from device registration
 */
export interface DeviceRegisterResponse {
  /** Assigned device ID (store this in Keychain) */
  device_id: string;
  /** Device secret for request signing (store securely in Keychain) */
  device_secret: string;
  /** ISO8601 timestamp when device was registered */
  registered_at: string;
}

/**
 * Signature verification helper
 * 
 * Canonical string format for HMAC-SHA256 signing:
 * device_id + "\n" +
 * client_event_id + "\n" +
 * captured_at + "\n" +
 * sha256(JSON.stringify(metrics))
 */
export function buildCanonicalString(
  device_id: string,
  client_event_id: string,
  captured_at: string,
  metrics_hash: string
): string {
  return `${device_id}\n${client_event_id}\n${captured_at}\n${metrics_hash}`;
}
