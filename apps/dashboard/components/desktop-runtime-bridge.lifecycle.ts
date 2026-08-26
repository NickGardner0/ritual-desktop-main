'use client';

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { apiOperationWithAuth } from '@/lib/api/client';
import { invokeDesktopCommand } from '@/lib/native-gateway';
import {
  buildDesktopCommandOrigin,
  desktopHasCapability,
  desktopSetPrivacyState,
  desktopSetAuthToken,
  getDesktopRuntimeInfo,
  syncComputerActivityNow,
} from '@/lib/native-gateway';
import { acknowledgeDesktopAuthHandoff } from '@/lib/desktop-auth-handoff';
import { invalidateAfterComputerSync, invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import { readPrivacySettings } from '@/lib/privacy/privacy-settings';
import {
  COMPUTER_HISTORY_BACKFILL_DELAY_MS,
  COMPUTER_HISTORY_BACKFILL_LAST_KEY,
  COMPUTER_HISTORY_BACKFILL_THROTTLE_MS,
  DESKTOP_AUTH_TOKEN_REFRESH_MS,
  type DesktopBridgeMode,
  type RuntimeBridgeSignalsResponse,
  resolveDesktopBackendBase,
} from '@/components/desktop-runtime-bridge.shared';

type AuthUser = {
  id?: string;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  primaryPhoneNumber?: { phoneNumber?: string | null } | null;
} | null | undefined;

export function useDesktopBridgeMode(
  isDesktop: boolean,
  setBridgeMode: Dispatch<SetStateAction<DesktopBridgeMode>>,
): void {
  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;

    void (async () => {
      const hasNativeBridge = await desktopHasCapability('desktop-auth-handoff-v1');
      if (!cancelled) {
        setBridgeMode(hasNativeBridge ? 'native' : 'legacy');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDesktop, setBridgeMode]);
}

export function useDesktopProfileSync(input: {
  isDesktop: boolean;
  user: AuthUser;
  getToken: () => Promise<string | null>;
  lastProfileSyncKeyRef: MutableRefObject<string | null>;
}): void {
  const { isDesktop, user, getToken, lastProfileSyncKeyRef } = input;

  useEffect(() => {
    if (!isDesktop || !user?.id) return;

    const syncKey = JSON.stringify({
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress ?? '',
      phone: user.primaryPhoneNumber?.phoneNumber ?? '',
    });

    if (lastProfileSyncKeyRef.current === syncKey) {
      return;
    }
    lastProfileSyncKeyRef.current = syncKey;

    let cancelled = false;

    const syncProfile = async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;

        await apiOperationWithAuth(
          'get_user_profile_api_user_profile_get',
          getToken,
          {},
          user?.id,
        );
      } catch (error) {
        console.warn('Backend profile sync failed:', error);
      }
    };

    void syncProfile();

    return () => {
      cancelled = true;
    };
  }, [
    getToken,
    isDesktop,
    lastProfileSyncKeyRef,
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
    user?.primaryPhoneNumber?.phoneNumber,
  ]);
}

