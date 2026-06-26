'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CheckCircle2, ExternalLink, LocateFixed, MapPin, XCircle } from 'lucide-react';

import {
  getLocationPermissionState,
  openLocationServicesSettings,
  submitCurrentLocationPing,
  type LocationPermissionState,
  type SubmitLocationPingResult,
} from '@/lib/location-ping';

type PlaceTaggingSettingsProps = {
  compact?: boolean;
};

function statusLabel(status: LocationPermissionState): string {
  if (status === 'granted') return 'Enabled';
  if (status === 'denied') return 'Blocked';
  if (status === 'prompt') return 'Not requested';
  if (status === 'unsupported') return 'Unavailable';
  return 'Unknown';
}

function statusTone(status: LocationPermissionState): string {
  if (status === 'granted') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'denied') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function resultMessage(result: SubmitLocationPingResult | null): string | null {
  if (!result) return null;
  if (result.status === 'submitted') {
    const accuracy = result.accuracyM == null ? null : Math.round(result.accuracyM);
    return accuracy == null
      ? `Location ping submitted from ${result.source}.`
      : `Location ping submitted from ${result.source} with ${accuracy}m accuracy.`;
  }
  if (result.status === 'skipped') return result.reason;
  return result.reason;
}

export function PlaceTaggingSettings({ compact = false }: PlaceTaggingSettingsProps) {
  const { getToken } = useAuth();
  const [permissionState, setPermissionState] = useState<LocationPermissionState>('unknown');
  const [lastResult, setLastResult] = useState<SubmitLocationPingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [openedSettings, setOpenedSettings] = useState(false);

  const refreshPermissionState = useCallback(async () => {
    setPermissionState(await getLocationPermissionState());
  }, []);

  useEffect(() => {
    void refreshPermissionState();
  }, [refreshPermissionState]);

  const message = useMemo(() => resultMessage(lastResult), [lastResult]);

  const handleTestLocation = async () => {
    setBusy(true);
    setLastResult(null);
    try {
      const token = await getToken({ skipCache: true });
      const result = await submitCurrentLocationPing({
        authToken: token,
        reason: 'settings_place_tagging_test',
        maxRecentAgeMs: 0,
        timeoutMs: 8000,
      });
      setLastResult(result);
      await refreshPermissionState();
    } finally {
      setBusy(false);
    }
  };

  const handleOpenSettings = async () => {
    const opened = await openLocationServicesSettings();
    setOpenedSettings(opened);
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-sm bg-gray-100 text-gray-900">
            <MapPin className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-gray-900">Place tagging</h3>
            <p className="mt-1 max-w-[440px] text-[13px] leading-relaxed text-[#616161]">
              Attach place context to habit logs from your Mac and use iPhone companion location for iMessage logs.
            </p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${statusTone(permissionState)}`}>
          {statusLabel(permissionState)}
        </span>
      </div>

      <div className="rounded-sm border border-gray-200 bg-white p-3">
        <div className="flex items-start gap-2.5">
          {permissionState === 'granted' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
          ) : permissionState === 'denied' ? (
            <XCircle className="mt-0.5 h-4 w-4 text-red-500" />
          ) : (
            <LocateFixed className="mt-0.5 h-4 w-4 text-gray-500" />
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-gray-900">
              {permissionState === 'granted'
                ? 'Ritual can request your current location.'
                : permissionState === 'denied'
                  ? 'Location access is blocked in macOS or your browser.'
                  : 'Run a location test to request access.'}
            </p>
            {message ? (
              <p className="mt-1 text-[12px] leading-relaxed text-[#616161]">{message}</p>
            ) : null}
            {openedSettings ? (
              <p className="mt-1 text-[12px] leading-relaxed text-[#616161]">
                Opened macOS Location Services. Enable Ritual, then test again.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleTestLocation}
          disabled={busy || permissionState === 'unsupported'}
          className="inline-flex items-center gap-2 rounded-sm bg-gray-900 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          {busy ? 'Testing...' : 'Test location'}
        </button>
        <button
          type="button"
          onClick={handleOpenSettings}
          className="inline-flex items-center gap-2 rounded-sm border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-[#F3F3F3]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open Location Services
        </button>
      </div>
    </div>
  );
}
