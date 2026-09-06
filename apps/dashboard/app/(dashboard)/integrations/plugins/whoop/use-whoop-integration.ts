'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { openInBrowser } from '@/lib/native-gateway';
import { invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import { clearPersistedDashboardSnapshots } from '@/hooks/use-dashboard-snapshot-query';
import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';
import {
  MAX_CUSTOM_WHOOP_DAYS,
  WhoopSyncFeedback,
  WhoopSyncMode,
  buildWhoopSyncFeedbackMessage,
  formatErrorMessage,
  isLikelyReactEvent,
} from '../../integrations-client.shared';
import type { IntegrationOrchestratorDeps, WearableConnection, WhoopStatusData } from '../types';

function whoopApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof BackendClientError) {
    try {
      const payload = JSON.parse(error.responseBody) as {
        detail?: string | { display_message?: string; error_message?: string; message?: string };
      };
      const detail = payload?.detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
      if (detail && typeof detail === 'object') {
        return detail.display_message || detail.error_message || detail.message || fallback;
      }
    } catch {
      // Keep the fallback when FastAPI doesn't return JSON.
    }
  }
  return formatErrorMessage(error, fallback);
}

type UseWhoopIntegrationParams = Pick<
  IntegrationOrchestratorDeps,
  | 'getToken'
  | 'refetchOverview'
  | 'fetchHabits'
  | 'fetchHabitLogs'
  | 'queryClient'
  | 'userId'
  | 'callbackProcessedRef'
  | 'oauthSessionIdRef'
  | 'oauthSessionTokenRef'
  | 'pollingIntervalRef'
  | 'setIsProcessingCallback'
> & {
  whoopConnection: WearableConnection | undefined;
  whoopStatusData: WhoopStatusData | undefined;
  effectiveWhoopConnected: boolean;
};

