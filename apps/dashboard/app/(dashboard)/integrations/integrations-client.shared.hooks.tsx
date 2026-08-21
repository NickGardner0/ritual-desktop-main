'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth, useUser } from '@clerk/nextjs';
import { invoke } from '@tauri-apps/api/core';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { QUERY_POLICY } from '@/lib/query-policies';
import { apiOperationWithAuth } from '@/lib/api/client';
import {
  deriveIphoneTimeIntegrationStatus,
  fetchJsonWithTimeout,
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
      const token = await getToken();
      const response = await fetch('/api/wearables/apple/devices', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Apple Watch status');
      }

      const data = await response.json();
      // Check if there's at least one active iOS device
      const activeDevices = (data.devices || []).filter((d: any) => d.is_active && d.platform === 'ios');
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
      const token = await getToken();
      const response = await fetch('/api/wearables/connections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch wearable connections');
      }

      return response.json();
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
      const token = await getToken();
      const response = await fetch('/api/financial/connections', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch financial connections');
      }

      return response.json();
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

  return useQuery({
    queryKey: ['computer-tracking-status', user?.id],
    queryFn: async () => {
      try {
        const response = await fetch('/api/watcher/devices');
        
        if (!response.ok) {
          return { connected: false, enabled: false, deviceName: null };
        }

        const data = await response.json();
        const devices = data.devices || [];
        const activeDevice = devices.find((d: any) => d.is_enabled);
        
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
      const token = await getToken();
      const authHeaders: HeadersInit = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const fetchBackendJson = async (path: string, fallback: any) => {
        try {
          const response = await fetchJsonWithTimeout(
            path,
            { headers: authHeaders },
            8000,
          );
          if (!response.ok) {
            return fallback;
          }
          return await response.json();
        } catch {
          return fallback;
        }
      };

      const [
        whoopResponse,
        appleWatchResponse,
        wearablesResponse,
        financialResponse,
        computerTrackingResponse,
      ] = await Promise.all([
        fetchBackendJson('/api/integrations/whoop/status', { connected: false, sync_hour: 9 }),
        fetchBackendJson('/api/wearables/apple/devices', { devices: [] }),
        fetchBackendJson('/api/wearables/connections', { connections: [] }),
        fetchBackendJson('/api/financial/connections', { connections: [] }),
        fetchBackendJson('/api/watcher/devices', { devices: [] }),
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
