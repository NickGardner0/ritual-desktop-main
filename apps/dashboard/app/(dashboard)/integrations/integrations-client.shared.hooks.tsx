'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth, useUser } from '@clerk/nextjs';
import { invoke } from '@tauri-apps/api/core';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { QUERY_POLICY } from '@/lib/query-policies';
import { apiOperationWithAuth } from '@/lib/api/client';
import {
  deriveIphoneTimeIntegrationStatus,
  getLocalWatcherRuntimeStatus,
  type BiomeIphoneDiagnostics,
  type IphoneTimeIntegrationStatus,
  type WatcherRuntimeStatus,
} from './integrations-client.shared.helpers';

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
 * Fetch Computer Use status with React Query
 * Checks for registered watcher devices (macOS desktop)
 */
export function useComputerTrackingStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['computer-tracking-status', user?.id],
    queryFn: async () => {
      try {
        const data = await apiOperationWithAuth(
          'list_devices_api_watcher_devices_get',
          getToken,
          {},
          user?.id,
        ) as { devices?: Array<{ is_enabled?: boolean; device_name?: string; device_id?: string }> };
        const devices = data.devices || [];
        const activeDevice = devices.find((d) => d.is_enabled);

        return {
          connected: devices.length > 0,
          enabled: !!activeDevice,
          deviceName: activeDevice?.device_name || devices[0]?.device_name || 'My Mac',
          deviceId: activeDevice?.device_id || devices[0]?.device_id || null,
        };
      } catch {
        return { connected: false, enabled: false, deviceName: null, deviceId: null };
      }
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
      const activeWatcherDevice = watcherDevices.find((device: any) => device.is_enabled);
      const localWatcherStatus =
        watcherDevices.length > 0
          ? null
          : await getLocalWatcherRuntimeStatus();
      const localWatcherConnected = Boolean(localWatcherStatus?.is_running || localWatcherStatus?.device_id);
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
        computerTrackingStatus: {
          connected: watcherDevices.length > 0 || localWatcherConnected,
          enabled: !!activeWatcherDevice || Boolean(localWatcherStatus?.is_running),
          deviceName:
            activeWatcherDevice?.device_name
            || watcherDevices[0]?.device_name
            || (localWatcherConnected ? 'This Mac' : 'My Mac'),
          deviceId: activeWatcherDevice?.device_id || watcherDevices[0]?.device_id || localWatcherStatus?.device_id || null,
        },
      };
    },
    staleTime: QUERY_POLICY.staticResource.staleTime,
    enabled: !!user?.id,
  });
}

// Memoized integration card
