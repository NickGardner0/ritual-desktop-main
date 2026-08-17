import { apiOperationWithAuth } from "@/lib/api/client";
import type {
  HeartRateDaySummary,
  HeartRateRangeParams,
  HeartRateRangeResponse,
  LiveBiometrics,
} from "@/lib/types/biometrics";

type GetToken = (opts?: { skipCache?: boolean }) => Promise<string | null>;

export function getLiveBiometrics(getToken: GetToken): Promise<LiveBiometrics> {
  return apiOperationWithAuth(
    "get_live_biometrics_api_v1_biometrics_live_get",
    getToken,
  ).then((response) => ({
    current_bpm: response.current_bpm ?? null,
    current_source_type: (response.current_source_type as LiveBiometrics["current_source_type"]) ?? null,
    latest_sample_at: response.latest_sample_at ?? null,
    connection_state: response.connection_state ?? "unknown",
    is_stale: response.is_stale ?? true,
  }));
}

export function getHeartRateRange(
  getToken: GetToken,
  params: HeartRateRangeParams,
): Promise<HeartRateRangeResponse> {
  return apiOperationWithAuth(
    "get_heart_rate_range_api_v1_biometrics_heart_rate_range_get",
    getToken,
    {
      query: {
        start: params.start,
        end: params.end,
        resolution: params.resolution ?? "1m",
        source_type: params.sourceType ?? null,
      },
    },
  ).then((response) => response as HeartRateRangeResponse);
}

export function getHeartRateDaySummary(
  getToken: GetToken,
  day: string,
): Promise<HeartRateDaySummary> {
  return apiOperationWithAuth(
    "get_heart_rate_day_summary_api_v1_biometrics_heart_rate_day_summary_get",
    getToken,
    { query: { day } },
  ).then((response) => ({
    day: response.day,
    average_bpm: response.average_bpm ?? null,
    min_bpm: response.min_bpm ?? null,
    max_bpm: response.max_bpm ?? null,
    total_samples: response.total_samples ?? 0,
    lowest_window: (response.lowest_window as HeartRateDaySummary["lowest_window"]) ?? null,
    highest_window: (response.highest_window as HeartRateDaySummary["highest_window"]) ?? null,
    source_breakdown: (response.source_breakdown as HeartRateDaySummary["source_breakdown"]) ?? [],
  }));
}
