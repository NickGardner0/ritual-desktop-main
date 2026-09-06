export type ComputerTrackingDevice = {
  device_id?: string;
  device_name?: string;
  is_enabled?: boolean;
};

export type ComputerTrackingWatcherStatus = {
  device_id?: string | null;
  is_running?: boolean;
  pid?: number | null;
};

export type ComputerTrackingStatus = {
  connected: boolean;
  deviceId: string | null;
  deviceName: string;
  enabled: boolean;
  registered: boolean;
  running: boolean;
};

export function deriveComputerTrackingStatus({
  localWatcherStatus,
  watcherDevices = [],
}: {
  localWatcherStatus?: ComputerTrackingWatcherStatus | null;
  watcherDevices?: ComputerTrackingDevice[];
}): ComputerTrackingStatus {
  const devices = watcherDevices ?? [];
  const activeDevice = devices.find((device) => device.is_enabled);
  const running = Boolean(localWatcherStatus?.is_running);
  const registered = devices.length > 0 || Boolean(localWatcherStatus?.device_id);

  return {
    connected: running,
    deviceId: activeDevice?.device_id || devices[0]?.device_id || localWatcherStatus?.device_id || null,
    deviceName:
      activeDevice?.device_name
      || devices[0]?.device_name
      || (registered ? 'This Mac' : 'My Mac'),
    enabled: running || Boolean(activeDevice),
    registered,
    running,
  };
}
