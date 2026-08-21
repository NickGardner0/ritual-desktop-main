export type BiometricsSourceType = "whoop_ble_ios" | "whoop_ble_mac";

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

export interface HeartRateRangeParams {
  start: string;
  end: string;
  resolution?: "raw" | "1m";
  sourceType?: BiometricsSourceType;
}
