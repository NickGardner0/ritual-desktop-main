'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { DesktopUpdater } from '@/components/desktop-updater';
import { buildDesktopCommandOrigin, desktopHasCapability, desktopSetAuthToken } from '@/lib/desktop-runtime';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { invalidateAfterComputerSync, invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import { apiFetchWithAuth } from '@/lib/api/client';
import { playInteractionSound } from '@/lib/interaction-sounds';

const DESKTOP_RUNTIME_BRIDGE_POLL_MS = 10_000;
const DESKTOP_RUNTIME_BRIDGE_OVERVIEW_POLL_MS = 60_000;
const DESKTOP_AUTH_TOKEN_REFRESH_MS = 45_000;
const COMPUTER_HISTORY_BACKFILL_DAYS = 3650;
const COMPUTER_HISTORY_BACKFILL_DELAY_MS = 20_000;
const COMPUTER_HISTORY_BACKFILL_THROTTLE_MS = 12 * 60 * 60 * 1000;
const COMPUTER_HISTORY_BACKFILL_LAST_KEY = 'ritual:computer-history-backfill:last:v1';
const LOCAL_DESKTOP_BACKEND_BASE = `${'http'}://${['127', '0', '0', '1'].join('.')}:${8000}`;

interface RuntimeBridgeSignalsResponse {
  token_refresh_request?: number;
  dashboard_refresh_trigger?: number;
}

type DesktopBridgeMode = 'probing' | 'native' | 'legacy';

type TauriInvoke = typeof import('@tauri-apps/api/core').invoke;
let tauriInvokePromise: Promise<TauriInvoke> | null = null;

async function getTauriInvoke(): Promise<TauriInvoke> {
  if (!tauriInvokePromise) {
    tauriInvokePromise = import('@tauri-apps/api/core').then((module) => module.invoke);
  }
  return tauriInvokePromise;
}

function resolveDesktopBackendBase(): string | null {
  return (process.env.NEXT_PUBLIC_RITUAL_BACKEND_BASE_URL || LOCAL_DESKTOP_BACKEND_BASE).replace(/\/$/, '');
}

function RuntimeSyncBridge() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { isDesktop } = useDesktopCapabilities();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [bridgeMode, setBridgeMode] = useState<DesktopBridgeMode>('probing');
  const lastTokenRefreshCheckRef = useRef(0);
  const lastDashboardRefreshRef = useRef(0);
  const lastProfileSyncKeyRef = useRef<string | null>(null);
  const lastLegacyReconciledUserRef = useRef<string | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReconnectAttemptRef = useRef(0);
  const realtimeHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runtimeBridgePollMs = pathname === '/dashboard'
    ? DESKTOP_RUNTIME_BRIDGE_OVERVIEW_POLL_MS
    : DESKTOP_RUNTIME_BRIDGE_POLL_MS;

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
  }, [isDesktop]);

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

        await apiFetchWithAuth('/api/user/profile', getToken);
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
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
    user?.primaryPhoneNumber?.phoneNumber,
  ]);

  useEffect(() => {
    if (!isDesktop || bridgeMode === 'probing') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const syncAuthToken = async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;

        const nativeResult = await desktopSetAuthToken({
          token,
          userId: user?.id ?? null,
          backendBase: resolveDesktopBackendBase(),
        });
        if (nativeResult) {
          if (bridgeMode !== 'native' && !cancelled) {
            setBridgeMode('native');
          }
          return;
        }

        if (bridgeMode === 'legacy') {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('write_auth_token_to_file', {
            token,
            origin: buildDesktopCommandOrigin('desktop-runtime-bridge:write_auth_token_to_file'),
          });

          if (user?.id && lastLegacyReconciledUserRef.current !== user.id) {
            lastLegacyReconciledUserRef.current = user.id;
            await invoke<boolean>('reconcile_watcher_config_user_cmd', { userId: user.id }).catch(() => false);
          }
        }
      } catch {
        // Ignore until the native client/backend are ready.
      }
    };

    void syncAuthToken();
    interval = setInterval(() => {
      void syncAuthToken();
    }, DESKTOP_AUTH_TOKEN_REFRESH_MS);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [bridgeMode, getToken, isDesktop, user?.id]);

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
        const invoke = await getTauriInvoke();
        let payload: RuntimeBridgeSignalsResponse | null = null;

        try {
          payload = await invoke<RuntimeBridgeSignalsResponse>('check_runtime_bridge_signals');
        } catch {
          const [token_refresh_request, dashboard_refresh_trigger] = await Promise.all([
            invoke<number>('check_token_refresh_request'),
            invoke<number>('check_dashboard_refresh_trigger'),
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
            await invoke('write_auth_token_to_file', {
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
          markReadConsistencyRequired(user?.id);
          await invalidateAfterComputerSync(queryClient, user?.id);
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
  }, [bridgeMode, getToken, isDesktop, queryClient, runtimeBridgePollMs, user?.id]);

  useEffect(() => {
    if (!isDesktop || bridgeMode === 'probing' || !user?.id) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runComputerHistoryBackfill = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      const storageKey = `${COMPUTER_HISTORY_BACKFILL_LAST_KEY}:${user.id}`;
      const lastSyncedAt = Number(window.localStorage.getItem(storageKey) || '0');
      if (Date.now() - lastSyncedAt < COMPUTER_HISTORY_BACKFILL_THROTTLE_MS) {
        return;
      }

      try {
        const response = await fetch(`/api/watcher/sync-to-habit?days_back=${COMPUTER_HISTORY_BACKFILL_DAYS}`, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'include',
        });
        window.localStorage.setItem(storageKey, String(Date.now()));

        if (!response.ok || cancelled) return;

        const result = await response.json().catch(() => null);
        if (result?.success && result?.synced) {
          markReadConsistencyRequired(user.id);
          await invalidateAfterComputerSync(queryClient, user.id);
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
  }, [bridgeMode, isDesktop, queryClient, user?.id]);

  useEffect(() => {
    if (!isDesktop || bridgeMode !== 'native') return;

    let cancelled = false;
    let unlistenRefresh: (() => void) | null = null;
    let unlistenToken: (() => void) | null = null;

    const handleDashboardRefresh = async () => {
      markReadConsistencyRequired(user?.id);
      await invalidateAfterComputerSync(queryClient, user?.id);
    };

    const handleTokenRefresh = async () => {
      const token = await getToken();
      if (!token || cancelled) return;

      await desktopSetAuthToken({
        token,
        userId: user?.id ?? null,
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
  }, [bridgeMode, getToken, isDesktop, queryClient, user?.id]);

  useEffect(() => {
    if (!isDesktop || !user?.id) return;

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
        const wsUrl = `${wsBase}/ws/${encodeURIComponent(user.id)}?token=${encodeURIComponent(token)}`;

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

            markReadConsistencyRequired(user.id);
            void invalidateHabitData(queryClient, user.id);

            if (payload.playSound) {
              playInteractionSound('habitLogCreated');
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
  }, [getToken, isDesktop, queryClient, user?.id]);

  return null;
}

export function DesktopRuntimeBridge() {
  return (
    <>
      <DesktopUpdater />
      <RuntimeSyncBridge />
    </>
  );
}
