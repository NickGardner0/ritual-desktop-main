import { describe, expect, it } from 'vitest';

import { deriveComputerTrackingStatus } from '../app/(dashboard)/integrations/plugins/computer-tracking/status';

describe('deriveComputerTrackingStatus', () => {
  it('treats a registered device as installed, not collecting, when the sidecar is down', () => {
    const status = deriveComputerTrackingStatus({
      watcherDevices: [{ device_id: 'mac-1', device_name: 'Nick’s Mac', is_enabled: true }],
      localWatcherStatus: { device_id: 'mac-1', is_running: false, pid: null },
    });

    expect(status.connected).toBe(false);
    expect(status.running).toBe(false);
    expect(status.registered).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.deviceId).toBe('mac-1');
  });

  it('does not treat a retained device_id as connected', () => {
    const status = deriveComputerTrackingStatus({
      watcherDevices: [],
      localWatcherStatus: { device_id: 'mac-1', is_running: false, pid: null },
    });

    expect(status.connected).toBe(false);
    expect(status.registered).toBe(true);
    expect(status.enabled).toBe(false);
  });

  it('marks Computer Use connected only while the watcher process is running', () => {
    const status = deriveComputerTrackingStatus({
      watcherDevices: [{ device_id: 'mac-1', is_enabled: true }],
      localWatcherStatus: { device_id: 'mac-1', is_running: true, pid: 42 },
    });

    expect(status.connected).toBe(true);
    expect(status.running).toBe(true);
    expect(status.registered).toBe(true);
  });
});
