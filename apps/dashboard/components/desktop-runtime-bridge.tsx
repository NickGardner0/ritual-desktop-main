'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { DesktopUpdater } from '@/components/desktop-updater';
import { buildDesktopCommandOrigin, desktopHasCapability, desktopSetAuthToken } from '@/lib/desktop-runtime';
import { isTauri } from '@/lib/tauri-utils';
import { habitLogKeys } from '@/hooks/use-habits-query';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const DESKTOP_RUNTIME_BRIDGE_POLL_MS = 10_000;
const DESKTOP_RUNTIME_BRIDGE_OVERVIEW_POLL_MS = 30_000;

interface RuntimeBridgeSignalsResponse {
  token_refresh_request?: number;
  dashboard_refresh_trigger?: number;
}

type DesktopBridgeMode = 'probing' | 'native' | 'legacy';

type TauriInvoke = typeof import('@tauri-apps/api/tauri').invoke;
let tauriInvokePromise: Promise<TauriInvoke> | null = null;

async function getTauriInvoke(): Promise<TauriInvoke> {
  if (!tauriInvokePromise) {
    tauriInvokePromise = import('@tauri-apps/api/tauri').then((module) => module.invoke);
  }
  return tauriInvokePromise;
}

interface TursoSyncConfigResponse {
  sync_url: string;
  auth_token: string;
  expires_at: string;
  database_name: string;
}

