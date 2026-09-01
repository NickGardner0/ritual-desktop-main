'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth, useUser } from '@clerk/nextjs';
import { QUERY_POLICY } from '@/lib/query-policies';
import { apiOperationWithAuth } from '@/lib/api/client';
import { getLocalWatcherRuntimeStatus } from './integrations-client.shared.helpers';
import { deriveComputerTrackingStatus } from './plugins/computer-tracking/status';

/**
 * Fetch Whoop connection status with React Query (cached!)
 */
export function useWhoopStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['whoop-status', user?.id],
    queryFn: async () => {
      return await apiOperationWithAuth(
        'whoop_status_api_integrations_whoop_status_get',
        getToken,
        {},
        user?.id,
      );
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

/**
 * Fetch Apple Watch/Health connection status with React Query
 * Checks for registered devices from the iOS companion app
 */
export function useAppleWatchStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['apple-watch-status', user?.id],
    queryFn: async () => {
      const data = await apiOperationWithAuth(
        'list_apple_devices_api_wearables_apple_devices_get',
        getToken,
        {},
        user?.id,
      ) as { devices?: Array<{ is_active?: boolean; platform?: string; last_sync_at?: string | null; device_name?: string | null }> };
      const activeDevices = (data.devices || []).filter((d) => d.is_active && d.platform === 'ios');
      return {
        connected: activeDevices.length > 0,
        devices: activeDevices,
        lastSyncAt: activeDevices[0]?.last_sync_at || null,
        deviceName: activeDevices[0]?.device_name || null,
      };
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

export function useWearableConnections() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['wearable-connections', user?.id],
    queryFn: async () => {
      return await apiOperationWithAuth(
        'get_wearable_connections_api_wearables_connections_get',
        getToken,
        {},
        user?.id,
      );
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

export function useFinancialConnections() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['financial-connections', user?.id],
    queryFn: async () => {
      return await apiOperationWithAuth(
        'list_financial_connections_api_financial_connections_get',
        getToken,
        {},
        user?.id,
      );
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

/**
 * Fetch Computer Use status with React Query.
 * A registered watcher device is not enough — connected means the sidecar is running.
 */
export function useComputerTrackingStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['computer-tracking-status', user?.id],
    queryFn: async () => {
      let watcherDevices: Array<{ is_enabled?: boolean; device_name?: string; device_id?: string }> = [];
      try {
        const data = await apiOperationWithAuth(
          'list_devices_api_watcher_devices_get',
          getToken,
          {},
          user?.id,
        ) as { devices?: Array<{ is_enabled?: boolean; device_name?: string; device_id?: string }> };
        watcherDevices = data.devices || [];
      } catch {
        watcherDevices = [];
      }

      return deriveComputerTrackingStatus({
        watcherDevices,
        localWatcherStatus: await getLocalWatcherRuntimeStatus(),
      });
    },
    staleTime: QUERY_POLICY.general.staleTime,
    enabled: !!user?.id,
  });
}

export function useIntegrationsOverview() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['integrations-overview', user?.id],
    queryFn: async () => {
      const fetchBackendJson = async (
        operation:
          | 'whoop_status_api_integrations_whoop_status_get'
          | 'list_apple_devices_api_wearables_apple_devices_get'
          | 'get_wearable_connections_api_wearables_connections_get'
          | 'list_financial_connections_api_financial_connections_get'
          | 'list_devices_api_watcher_devices_get',
        fallback: any,
      ) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 8000);
        try {
          return await apiOperationWithAuth(
            operation,
            getToken,
            { signal: controller.signal },
            user?.id,
          );
        } catch {
          return fallback;
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      const [
        whoopResponse,
        appleWatchResponse,
        wearablesResponse,
        financialResponse,
        computerTrackingResponse,
      ] = await Promise.all([
        fetchBackendJson('whoop_status_api_integrations_whoop_status_get', { connected: false, sync_hour: 9 }),
        fetchBackendJson('list_apple_devices_api_wearables_apple_devices_get', { devices: [] }),
        fetchBackendJson('get_wearable_connections_api_wearables_connections_get', { connections: [] }),
        fetchBackendJson('list_financial_connections_api_financial_connections_get', { connections: [] }),
        fetchBackendJson('list_devices_api_watcher_devices_get', { devices: [] }),
      ]);
      const whoopStatusPayload = whoopResponse;
      const appleWatchPayload = appleWatchResponse;
      const wearablesPayload = wearablesResponse;
      const financialPayload = financialResponse;
      const computerTrackingPayload = computerTrackingResponse;

      const wearableConnections = wearablesPayload?.connections || [];
      const appleHealthConnection = wearableConnections.find((item: any) => item.provider === 'apple_health');
      const whoopConnection = wearableConnections.find((item: any) => item.provider === 'whoop');
      const appleDevices = (appleWatchPayload?.devices || []).filter((device: any) => device.is_active && device.platform === 'ios');
      const watcherDevices = computerTrackingPayload?.devices || [];
      const computerTrackingStatus = deriveComputerTrackingStatus({
        watcherDevices,
        localWatcherStatus: await getLocalWatcherRuntimeStatus(),
      });
      const appleWatchConnected = appleDevices.length > 0 || appleHealthConnection?.status === 'active';
      const whoopConnected = Boolean(whoopStatusPayload?.connected || whoopConnection?.status === 'active');

      return {
        whoopStatus: {
          ...whoopStatusPayload,
          connected: whoopConnected,
          sync_hour: whoopStatusPayload?.sync_hour ?? whoopConnection?.sync_hour ?? 9,
          last_sync_at:
            whoopStatusPayload?.last_sync_at
            || whoopConnection?.last_sync_at
            || whoopConnection?.last_successful_sync_at
            || null,
          is_active: whoopStatusPayload?.is_active ?? (whoopConnection?.status === 'active'),
        },
        appleWatchStatus: {
          connected: appleWatchConnected,
          devices: appleDevices,
          lastSyncAt:
            appleDevices[0]?.last_sync_at
            || appleHealthConnection?.last_sync_at
            || appleHealthConnection?.last_successful_sync_at
            || null,
          deviceName: appleDevices[0]?.device_name || (appleWatchConnected ? 'Apple Health Device' : null),
        },
        wearableConnections: wearablesPayload,
        financialConnections: financialPayload,
        computerTrackingStatus,
      };
    },
    staleTime: QUERY_POLICY.general.staleTime,
    enabled: !!user?.id,
  });
}

// Memoized integration card
