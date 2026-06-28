import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';

export function useAppleWatchStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['apple-watch-status', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch('/api/wearables/apple/devices', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch Apple Watch status');
      const data = await response.json();
      const activeDevices = (data.devices || []).filter(
        (d: any) => d.is_active && d.platform === 'ios',
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
      const token = await getToken();
      const res = await fetch('/api/wearables/connections', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const connections = data.connections || [];
      return connections.find((c: any) => c.provider === provider) || null;
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!user?.id,
  });
}