function RuntimeSyncBridge() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [bridgeMode, setBridgeMode] = useState<DesktopBridgeMode>('probing');
  const lastTokenRefreshCheckRef = useRef(0);
  const lastDashboardRefreshRef = useRef(0);
  const lastProfileSyncKeyRef = useRef<string | null>(null);
  const lastLegacyReconciledUserRef = useRef<string | null>(null);
  const lastTursoSyncConfigRef = useRef<TursoSyncConfigResponse | null>(null);
  const lastTursoSyncRefreshRef = useRef(0);
  const nextTursoSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReconnectAttemptRef = useRef(0);
  const realtimeHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runtimeBridgePollMs = pathname === '/dashboard'
    ? DESKTOP_RUNTIME_BRIDGE_OVERVIEW_POLL_MS
    : DESKTOP_RUNTIME_BRIDGE_POLL_MS;

  useEffect(() => {
    if (!isTauri()) return;

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
  }, []);

  useEffect(() => {
    if (!isTauri() || !user?.id) return;

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

        await fetch(`${PYTHON_API_BASE}/api/user/profile`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        });
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
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
    user?.primaryPhoneNumber?.phoneNumber,
  ]);

  useEffect(() => {
    if (!isTauri() || bridgeMode === 'probing') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const syncAuthToken = async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;

        if (bridgeMode === 'native') {
          await desktopSetAuthToken({
            token,
            userId: user?.id ?? null,
            backendBase: PYTHON_API_BASE,
          });
          return;
        }

        const { invoke } = await import('@tauri-apps/api/tauri');
        await invoke('write_auth_token_to_file', {
          token,
          origin: buildDesktopCommandOrigin('desktop-runtime-bridge:write_auth_token_to_file'),
        });

        if (user?.id && lastLegacyReconciledUserRef.current !== user.id) {
          lastLegacyReconciledUserRef.current = user.id;
          await Promise.all([
            invoke<boolean>('reconcile_watcher_config_user_cmd', { userId: user.id }).catch(() => false),
            invoke<boolean>('reconcile_recorder_config_user_cmd', { userId: user.id }).catch(() => false),
          ]);
        }
      } catch {
        // Ignore until the native client/backend are ready.
      }
    };

    void syncAuthToken();
    if (bridgeMode === 'legacy') {
      interval = setInterval(() => {
        void syncAuthToken();
      }, 5 * 60_000);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [bridgeMode, getToken, user?.id]);

  useEffect(() => {
    if (!isTauri() || !user?.id || bridgeMode !== 'legacy') return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const clearScheduledRefresh = () => {
      if (nextTursoSyncTimeoutRef.current) {
        clearTimeout(nextTursoSyncTimeoutRef.current);
        nextTursoSyncTimeoutRef.current = null;
      }
    };

    const shouldRefreshTursoConfig = (force: boolean) => {
      if (force) return true;
      const now = Date.now();
      const currentConfig = lastTursoSyncConfigRef.current;

      if (!currentConfig) return true;
      if ((now - lastTursoSyncRefreshRef.current) >= 30 * 60 * 1000) return true;

      const expiresAtMs = Date.parse(currentConfig.expires_at);
      if (Number.isFinite(expiresAtMs)) {
        return (expiresAtMs - now) <= 30 * 60 * 1000;
      }

      return true;
    };

    const scheduleExpiryRefresh = (config: TursoSyncConfigResponse) => {
      clearScheduledRefresh();
      const expiresAtMs = Date.parse(config.expires_at);
      if (!Number.isFinite(expiresAtMs)) return;

      const delayMs = Math.max(0, expiresAtMs - Date.now() - 30 * 60 * 1000);
      nextTursoSyncTimeoutRef.current = setTimeout(() => {
        void refreshTursoConfig(true);
      }, delayMs);
    };

    const refreshTursoConfig = async (force = false) => {
      if (!shouldRefreshTursoConfig(force)) return;

      try {
        const token = await getToken();
        if (!token || cancelled) return;

        const response = await fetch(`${PYTHON_API_BASE}/api/user/turso-sync-config`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`Turso sync config fetch failed: ${response.status}`);
        }

        const config = await response.json() as TursoSyncConfigResponse;
        if (cancelled) return;

        const { invoke } = await import('@tauri-apps/api/tauri');
        await invoke('write_turso_sync_config', {
          syncUrl: config.sync_url,
          authToken: config.auth_token,
          expiresAt: config.expires_at,
          databaseName: config.database_name,
          origin: buildDesktopCommandOrigin('desktop-runtime-bridge:write_turso_sync_config'),
        });

        lastTursoSyncConfigRef.current = config;
        lastTursoSyncRefreshRef.current = Date.now();
        scheduleExpiryRefresh(config);
      } catch {
        // Ignore until the native client/backend are ready.
      }
    };

    void refreshTursoConfig(true);
    interval = setInterval(() => {
      void refreshTursoConfig(false);
    }, 30 * 60_000);

    return () => {
      cancelled = true;
      clearScheduledRefresh();
      if (interval) clearInterval(interval);
    };
  }, [bridgeMode, getToken, user?.id]);

  useEffect(() => {
    if (!isTauri() || bridgeMode !== 'legacy') return;

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
          const userId = user?.id || 'anonymous';
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: habitLogKeys.all }),
            queryClient.invalidateQueries({ queryKey: ['analytics-summary', userId] }),
          ]);
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
  }, [bridgeMode, getToken, queryClient, runtimeBridgePollMs, user?.id]);

  useEffect(() => {
    if (!isTauri() || bridgeMode !== 'native') return;

    let cancelled = false;
    let unlistenRefresh: (() => void) | null = null;
    let unlistenToken: (() => void) | null = null;

    const handleDashboardRefresh = async () => {
      const userId = user?.id || 'anonymous';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: habitLogKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['analytics-summary', userId] }),
      ]);
    };

    const handleTokenRefresh = async () => {
      const token = await getToken();
      if (!token || cancelled) return;

      await desktopSetAuthToken({
        token,
        userId: user?.id ?? null,
        backendBase: PYTHON_API_BASE,
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
  }, [bridgeMode, getToken, queryClient, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

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

        const backendBase = PYTHON_API_BASE.replace(/\/$/, '');
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

            void Promise.all([
              queryClient.invalidateQueries({ queryKey: habitLogKeys.all }),
              queryClient.invalidateQueries({ queryKey: ['analytics-summary', user.id] }),
            ]);

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
  }, [getToken, queryClient, user?.id]);

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
