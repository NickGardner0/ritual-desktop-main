'use client';

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  desktopHasCapability,
  desktopSetComputerTracking,
  openDesktopSettingsWindow,
} from '@/lib/native-gateway';
import { invalidateAfterActivitySync } from '@/lib/query-invalidation';
import type { IntegrationHookDeps } from '../types';

async function openComputerTrackingSettings() {
  try {
    await openDesktopSettingsWindow('computer-tracking');
  } catch (error) {
    console.error('Failed to open Computer Use settings:', error);
  }
}

async function startLocalComputerTracking(): Promise<boolean> {
  if (!getDesktopCapabilities().isDesktop) {
    return false;
  }

  try {
    const granted = await invoke<boolean>('check_accessibility_permission');
    if (!granted) {
      return false;
    }
    if (await desktopHasCapability('desktop-resident-runtime-v1')) {
      await desktopSetComputerTracking({ enabled: true });
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Could not start Computer Use from Integrations:', error);
    return false;
  }
}

async function stopLocalComputerTracking(): Promise<boolean> {
  if (!getDesktopCapabilities().isDesktop) {
    return false;
  }

  try {
    if (await desktopHasCapability('desktop-resident-runtime-v1')) {
      await desktopSetComputerTracking({ enabled: false });
      return true;
    }
    await invoke('stop_watcher');
    await invoke('clear_watcher_config_cmd');
    return true;
  } catch (error) {
    console.warn('Could not pause Computer Use from Integrations:', error);
    return false;
  }
}

export function useComputerTrackingConnect({
  queryClient,
  refetchOverview,
  userId,
}: Pick<IntegrationHookDeps, 'queryClient' | 'refetchOverview' | 'userId'>) {
  const [computerTrackingConnecting, setComputerTrackingConnecting] = useState(false);

  const refreshComputerTracking = useCallback(async () => {
    queryClient.invalidateQueries({ queryKey: ['computer-tracking-status'] });
    queryClient.invalidateQueries({ queryKey: ['iphone-time-integration-status'] });
    await refetchOverview();
    void invalidateAfterActivitySync(queryClient, userId);
  }, [queryClient, refetchOverview, userId]);

  const handleComputerTrackingConnect = useCallback(async () => {
    setComputerTrackingConnecting(true);
    try {
      if (await startLocalComputerTracking()) {
        await refreshComputerTracking();
        return;
      }
      await openComputerTrackingSettings();
    } finally {
      setComputerTrackingConnecting(false);
    }
  }, [refreshComputerTracking]);

  const handleComputerTrackingDisconnect = useCallback(async () => {
    setComputerTrackingConnecting(true);
    try {
      if (await stopLocalComputerTracking()) {
        await refreshComputerTracking();
        return;
      }
      await openComputerTrackingSettings();
    } finally {
      setComputerTrackingConnecting(false);
    }
  }, [refreshComputerTracking]);

  return {
    computerTrackingConnecting,
    handleComputerTrackingConnect,
    handleComputerTrackingDisconnect,
  };
}
