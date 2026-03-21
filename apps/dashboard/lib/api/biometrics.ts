import { API_CONFIG } from "@/lib/api-config";
import type {
  HeartRateDaySummary,
  HeartRateRangeParams,
  HeartRateRangeResponse,
  LiveBiometrics,
} from "@/lib/types/biometrics";

async function request<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_CONFIG.PYTHON_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export function getLiveBiometrics(token: string): Promise<LiveBiometrics> {
  return request<LiveBiometrics>("/api/v1/biometrics/live", token);
}

export function getHeartRateRange(
  token: string,
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

  return request<HeartRateRangeResponse>(
    `/api/v1/biometrics/heart-rate/range?${query.toString()}`,
    token,
  );
}

export function getHeartRateDaySummary(
  token: string,
  day: string,
): Promise<HeartRateDaySummary> {
  const query = new URLSearchParams({ day });
  return request<HeartRateDaySummary>(
    `/api/v1/biometrics/heart-rate/day-summary?${query.toString()}`,
    token,
  );
}

