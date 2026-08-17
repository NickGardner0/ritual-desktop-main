export type NativeUpdateStatusPayload = {
  version?: number;
  phase?: string;
  contentLength?: number | null;
  downloaded?: number | null;
  percentage?: number | null;
  message?: string | null;
  status?: string | null;
  error?: string | null;
};

export function decodeDesktopUpdateEvent(payload?: NativeUpdateStatusPayload): {
  phase: string;
  contentLength: number;
  downloaded: number;
  percentage: number;
  message: string | null;
} | null;

export function reduceDesktopUpdateEvent<T>(snapshot: T, payload: NativeUpdateStatusPayload): T;
