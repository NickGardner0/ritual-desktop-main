/**
 * Location helpers for explicit user-triggered weather sync flows.
 *
 * We intentionally request geolocation only when the user clicks
 * Weather Connect / Sync Now.
 */

export type LocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export type LocationErrorCode =
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export class LocationError extends Error {
  code: LocationErrorCode;

  constructor(code: LocationErrorCode, message: string) {
    super(message);
    this.name = 'LocationError';
    this.code = code;
  }
}

export interface CurrentLocation {
  lat: number;
  lon: number;
  accuracyMeters: number | null;
  permission: LocationPermissionState;
}

export async function getLocationPermissionStatus(): Promise<LocationPermissionState> {
  if (typeof window === 'undefined' || !('navigator' in window)) {
    return 'unsupported';
  }

  if (!('geolocation' in navigator)) {
    return 'unsupported';
  }

  try {
    if (!('permissions' in navigator) || !navigator.permissions?.query) {
      return 'prompt';
    }

    const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    if (result.state === 'granted' || result.state === 'denied' || result.state === 'prompt') {
      return result.state;
    }

    return 'prompt';
  } catch {
    return 'prompt';
  }
}

export async function requestCurrentLocation(options?: {
  timeoutMs?: number;
  maximumAgeMs?: number;
  enableHighAccuracy?: boolean;
}): Promise<CurrentLocation> {
  if (typeof window === 'undefined' || !('navigator' in window) || !('geolocation' in navigator)) {
    throw new LocationError('UNSUPPORTED', 'Geolocation is not available on this device.');
  }

  const timeoutMs = options?.timeoutMs ?? 15000;
  const maximumAgeMs = options?.maximumAgeMs ?? 0;
  const enableHighAccuracy = options?.enableHighAccuracy ?? false;

  const permissionBefore = await getLocationPermissionStatus();

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      async position => {
        const permissionAfter = await getLocationPermissionStatus();
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          permission: permissionAfter === 'unsupported' ? permissionBefore : permissionAfter,
        });
      },
      async error => {
        const permissionAfter = await getLocationPermissionStatus();

        if (error.code === error.PERMISSION_DENIED) {
          reject(
            new LocationError(
              'PERMISSION_DENIED',
              permissionAfter === 'denied'
                ? 'Location permission was denied. Enable it in macOS System Settings > Privacy & Security > Location Services.'
                : 'Location permission was denied.'
            )
          );
          return;
        }

        if (error.code === error.POSITION_UNAVAILABLE) {
          reject(new LocationError('POSITION_UNAVAILABLE', 'Current location is unavailable.'));
          return;
        }

        if (error.code === error.TIMEOUT) {
          reject(new LocationError('TIMEOUT', 'Timed out while trying to get location.'));
          return;
        }

        reject(new LocationError('UNKNOWN', error.message || 'Failed to determine current location.'));
      },
      {
        enableHighAccuracy,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      }
    );
  });
}