export function useDesktopAuthBridge(input: {
  isDesktop: boolean;
  bridgeMode: DesktopBridgeMode;
  setBridgeMode: Dispatch<SetStateAction<DesktopBridgeMode>>;
  getToken: () => Promise<string | null>;
  userId?: string;
  lastLegacyReconciledUserRef: MutableRefObject<string | null>;
}): void {
  const { isDesktop, bridgeMode, setBridgeMode, getToken, userId, lastLegacyReconciledUserRef } = input;

  useEffect(() => {
    if (!isDesktop || bridgeMode === 'probing') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const syncAuthToken = async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;

        if (await desktopHasCapability('desktop-privacy-state-v1')) {
          await desktopSetPrivacyState(readPrivacySettings());
          if (cancelled) return;
        }

        const nativeResult = await desktopSetAuthToken({
          token,
          userId: userId ?? null,
          backendBase: resolveDesktopBackendBase(),
        });
        if (nativeResult) {
          const runtimeInfo = await getDesktopRuntimeInfo();
          if (runtimeInfo?.handoffProtocol === '2') {
            await acknowledgeDesktopAuthHandoff(runtimeInfo).catch(() => false);
          }
          if (bridgeMode !== 'native' && !cancelled) {
            setBridgeMode('native');
          }
          return;
        }

        if (bridgeMode === 'legacy') {
          await invokeDesktopCommand('write_auth_token_to_file', {
            token,
            origin: buildDesktopCommandOrigin('desktop-runtime-bridge:write_auth_token_to_file'),
          });

          if (userId && lastLegacyReconciledUserRef.current !== userId) {
            lastLegacyReconciledUserRef.current = userId;
            await invokeDesktopCommand<boolean>('reconcile_watcher_config_user_cmd', { userId }).catch(() => false);
          }
        }
      } catch {
        // Ignore until the native client/backend are ready.
      }
    };

    void syncAuthToken();

    const handleVisibilityRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void syncAuthToken();
    };

    const handlePrivacySettingsChanged = () => {
      if (cancelled || bridgeMode !== 'native') return;
      void desktopSetPrivacyState(readPrivacySettings());
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityRefresh);
    }
    window.addEventListener('focus', handleVisibilityRefresh);
    window.addEventListener('ritual:privacy-settings-changed', handlePrivacySettingsChanged);

    if (bridgeMode === 'legacy') {
      interval = setInterval(() => {
        void syncAuthToken();
      }, DESKTOP_AUTH_TOKEN_REFRESH_MS);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      }
      window.removeEventListener('focus', handleVisibilityRefresh);
      window.removeEventListener('ritual:privacy-settings-changed', handlePrivacySettingsChanged);
    };
  }, [bridgeMode, getToken, isDesktop, lastLegacyReconciledUserRef, setBridgeMode, userId]);
}

export function useDesktopLegacySignals(input: {
  isDesktop: boolean;
  bridgeMode: DesktopBridgeMode;
  getToken: () => Promise<string | null>;
  queryClient: QueryClient;
  runtimeBridgePollMs: number;
  userId?: string;
  lastTokenRefreshCheckRef: MutableRefObject<number>;
  lastDashboardRefreshRef: MutableRefObject<number>;
}): void {
  const {
    isDesktop,
    bridgeMode,
    getToken,
    queryClient,
    runtimeBridgePollMs,
    userId,
    lastTokenRefreshCheckRef,
    lastDashboardRefreshRef,
  } = input;

  useEffect(() => {
    if (!isDesktop || bridgeMode !== 'legacy') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let inFlight = false;

    const checkRuntimeBridgeSignals = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      inFlight = true;
      try {
        let payload: RuntimeBridgeSignalsResponse | null = null;

        try {
          payload = await invokeDesktopCommand<RuntimeBridgeSignalsResponse>('check_runtime_bridge_signals');
        } catch {
          const [token_refresh_request, dashboard_refresh_trigger] = await Promise.all([
            invokeDesktopCommand<number>('check_token_refresh_request'),
            invokeDesktopCommand<number>('check_dashboard_refresh_trigger'),
          ]);
          payload = { token_refresh_request, dashboard_refresh_trigger };
        }

        if (cancelled || !payload) return;

        const tokenRefreshTimestamp = Number(payload.token_refresh_request || 0);
        if (
          tokenRefreshTimestamp > 0
          && tokenRefreshTimestamp !== lastTokenRefreshCheckRef.current
        ) {
          lastTokenRefreshCheckRef.current = tokenRefreshTimestamp;
          const token = await getToken();
          if (!cancelled && token) {
            await invokeDesktopCommand('write_auth_token_to_file', {
              token,
              origin: buildDesktopCommandOrigin('desktop-runtime-bridge:token-refresh-request'),
            });
          }
        }

        const dashboardRefreshTimestamp = Number(payload.dashboard_refresh_trigger || 0);
        if (
          dashboardRefreshTimestamp > 0
          && dashboardRefreshTimestamp !== lastDashboardRefreshRef.current
        ) {
          lastDashboardRefreshRef.current = dashboardRefreshTimestamp;
          markReadConsistencyRequired(userId);
          await invalidateAfterComputerSync(queryClient, userId);
        }
      } catch {
        // Ignore outside desktop runtime.
      } finally {
        inFlight = false;
      }
    };

    const handleVisibilityRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void checkRuntimeBridgeSignals();
    };

    void checkRuntimeBridgeSignals();
    interval = setInterval(() => {
      void checkRuntimeBridgeSignals();
    }, runtimeBridgePollMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityRefresh);
    }
    window.addEventListener('focus', handleVisibilityRefresh);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      }
      window.removeEventListener('focus', handleVisibilityRefresh);
    };
  }, [
    bridgeMode,
    getToken,
    isDesktop,
    lastDashboardRefreshRef,
    lastTokenRefreshCheckRef,
    queryClient,
    runtimeBridgePollMs,
    userId,
  ]);
}