export function useWhoopIntegration({
  callbackProcessedRef,
  effectiveWhoopConnected,
  fetchHabitLogs,
  fetchHabits,
  getToken,
  oauthSessionIdRef,
  oauthSessionTokenRef,
  pollingIntervalRef,
  queryClient,
  refetchOverview,
  setIsProcessingCallback,
  userId,
  whoopConnection,
  whoopStatusData,
}: UseWhoopIntegrationParams) {
  const { isDesktop } = useDesktopCapabilities();
  const router = useRouter();
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopSyncHour, setWhoopSyncHour] = useState(9);
  const [whoopSyncMode, setWhoopSyncMode] = useState<WhoopSyncMode>('smart');
  const [whoopCustomDaysBack, setWhoopCustomDaysBack] = useState('730');
  const [whoopConnecting, setWhoopConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [whoopSyncFeedback, setWhoopSyncFeedback] = useState<WhoopSyncFeedback | null>(null);

  useEffect(() => {
    if (whoopStatusData !== undefined || whoopConnection) {
      setWhoopConnected(effectiveWhoopConnected);
      setWhoopSyncHour(
        (whoopStatusData?.sync_hour as number | undefined)
          || (whoopConnection?.sync_hour as number | undefined)
          || 9,
      );
    }
  }, [effectiveWhoopConnected, whoopConnection, whoopStatusData]);

  const handleWhoopCallback = useCallback(async (code: string) => {
    try {
      setWhoopConnecting(true);
      const token = await getToken();
      if (!token) {
        setWhoopConnecting(false);
        setIsProcessingCallback(false);
        return;
      }

      const response = await fetch(`/api/integrations/whoop/callback?code=${code}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to connect Whoop');
      }

      setWhoopConnected(true);
      setWhoopConnecting(false);
      setIsProcessingCallback(false);
      refetchOverview();
      router.replace('/integrations');
      setTimeout(() => {
        void handleWhoopSyncRef.current();
      }, 1000);
    } catch (error) {
      console.error('Error handling Whoop callback:', error);
      alert(`Failed to connect Whoop: ${error}`);
      setWhoopConnecting(false);
      setIsProcessingCallback(false);
      callbackProcessedRef.current = false;
      router.replace('/integrations');
    }
  }, [callbackProcessedRef, getToken, refetchOverview, router, setIsProcessingCallback]);

  const handleWhoopSyncRef = useRef<(options?: {
    daysBack?: number;
    forceFullSync?: boolean;
    fullHistory?: boolean;
  }) => Promise<void>>(async () => {});

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, [pollingIntervalRef]);

  const startPollingForConnection = useCallback(() => {
    let pollCount = 0;
    const maxPolls = 60;

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(async () => {
      pollCount += 1;

      try {
        const token = await getToken();
        if (!token) {
          stopPolling();
          return;
        }

        const sessionId = oauthSessionIdRef.current;
        const sessionToken = oauthSessionTokenRef.current;
        if (sessionId && sessionToken) {
          const codeResponse = await fetch(
            `/api/integrations/oauth/store-code?sessionId=${encodeURIComponent(sessionId)}&sessionToken=${encodeURIComponent(sessionToken)}`,
          );

          if (codeResponse.ok) {
            const codeData = await codeResponse.json();
            if (codeData.found && codeData.code) {
              oauthSessionIdRef.current = null;
              oauthSessionTokenRef.current = null;
              await handleWhoopCallback(codeData.code);
              stopPolling();
              return;
            }
          }
        }

        const data = await apiOperationWithAuth(
          'whoop_status_api_integrations_whoop_status_get',
          getToken,
        ) as { connected?: boolean };

        if (data.connected) {
          setWhoopConnected(true);
          setWhoopConnecting(false);
          refetchOverview();
          stopPolling();
          alert('Whoop connected successfully!');
          return;
        }

        if (pollCount >= maxPolls) {
          setWhoopConnecting(false);
          stopPolling();
        }
      } catch (error) {
        console.error('Error polling Whoop connection:', error);
      }
    }, 2000);
  }, [
    getToken,
    handleWhoopCallback,
    oauthSessionIdRef,
    oauthSessionTokenRef,
    pollingIntervalRef,
    refetchOverview,
    stopPolling,
  ]);

  const handleWhoopConnect = useCallback(async () => {
    try {
      setWhoopConnecting(true);
      oauthSessionIdRef.current = null;
      oauthSessionTokenRef.current = null;

      const clientId = process.env.NEXT_PUBLIC_WHOOP_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_WHOOP_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        throw new Error('Whoop configuration missing');
      }

      const randomState = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const isDesktopApp = isDesktop;
      let sessionId: string | null = null;

      if (isDesktopApp) {
        sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        oauthSessionIdRef.current = sessionId;
        oauthSessionTokenRef.current = sessionToken;
      }

      const stateData = {
        random: randomState,
        source: isDesktopApp ? 'desktop' : 'web',
        ...(sessionId && { sessionId }),
        ...(oauthSessionTokenRef.current && { sessionToken: oauthSessionTokenRef.current }),
      };
      const state = btoa(JSON.stringify(stateData));

      const authUrl = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'offline read:recovery read:sleep read:workout read:cycles read:profile');
      authUrl.searchParams.set('state', state);

      await openInBrowser(authUrl.toString());

      if (isDesktopApp) {
        startPollingForConnection();
      }
    } catch (error) {
      console.error('Error connecting to Whoop:', error);
      setWhoopConnecting(false);
    }
  }, [oauthSessionIdRef, oauthSessionTokenRef, startPollingForConnection]);

  const getWhoopSyncRequestFromMode = useCallback(() => {
    switch (whoopSyncMode) {
      case '30d':
        return { daysBack: 30 };
      case '90d':
        return { daysBack: 90 };
      case '365d':
        return { daysBack: 365 };
      case 'custom': {
        const parsed = Number.parseInt(whoopCustomDaysBack, 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_CUSTOM_WHOOP_DAYS) {
          throw new Error(`Enter a custom backfill between 1 and ${MAX_CUSTOM_WHOOP_DAYS} days before syncing.`);
        }
        return { daysBack: parsed };
      }
      case 'full':
        return { fullHistory: true };
      case 'smart':
      default:
        return {};
    }
  }, [whoopCustomDaysBack, whoopSyncMode]);

  const handleWhoopSync = useCallback(async (options?: {
    daysBack?: number;
    forceFullSync?: boolean;
    fullHistory?: boolean;
  }) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      setSyncing(true);
      setWhoopSyncFeedback({ type: 'syncing', message: 'Syncing Whoop data...' });

      const token = await getToken();
      if (!token) {
        setWhoopSyncFeedback({ type: 'error', message: 'Sign in again to sync Whoop.' });
        setSyncing(false);
        return;
      }

      const syncRequest =
        options && !isLikelyReactEvent(options) ? options : getWhoopSyncRequestFromMode();

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 90000);

      const result = await apiOperationWithAuth(
        'whoop_sync_api_integrations_whoop_sync_post',
        getToken,
        {
          query: {
            days_back: syncRequest.daysBack,
            force_full_sync: 'forceFullSync' in syncRequest ? syncRequest.forceFullSync : undefined,
            full_history: syncRequest.fullHistory,
          },
          signal: controller.signal,
        },
        userId,
      ) as {
        data?: { counts?: Record<string, number> } & Record<string, number>;
        data_freshness?: {
          latest_upstream_sleep_date?: string | null;
          latest_sleep_date?: string | null;
        };
      };
      const rawCounts = result.data?.counts || result.data || {};
      const syncCounts = {
        recovery: Number(rawCounts.recovery || 0),
        sleep: Number(rawCounts.sleep || 0),
        workouts: Number(rawCounts.workouts || 0),
        cycles: Number(rawCounts.cycles || 0),
      };
      const syncLabel = syncRequest.fullHistory
        ? 'full history'
        : syncRequest.daysBack
          ? `the last ${syncRequest.daysBack} days`
          : 'forceFullSync' in syncRequest && syncRequest.forceFullSync
            ? 'the default backfill'
            : 'latest changes';
      const successMessage = buildWhoopSyncFeedbackMessage(
        syncCounts,
        syncLabel,
        result.data_freshness,
      );

      setWhoopConnected(true);
      markReadConsistencyRequired(userId, 45_000);
      clearPersistedDashboardSnapshots(userId);
      const refreshResults = await Promise.allSettled([
        invalidateHabitData(queryClient, userId || 'anonymous'),
        refetchOverview(),
        fetchHabits(),
        fetchHabitLogs(),
      ]);
      const refreshFailed = refreshResults.some((result) => result.status === 'rejected');

      setWhoopSyncFeedback({
        type: 'success',
        message: refreshFailed
          ? `${successMessage} Some views may take a moment to refresh.`
          : successMessage,
      });
    } catch (error) {
      console.error('Error syncing Whoop:', error);
      const fallbackMessage =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Sync timed out. The request took too long.'
          : 'Unknown error';
      const message = `Sync failed: ${whoopApiErrorMessage(error, fallbackMessage)}`;
      setWhoopSyncFeedback({ type: 'error', message });
      alert(message);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      setSyncing(false);
    }
  }, [
    fetchHabitLogs,
    fetchHabits,
    getToken,
    getWhoopSyncRequestFromMode,
    queryClient,
    refetchOverview,
    userId,
  ]);

  handleWhoopSyncRef.current = handleWhoopSync;

  const handleWhoopDisconnect = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      if (!confirm('Are you sure you want to disconnect Whoop?')) {
        return;
      }

      await apiOperationWithAuth(
        'whoop_disconnect_api_integrations_whoop_delete',
        getToken,
      );

      setWhoopConnected(false);
      refetchOverview();
      callbackProcessedRef.current = false;
      alert('Whoop disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting Whoop:', error);
      alert(`Failed to disconnect: ${whoopApiErrorMessage(error, 'Unknown error')}`);
    }
  }, [callbackProcessedRef, getToken, refetchOverview]);

  return {
    handleWhoopCallback,
    handleWhoopConnect,
    handleWhoopDisconnect,
    handleWhoopSync,
    setWhoopCustomDaysBack,
    setWhoopSyncHour,
    setWhoopSyncMode,
    syncing,
    whoopConnecting,
    whoopConnected,
    whoopCustomDaysBack,
    whoopSyncFeedback,
    whoopSyncHour,
    whoopSyncMode,
  };
}
