export type BiometricsSourceType = "whoop_ble_ios" | "whoop_ble_mac";

export interface LiveBiometrics {
  current_bpm: number | null;
  current_source_type: BiometricsSourceType | null;
  latest_sample_at: string | null;
  connection_state: string;
  is_stale: boolean;
}

export interface HeartRateSamplePoint {
  source_type: BiometricsSourceType;
  received_at: string;
  bpm_raw: number;
  bpm_display: number;
  is_outlier?: boolean | null;
}

export interface HeartRateRollup1mPoint {
  source_type: BiometricsSourceType;
  bucket_start: string;
  bpm_avg: number;
  bpm_min: number;
  bpm_max: number;
  sample_count: number;
}

export interface HeartRateRangeResponse {
  resolution: "raw" | "1m";
  points: Array<HeartRateSamplePoint | HeartRateRollup1mPoint>;
}

export interface HeartRateDaySummary {
  day: string;
  average_bpm: number | null;
  min_bpm: number | null;
  max_bpm: number | null;
  total_samples: number;
  lowest_window?: {
    bucket_start: string;
    bpm_avg: number;
    bpm_min: number;
    bpm_max: number;
    sample_count: number;
    source_type: BiometricsSourceType;
  } | null;
  highest_window?: {
    bucket_start: string;
    bpm_avg: number;
    bpm_min: number;
    bpm_max: number;
    sample_count: number;
    source_type: BiometricsSourceType;
  } | null;
  source_breakdown: Array<{
    source_type: BiometricsSourceType;
    sample_count: number;
    average_bpm: number | null;
    min_bpm: number | null;
    max_bpm: number | null;
  }>;
}

export interface HeartRateRangeParams {
  start: string;
  end: string;
  resolution?: "raw" | "1m";
  sourceType?: BiometricsSourceType;
}

