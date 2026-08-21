'use client';

import { BackendClientError, createBackendClient } from '@/lib/api/generated/backend-client';

type LocationPingSource = 'ios_one_shot' | 'mac_one_shot' | 'manual';
export type LocationPermissionState = PermissionState | 'unsupported' | 'unknown';

type SubmitLocationPingOptions = {
  authToken?: string | null;
  reason?: string;
  maxRecentAgeMs?: number;
  timeoutMs?: number;
};

type SubmitLocationPingResult =
  | { status: 'submitted'; source: LocationPingSource; accuracyM: number | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export type { SubmitLocationPingResult };

let lastSubmittedAt = 0;
let inFlight: Promise<SubmitLocationPingResult> | null = null;

const DEFAULT_MAX_RECENT_AGE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const DEVICE_ID_STORAGE_KEY = 'ritual:location-device-id';

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  if (!browserSupportsGeolocation()) {
    return 'unsupported';
  }

  try {
    if ('permissions' in navigator && typeof navigator.permissions?.query === 'function') {
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return status.state;
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

export async function openLocationServicesSettings(): Promise<boolean> {
  try {
    const { invokeDesktopCommand } = await import('@/lib/native-gateway');
    await invokeDesktopCommand('open_location_settings');
    return true;
  } catch {
    return false;
  }
}

function browserSupportsGeolocation(): boolean {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && 'geolocation' in navigator;
}

function getLocationSource(): LocationPingSource {
  const platform = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
  if (platform.includes('mac')) return 'mac_one_shot';
  if (platform.includes('iphone') || platform.includes('ipad') || platform.includes('ipod')) {
    return 'ios_one_shot';
  }
  return 'manual';
}

function getStableDeviceId(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;

    const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}

function getPosition(timeoutMs: number): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 60_000,
      timeout: timeoutMs,
    });
  });
}

async function postLocationPing(
  position: GeolocationPosition,
  authToken: string | null | undefined,
  _reason: string | undefined,
): Promise<SubmitLocationPingResult> {
  const source = getLocationSource();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);

  try {
    const client = createBackendClient({
      baseUrl: window.location.origin,
      getAuthHeaders: async () => ({
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      }),
    });
    await client.requestOperation('post_location_pings_api_user_location_pings_post', {
      body: {
        pings: [
          {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            horizontal_accuracy_m: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : null,
            source,
            device_id: getStableDeviceId(),
            client_ts: position.timestamp || Date.now(),
            client_event_id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          },
        ],
      },
      signal: controller.signal,
    });

    lastSubmittedAt = Date.now();
    return {
      status: 'submitted',
      source,
      accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    };
  } catch (error) {
    if (error instanceof BackendClientError) {
      return { status: 'failed', reason: `location ingest HTTP ${error.status}` };
    }
    const reasonText = error instanceof Error ? error.message : String(error);
    return { status: 'failed', reason: reasonText };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function submitCurrentLocationPing(
  options: SubmitLocationPingOptions = {},
): Promise<SubmitLocationPingResult> {
  if (!browserSupportsGeolocation()) {
    return { status: 'skipped', reason: 'geolocation unavailable' };
  }

  const maxRecentAgeMs = options.maxRecentAgeMs ?? DEFAULT_MAX_RECENT_AGE_MS;
  if (Date.now() - lastSubmittedAt < maxRecentAgeMs) {
    return { status: 'skipped', reason: 'recent location ping already submitted' };
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const position = await getPosition(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return await postLocationPing(position, options.authToken, options.reason);
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      const reason = typeof geoError?.message === 'string' && geoError.message
        ? geoError.message
        : 'geolocation request failed';
      return { status: 'failed', reason };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
