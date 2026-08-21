import { apiJsonWithAuth } from "@/lib/api/client";
import type {
  HeartRateRangeParams,
  HeartRateRangeResponse,
} from "@/lib/types/biometrics";

type GetToken = (opts?: { skipCache?: boolean }) => Promise<string | null>;

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