export function useDesktopNativeEvents(input: {
  isDesktop: boolean;
  bridgeMode: DesktopBridgeMode;
  getToken: () => Promise<string | null>;
  queryClient: QueryClient;
  userId?: string;
}): void {
  const { isDesktop, bridgeMode, getToken, queryClient, userId } = input;

  useEffect(() => {
    if (!isDesktop || bridgeMode !== 'native') return;

    let cancelled = false;
    let unlistenRefresh: (() => void) | null = null;
    let unlistenToken: (() => void) | null = null;

    const handleDashboardRefresh = async () => {
      markReadConsistencyRequired(userId);
      await invalidateAfterComputerSync(queryClient, userId);
    };

    const handleTokenRefresh = async () => {
      const token = await getToken();
      if (!token || cancelled) return;

      if (await desktopHasCapability('desktop-privacy-state-v1')) {
        await desktopSetPrivacyState(readPrivacySettings());
        if (cancelled) return;
      }

      await desktopSetAuthToken({
        token,
        userId: userId ?? null,
        backendBase: resolveDesktopBackendBase(),
      });
    };

    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        unlistenRefresh = await listen('desktop://dashboard-refresh', () => {
          void handleDashboardRefresh();
        });
        unlistenToken = await listen('desktop://token-refresh-needed', () => {
          void handleTokenRefresh();
        });
      })
      .catch((error) => {
        console.warn('Desktop runtime event bridge unavailable:', error);
      });

    return () => {
      cancelled = true;
      if (unlistenRefresh) unlistenRefresh();
      if (unlistenToken) unlistenToken();
    };
  }, [bridgeMode, getToken, isDesktop, queryClient, userId]);
}

