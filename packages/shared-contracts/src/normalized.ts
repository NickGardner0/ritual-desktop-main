/**
 * Normalized Wearable Metrics Schema
 * 
 * Design principles:
 * - Backend is single source of truth
 * - Always store raw payload for debugging
 * - Always store time window (start_time, end_time)
 * - Keep metrics minimal but extensible
 */

export type WearableSource = 
  | "whoop" 
  | "apple_health" 
  | "apple_screen_time"
  | "oura" 
  | "garmin" 
  | "fitbit";

export type MetricType =
  // Activity
  | "sleep_session"
  | "sleep_asleep"
  | "sleep_awake"
  | "sleep_rem"
  | "sleep_deep"
  | "sleep_core"
  | "hr"
  | "hrv"
  | "steps"
  | "active_energy"
  | "basal_energy"
  | "distance"
  | "flights_climbed"
  | "exercise_time"
  | "stand_time"
  | "resting_hr"
  | "walking_hr"
  | "respiratory_rate"
  | "oxygen_saturation"
  | "workout"
  | "mindful_minutes"
  | "screen_time_total"
  | "screen_time_app_usage"
  | "screen_time_web_domain_usage";

export type Unit =
  | "count"
  | "bpm"
  | "ms"
  | "kcal"
  | "seconds"
  | "minutes"
  | "hours"
  | "meters"
  | "km"
  | "miles"
  | "percent"
  | "breaths_per_minute";

/**
 * Canonical normalized metric format for all wearable data sources.
 * This is the format that gets stored in the database and used across
 * the desktop app, iOS companion, and backend.
 */
export interface NormalizedMetric {
  // Identity
  /** Backend-resolved user ID from auth; client can omit */
  user_id?: string;
  /** Source of the metric (apple_health for iOS companion) */
  source: WearableSource;
  /** Type of metric being recorded */
  metric_type: MetricType;

  // Time window
  /** ISO8601 start time of the metric window */
  start_time: string;
  /** ISO8601 end time of the metric window */
  end_time: string;
  /** IANA timezone identifier (e.g., "America/New_York") */
  timezone?: string;

  // Value
  /** The metric value */
  value: number;
  /** Unit of the value */
  unit: Unit;

  // Optional context
  /** Confidence score 0..1 (optional, for future use) */
  confidence?: number;
  /** Device identifier assigned by our backend */
  device_id?: string;
  /** Stable ID from source (e.g., Apple Health sample UUID) */
  external_id?: string;
  /** Source app bundle ID (e.g., com.apple.health) */
  source_bundle_id?: string;
  /** Source device name (e.g., Apple Watch Series 9) */
  source_device_name?: string;
  /** Day this metric belongs to in UI (YYYY-MM-DD) */
  attributed_date?: string;

  // Metadata
  /** ISO8601 timestamp when the metric was captured on device */
  recorded_at?: string;
  /** Original payload from HealthKit/source for debugging */
  raw_payload?: unknown;
}

/**
 * Device registration info
 */
export interface WearableDevice {
  /** Unique device identifier (UUID assigned by backend) */
  device_id: string;
  /** User-assigned device name (e.g., "Nick's iPhone") */
  device_name: string;
  /** Platform identifier */
  platform: "ios" | "android" | "web";
  /** User ID who owns this device */
  user_id: string;
  /** ISO8601 timestamp when device was registered */
  registered_at: string;
  /** ISO8601 timestamp of last successful sync */
  last_sync_at?: string;
  /** Whether the device is currently active */
  is_active: boolean;
}
