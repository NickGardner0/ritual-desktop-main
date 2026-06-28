import { apiJsonWithAuth } from "@/lib/api/client";
import type {
  HeartRateDaySummary,
  HeartRateRangeParams,
  HeartRateRangeResponse,
  LiveBiometrics,
} from "@/lib/types/biometrics";

type GetToken = (opts?: { skipCache?: boolean }) => Promise<string | null>;

export function getLiveBiometrics(getToken: GetToken): Promise<LiveBiometrics> {
  return apiJsonWithAuth<LiveBiometrics>("/api/v1/biometrics/live", getToken);
}

export function getHeartRateRange(
  getToken: GetToken,
  params: HeartRateRangeParams,
): Promise<HeartRateRangeResponse> {
  const query = new URLSearchParams({
    start: params.start,
    end: params.end,
    resolution: params.resolution ?? "1m",
  });

  if (params.sourceType) {
    query.set("source_type", params.sourceType);
  }

  return apiJsonWithAuth<HeartRateRangeResponse>(
    `/api/v1/biometrics/heart-rate/range?${query.toString()}`,
    getToken,
  );
}

export function getHeartRateDaySummary(
  getToken: GetToken,
  day: string,
): Promise<HeartRateDaySummary> {
  const query = new URLSearchParams({ day });
  return apiJsonWithAuth<HeartRateDaySummary>(
    `/api/v1/biometrics/heart-rate/day-summary?${query.toString()}`,
    getToken,
  );
}
