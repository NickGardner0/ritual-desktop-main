'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  desktopHasCapability,
  desktopSetPrivacyState,
  getDesktopRuntimeState,
  syncComputerActivityNow,
  type ComputerActivitySyncResult,
  type DesktopComputerSyncStage,
} from '@/lib/native-gateway';
import { readPrivacySettings } from '@/lib/privacy/privacy-settings';
import { invalidateAfterComputerSync } from '@/lib/query-invalidation';

const SYNC_PROGRESS_LABELS: Partial<Record<DesktopComputerSyncStage, string>> = {
  materializing: 'Refreshing...',
  obtaining_config: 'Connecting...',
  uploading: 'Uploading...',
  verifying: 'Verifying...',
  downloading: 'Downloading...',
};

export function useComputerActivitySync(userId: string) {
  const queryClient = useQueryClient();
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [capability, setCapability] = useState<boolean | null>(null);
  const [privacySettings, setPrivacySettings] = useState(() => readPrivacySettings());
  const [stage, setStage] = useState<DesktopComputerSyncStage>('idle');
  const [result, setResult] = useState<ComputerActivitySyncResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void desktopHasCapability('desktop-computer-sync-v3').then((supported) => {
      if (!cancelled) setCapability(supported);
    });
    const handlePrivacyChange = () => setPrivacySettings(readPrivacySettings());
    window.addEventListener('ritual:privacy-settings-changed', handlePrivacyChange);
    return () => {
      cancelled = true;
      window.removeEventListener('ritual:privacy-settings-changed', handlePrivacyChange);
    };
  }, []);

  const sync = useCallback(async () => {
    if (!capability) return;
    let runtimePoll: ReturnType<typeof setInterval> | null = null;
    try {
      setIsSyncing(true);
      setResult(null);
      setStage('materializing');
      const currentPrivacy = readPrivacySettings();
      setPrivacySettings(currentPrivacy);
      await desktopSetPrivacyState(currentPrivacy);
      runtimePoll = setInterval(() => {
        void getDesktopRuntimeState().then((runtime) => {
          if (runtime?.computerSync.stage) setStage(runtime.computerSync.stage);
        });
      }, 400);
      const nextResult = await syncComputerActivityNow();
      if (!nextResult) throw new Error('Desktop sync is unavailable. Update Ritual and try again.');
      setResult(nextResult);
      setStage(nextResult.stage);
      if (nextResult.outcome === 'cloud_synced' || nextResult.outcome === 'local_refreshed') {
        setLastSyncTime(new Date());
      }
      await invalidateAfterComputerSync(queryClient, userId);
    } catch (error) {
      console.error('Failed to sync computer activity:', error);
      setStage('failed');
      setResult({
        outcome: 'failed',
        stage: 'failed',
        uploadedRollups: 0,
        supersededRawRows: 0,
        pendingRollups: 0,
        pendingRawRows: 0,
        errorCode: 'desktop_sync_unavailable',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (runtimePoll) clearInterval(runtimePoll);
      setIsSyncing(false);
    }
  }, [capability, queryClient, userId]);

  const cloudEnabled = privacySettings.mode === 'cloud_intelligence'
    && privacySettings.consents.plaintext_sync === true;
  const actionLabel = capability === false
    ? 'Update required'
    : cloudEnabled ? 'Sync Now' : 'Refresh Local Stats';
  let description = cloudEnabled
    ? 'Replicate privacy-safe daily rollups for your other Ritual devices.'
    : 'Refresh Computer Time from activity stored on this Mac.';
  if (capability === false) description = 'Update Ritual to use local-first Computer Time sync.';
  else if (isSyncing) description = SYNC_PROGRESS_LABELS[stage] || 'Refreshing local statistics...';
  else if (result?.outcome === 'privacy_blocked') description = 'Privacy consent required for cloud rollup sync.';
  else if (result?.outcome === 'cloud_pending') {
    const pending = [
      result.pendingRollups > 0 ? `${result.pendingRollups.toLocaleString()} rollups pending` : null,
      result.pendingRawRows > 0
        ? `${result.pendingRawRows.toLocaleString()} historical rows awaiting acknowledgement`
        : null,
    ].filter(Boolean);
    description = result.errorMessage || `${pending.join(' · ') || 'Cloud sync pending'}; background sync will continue.`;
  } else if (result?.outcome === 'failed') description = result.errorMessage || 'Aggregation unavailable.';
  else if (result?.outcome === 'local_refreshed') description = 'Local statistics refreshed. No cloud data was sent.';
  else if (result?.outcome === 'cloud_synced') description = 'Synced local rollups and downloaded other-device totals.';
  else if (lastSyncTime) {
    description = `Last synced ${lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  return {
    actionLabel,
    capability,
    cloudEnabled,
    description,
    isSyncing,
    progressLabel: SYNC_PROGRESS_LABELS[stage] || 'Refreshing...',
    sync,
  };
}
