import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { apiOperationWithAuth } from '@/lib/api/client';

type AppleWatchDevice = {
  is_active?: boolean;
  platform?: string;
  last_sync_at?: string | null;
  device_name?: string | null;
  device_id?: string;
};

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
      ) as { devices?: AppleWatchDevice[] };
      const activeDevices = (data.devices || []).filter(
        (device) => device.is_active && device.platform === 'ios',
      );
      return {
        connected: activeDevices.length > 0,
        devices: activeDevices,
        lastSyncAt: activeDevices[0]?.last_sync_at || null,
        deviceName: activeDevices[0]?.device_name || null,
      };
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!user?.id,
  });
}

export function useWearableConnection(provider: string) {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['wearable-connections', user?.id, provider],
    queryFn: async () => {
      try {
        const data = await apiOperationWithAuth(
          'get_wearable_connections_api_wearables_connections_get',
          getToken,
          {},
          user?.id,
        );
        return data.connections.find((connection) => String(connection.provider) === provider) || null;
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!user?.id,
  });
}
