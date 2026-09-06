'use client';

import { useCallback } from 'react';
import { apiOperationWithAuth } from '@/lib/api/client';
import { openInBrowser } from '@/lib/native-gateway';
import type { WearableConnection } from './plugins/types';

// Legacy migration shim. Owner: Integrations/Wearables architecture migration.
// Expiry: 2026-08-15. Delete after Apple/Oura/Garmin handlers move into plugin-owned hooks.

type LegacyWearableHandlersParams = {
  appleWatchStatusData?: {
    devices?: Array<{ device_id: string }>;
  };
  getToken: () => Promise<string | null>;
  refetchOverview: () => unknown;
  fetchHabits: () => unknown;
  fetchHabitLogs: () => unknown;
  setWearableConnectingProvider: (value: string | null) => void;
  setWearableSyncingProvider: (value: string | null) => void;
};

export function useLegacyWearableHandlers({
  appleWatchStatusData,
  fetchHabitLogs,
  fetchHabits,
  getToken,
  refetchOverview,
  setWearableConnectingProvider,
  setWearableSyncingProvider,
}: LegacyWearableHandlersParams) {
  const handleAppleWatchDisconnect = useCallback(async () => {
    try {
      if (!(await getToken())) return;

      if (
        !confirm(
          'Are you sure you want to disconnect Apple Watch? You can reconnect using the Ritual iOS companion app.',
        )
      ) {
        return;
      }

      const devices = appleWatchStatusData?.devices || [];
      if (devices.length === 0) {
        alert('No Apple Watch device found');
        return;
      }

      for (const device of devices) {
        await apiOperationWithAuth(
          'deactivate_apple_device_api_wearables_apple_devices__device_id__delete',
          getToken,
          { pathParams: { device_id: device.device_id } },
        );
      }

      refetchOverview();
      alert('Apple Watch disconnected successfully. You can reconnect using the Ritual iOS companion app.');
    } catch (error) {
      console.error('Error disconnecting Apple Watch:', error);
      alert(`Failed to disconnect: ${error}`);
    }
  }, [appleWatchStatusData?.devices, getToken, refetchOverview]);

  const handleAppleWatchConnect = useCallback(() => {
    alert(
      '📱 To connect your Apple Watch:\n\n' +
        '1. Download the Ritual Companion app on your iPhone\n' +
        '2. Sign in with your Ritual account\n' +
        '3. Tap "Connect" to register your device\n' +
        '4. Grant HealthKit permissions\n' +
        '5. Tap "Sync Now" to sync your data\n\n' +
        'Your Apple Watch data will be synced through your iPhone.',
    );
  }, []);

  const handleWearableProviderConnect = useCallback(
    async (provider: 'oura' | 'garmin') => {
      try {
        setWearableConnectingProvider(provider);
        if (!(await getToken())) return;

        const result = await apiOperationWithAuth(
          'authorize_wearable_provider_api_wearables_connections__provider__authorize_post',
          getToken,
          { pathParams: { provider } },
        );
        if (result.authorization_url) {
          await openInBrowser(result.authorization_url);
          return;
        }

        alert(result.message || 'Wearable connection started.');
      } catch (error) {
        console.error(`Error connecting ${provider}:`, error);
        alert(`Failed to connect ${provider}: ${error}`);
        setWearableConnectingProvider(null);
      }
    },
    [getToken, setWearableConnectingProvider],
  );

  const handleWearableProviderDisconnect = useCallback(
    async (provider: 'oura' | 'garmin') => {
      try {
        if (!(await getToken())) return;

        if (!confirm(`Disconnect ${provider === 'oura' ? 'Oura' : 'Garmin'}?`)) {
          return;
        }

        await apiOperationWithAuth(
          'disconnect_wearable_provider_api_wearables_connections__provider__disconnect_post',
          getToken,
          { pathParams: { provider } },
        );

        await refetchOverview();
        alert(`${provider === 'oura' ? 'Oura' : 'Garmin'} disconnected.`);
      } catch (error) {
        console.error(`Error disconnecting ${provider}:`, error);
        alert(`Failed to disconnect ${provider}: ${error}`);
      }
    },
    [getToken, refetchOverview],
  );

  const handleWearableProviderSync = useCallback(
    async (provider: 'oura' | 'garmin') => {
      try {
        setWearableSyncingProvider(provider);
        if (!(await getToken())) return;

        const result = await apiOperationWithAuth(
          'sync_wearable_provider_api_wearables_connections__provider__sync_post',
          getToken,
          { pathParams: { provider } },
        );
        await Promise.all([refetchOverview(), fetchHabits(), fetchHabitLogs()]);
        alert(result.message || `${provider} sync finished.`);
      } catch (error) {
        console.error(`Error syncing ${provider}:`, error);
        alert(`Failed to sync ${provider}: ${error}`);
      } finally {
        setWearableSyncingProvider(null);
      }
    },
    [fetchHabitLogs, fetchHabits, getToken, refetchOverview, setWearableSyncingProvider],
  );

  return {
    handleAppleWatchConnect,
    handleAppleWatchDisconnect,
    handleWearableProviderConnect,
    handleWearableProviderDisconnect,
    handleWearableProviderSync,
  };
}

export async function handleWearableSyncSettingsUpdate(
  params: {
    provider: 'whoop' | 'apple_health' | 'oura' | 'garmin';
    updates: { auto_sync_enabled?: boolean; sync_hour?: number };
    getToken: () => Promise<string | null>;
    whoopConnection: WearableConnection | undefined;
    appleHealthConnection: WearableConnection | undefined;
    ouraConnection: WearableConnection | undefined;
    garminConnection: WearableConnection | undefined;
    whoopSyncHour: number;
    setWhoopSyncHour: (hour: number) => void;
    refetchOverview: () => unknown;
  },
) {
  const {
    appleHealthConnection,
    garminConnection,
    getToken,
    ouraConnection,
    provider,
    refetchOverview,
    setWhoopSyncHour,
    updates,
    whoopConnection,
    whoopSyncHour,
  } = params;

  try {
    if (!(await getToken())) return;

    const connection =
      provider === 'whoop'
        ? whoopConnection
        : provider === 'apple_health'
          ? appleHealthConnection
          : provider === 'oura'
            ? ouraConnection
            : garminConnection;

    const nextEnabled =
      updates.auto_sync_enabled ??
      (connection as { auto_sync_enabled?: boolean })?.auto_sync_enabled ??
      provider !== 'apple_health';
    const nextHour =
      updates.sync_hour ??
      (connection as { sync_hour?: number })?.sync_hour ??
      (provider === 'whoop' ? whoopSyncHour : 9);

    await apiOperationWithAuth(
      'update_wearable_sync_settings_api_wearables_connections__provider__sync_settings_put',
      getToken,
      {
        pathParams: { provider },
        body: {
          auto_sync_enabled: nextEnabled,
          sync_hour: nextHour,
        },
      },
    );

    if (provider === 'whoop') {
      setWhoopSyncHour(nextHour);
    }
    await refetchOverview();
  } catch (error) {
    console.error(`Error updating ${provider} sync settings:`, error);
    alert(`Failed to update ${provider} sync settings.`);
  }
}
