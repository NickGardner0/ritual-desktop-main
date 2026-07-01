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
import { SettingsGroup, SettingsRow } from '@/components/ui/ritual-system';

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
    <div className={compact ? 'space-y-3' : 'space-y-[34px]'}>
      <SettingsGroup>
        <div className="flex min-h-[64px] items-center justify-between gap-4 px-[18px] py-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#306774]/10 text-[#306774]">
              <MapPin className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-medium leading-5 text-[#1d1d1f]">Place tagging</h3>
              <p className="mt-[3px] max-w-[350px] text-[13px] leading-[17px] text-[#777]">
                Attach place context to habit logs from your Mac and use iPhone companion location for iMessage logs.
              </p>
            </div>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium ${statusTone(permissionState)}`}>
            {statusLabel(permissionState)}
          </span>
        </div>

        <SettingsRow>
          <div className="flex min-w-0 items-start gap-3">
            {permissionState === 'granted' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : permissionState === 'denied' ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            ) : (
              <LocateFixed className="mt-0.5 h-4 w-4 shrink-0 text-[#777]" />
            )}
            <div className="min-w-0">
              <p className="text-[15px] font-medium leading-5 text-[#1d1d1f]">
                {permissionState === 'granted'
                  ? 'Ritual can request your current location.'
                  : permissionState === 'denied'
                    ? 'Location access is blocked in macOS or your browser.'
                    : 'Run a location test to request access.'}
              </p>
              {message ? (
                <p className="mt-[3px] max-w-[350px] text-[13px] leading-[17px] text-[#777]">{message}</p>
              ) : null}
              {openedSettings ? (
                <p className="mt-[3px] max-w-[350px] text-[13px] leading-[17px] text-[#777]">
                  Opened macOS Location Services. Enable Ritual, then test again.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handleTestLocation}
              disabled={busy || permissionState === 'unsupported'}
              className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-[#306774] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#285966] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LocateFixed className="h-3.5 w-3.5" />
              {busy ? 'Testing...' : 'Test'}
            </button>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="settings-value-button"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Location Services
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