export function useDesktopActivityBackfill(input: {
  isDesktop: boolean;
  bridgeMode: DesktopBridgeMode;
  getToken: () => Promise<string | null>;
  queryClient: QueryClient;
  userId?: string;
}): void {
  const { isDesktop, bridgeMode, queryClient, userId } = input;

  useEffect(() => {
    if (!isDesktop || bridgeMode === 'probing' || !userId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runComputerHistoryBackfill = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      const storageKey = `${COMPUTER_HISTORY_BACKFILL_LAST_KEY}:${userId}`;
      const lastSyncedAt = Number(window.localStorage.getItem(storageKey) || '0');
      if (Date.now() - lastSyncedAt < COMPUTER_HISTORY_BACKFILL_THROTTLE_MS) {
        return;
      }

      if (bridgeMode !== 'native' || !(await desktopHasCapability('desktop-computer-sync-v2'))) {
        return;
      }

      try {
        await desktopSetPrivacyState(readPrivacySettings());
        const result = await syncComputerActivityNow();
        if (result && result.outcome !== 'failed' && result.outcome !== 'privacy_blocked') {
          window.localStorage.setItem(storageKey, String(Date.now()));
        }

        if (cancelled) return;

        if (result && result.outcome !== 'failed' && result.outcome !== 'privacy_blocked') {
          markReadConsistencyRequired(userId);
          await invalidateAfterComputerSync(queryClient, userId);
        }
      } catch (error) {
        console.warn('Computer Time history backfill failed:', error);
      }
    };

    timer = setTimeout(() => {
      void runComputerHistoryBackfill();
    }, COMPUTER_HISTORY_BACKFILL_DELAY_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bridgeMode, isDesktop, queryClient, userId]);
}

export function useDesktopRealtimeSync(input: {
  isDesktop: boolean;
  getToken: () => Promise<string | null>;
  queryClient: QueryClient;
  userId?: string;
  realtimeSocketRef: MutableRefObject<WebSocket | null>;
  realtimeReconnectTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  realtimeReconnectAttemptRef: MutableRefObject<number>;
  realtimeHeartbeatRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
}): void {
  const {
    isDesktop,
    getToken,
    queryClient,
    userId,
    realtimeSocketRef,
    realtimeReconnectTimerRef,
    realtimeReconnectAttemptRef,
    realtimeHeartbeatRef,
  } = input;

  useEffect(() => {
    if (!isDesktop || !userId) return;
    if (readPrivacySettings().mode === 'local_only') return;

    let cancelled = false;

    const closeSocket = () => {
      if (realtimeReconnectTimerRef.current) {
        clearTimeout(realtimeReconnectTimerRef.current);
        realtimeReconnectTimerRef.current = null;
      }

      if (realtimeHeartbeatRef.current) {
        clearInterval(realtimeHeartbeatRef.current);
        realtimeHeartbeatRef.current = null;
      }

      const activeSocket = realtimeSocketRef.current;
      realtimeSocketRef.current = null;
      if (activeSocket) {
        activeSocket.close();
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || realtimeReconnectTimerRef.current) return;

      const attempt = realtimeReconnectAttemptRef.current + 1;
      realtimeReconnectAttemptRef.current = attempt;
      const delayMs = Math.min(30_000, 1_000 * Math.pow(2, Math.min(attempt - 1, 5)));

      realtimeReconnectTimerRef.current = setTimeout(() => {
        realtimeReconnectTimerRef.current = null;
        void connectRealtime();
      }, delayMs);
    };

    const playRemoteHabitLogSound = () => {
      try {
        const audioCtx = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        if (audioCtx.state === 'suspended') void audioCtx.resume();
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioCtx.destination);
        osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime);
        osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime);
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.start(audioCtx.currentTime);
        osc2.start(audioCtx.currentTime);
        osc1.stop(audioCtx.currentTime + 0.6);
        osc2.stop(audioCtx.currentTime + 0.6);
      } catch (e) {
        console.log('Remote habit log sound failed:', e);
      }
    };

    const connectRealtime = async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;

        const resolvedBackendBase = resolveDesktopBackendBase();
        if (!resolvedBackendBase || cancelled) return;

        const backendBase = resolvedBackendBase.replace(/\/$/, '');
        const wsBase = backendBase
          .replace(/^http:\/\//i, 'ws://')
          .replace(/^https:\/\//i, 'wss://');
        const wsUrl = `${wsBase}/ws/${encodeURIComponent(userId)}?token=${encodeURIComponent(token)}`;

        closeSocket();

        const socket = new WebSocket(wsUrl);
        realtimeSocketRef.current = socket;

        socket.onopen = () => {
          realtimeReconnectAttemptRef.current = 0;
          if (realtimeHeartbeatRef.current) {
            clearInterval(realtimeHeartbeatRef.current);
          }
          realtimeHeartbeatRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send('ping');
            }
          }, 25_000);
        };

        socket.onmessage = (event) => {
          try {
            if (typeof event.data === 'string' && event.data.startsWith('pong:')) {
              return;
            }
            const payload = JSON.parse(event.data);
            if (payload?.type !== 'habit_logged') return;

            markReadConsistencyRequired(userId);
            void invalidateHabitData(queryClient, userId);

            if (payload.playSound) {
              playRemoteHabitLogSound();
            }

            window.dispatchEvent(new CustomEvent('ritual:habit-log-updated', {
              detail: payload.data || null,
            }));
          } catch (error) {
            console.warn('Realtime habit update parse failed:', error);
          }
        };

        socket.onerror = () => {
          socket.close();
        };

        socket.onclose = () => {
          if (realtimeHeartbeatRef.current) {
            clearInterval(realtimeHeartbeatRef.current);
            realtimeHeartbeatRef.current = null;
          }
          const wasCurrentSocket = realtimeSocketRef.current === socket;
          if (wasCurrentSocket) {
            realtimeSocketRef.current = null;
          }
          if (wasCurrentSocket) {
            scheduleReconnect();
          }
        };
      } catch (error) {
        console.warn('Realtime habit connection failed:', error);
        scheduleReconnect();
      }
    };

    void connectRealtime();

    return () => {
      cancelled = true;
      closeSocket();
    };
  }, [
    getToken,
    isDesktop,
    queryClient,
    realtimeHeartbeatRef,
    realtimeReconnectAttemptRef,
    realtimeReconnectTimerRef,
    realtimeSocketRef,
    userId,
  ]);
}
