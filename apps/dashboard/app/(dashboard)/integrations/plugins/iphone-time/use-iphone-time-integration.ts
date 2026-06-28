'use client';

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { invalidateAfterActivitySync } from '@/lib/query-invalidation';
import { formatErrorMessage } from '../../integrations-client.shared';
import type { IntegrationOrchestratorDeps } from '../types';

type UseIphoneTimeIntegrationParams = Pick<
  IntegrationOrchestratorDeps,
  'iphoneTimeIntegrationQuery' | 'openIntegrationDetails' | 'queryClient' | 'userId' | 'refetchOverview'
>;

export function useIphoneTimeIntegration({
  iphoneTimeIntegrationQuery,
  openIntegrationDetails,
  queryClient,
  refetchOverview,
  userId,
}: UseIphoneTimeIntegrationParams) {
  const { isDesktop } = useDesktopCapabilities();
  const [iphoneTimeConnecting, setIphoneTimeConnecting] = useState(false);
  const [iphoneTimeSyncing, setIphoneTimeSyncing] = useState(false);
  const [iphoneTimeImporting, setIphoneTimeImporting] = useState(false);

  const refreshIphoneTimeIntegration = useCallback(async () => {
    await iphoneTimeIntegrationQuery.refetch();
    void refetchOverview();
    void invalidateAfterActivitySync(queryClient, userId);
  }, [iphoneTimeIntegrationQuery, queryClient, refetchOverview, userId]);

  const handleIphoneTimeConnect = useCallback(async () => {
    try {
      setIphoneTimeConnecting(true);
      openIntegrationDetails('screentime');
      if (!isDesktop) {
        return;
      }
      await iphoneTimeIntegrationQuery.refetch();
    } catch (error) {
      console.error('Failed to check iPhone Time status:', error);
    } finally {
      setIphoneTimeConnecting(false);
    }
  }, [iphoneTimeIntegrationQuery, openIntegrationDetails]);

  const handleIphoneTimeSync = useCallback(async () => {
    if (!isDesktop) {
      openIntegrationDetails('screentime');
      return;
    }
    try {
      setIphoneTimeSyncing(true);
      await invoke('desktop_trigger_biome_iphone_sync');
      await refreshIphoneTimeIntegration();
    } catch (error) {
      console.error('Failed to sync iPhone Time:', error);
      alert(`Failed to sync iPhone Time: ${formatErrorMessage(error, 'Unknown error')}`);
      await iphoneTimeIntegrationQuery.refetch();
    } finally {
      setIphoneTimeSyncing(false);
    }
  }, [iphoneTimeIntegrationQuery, openIntegrationDetails, refreshIphoneTimeIntegration]);

  const handleIphoneTimeImport = useCallback(async () => {
    if (!isDesktop) {
      openIntegrationDetails('screentime');
      return;
    }
    try {
      setIphoneTimeImporting(true);
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        defaultPath: '/Users/Shared/ritual-biome-iphone-export.jsonl',
        filters: [{ name: 'Biome JSONL export', extensions: ['jsonl', 'json'] }],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      await invoke('import_biome_iphone_export', { path: selected });
      await handleIphoneTimeSync();
    } catch (error) {
      console.error('Failed to import iPhone Time export:', error);
      alert(`Failed to import iPhone Time export: ${formatErrorMessage(error, 'Unknown error')}`);
      await iphoneTimeIntegrationQuery.refetch();
    } finally {
      setIphoneTimeImporting(false);
    }
  }, [handleIphoneTimeSync, iphoneTimeIntegrationQuery, openIntegrationDetails]);

  return {
    handleIphoneTimeConnect,
    handleIphoneTimeImport,
    handleIphoneTimeSync,
    iphoneTimeConnecting,
    iphoneTimeImporting,
    iphoneTimeIntegration: iphoneTimeIntegrationQuery.data,
    iphoneTimeStatusLoading: iphoneTimeIntegrationQuery.isLoading,
    iphoneTimeSyncing,
  };
}
