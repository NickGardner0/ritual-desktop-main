'use client';

import { useEffect, useRef } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { DesktopUpdater } from '@/components/desktop-updater';
import { isTauri } from '@/lib/tauri-utils';
import { habitLogKeys } from '@/hooks/use-habits-query';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

interface TursoSyncConfigResponse {
  sync_url: string;
  auth_token: string;
  expires_at: string;
  database_name: string;
}

function WatcherConfigReconciler() {
  const { isLoaded, user } = useUser();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauri() || !isLoaded || !user?.id) return;
    if (lastUserIdRef.current === user.id) return;
    lastUserIdRef.current = user.id;

    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const updated = await invoke<boolean>('reconcile_watcher_config_user_cmd', {
          userId: user.id,
        });
        if (updated) {
          console.log(`✅ Reconciled watcher config to current user ${user.id}`);
        }
      } catch (error) {
        console.error('Failed to reconcile watcher config user:', error);
      }
    })();
  }, [isLoaded, user?.id]);

  return null;
}

function RecorderConfigReconciler() {
  const { isLoaded, user } = useUser();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauri() || !isLoaded || !user?.id) return;
    if (lastUserIdRef.current === user.id) return;
    lastUserIdRef.current = user.id;

    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const updated = await invoke<boolean>('reconcile_recorder_config_user_cmd', {
          userId: user.id,
        });
        if (updated) {
          console.log(`✅ Reconciled recorder config to current user ${user.id}`);
        }
      } catch (error) {
        console.error('Failed to reconcile recorder config user:', error);
      }
    })();
  }, [isLoaded, user?.id]);

  return null;
}

function RuntimeSyncBridge() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const lastTokenRefreshCheckRef = useRef(0);
  const lastDashboardRefreshRef = useRef(0);
  const lastProfileSyncKeyRef = useRef<string | null>(null);
  const lastTursoSyncConfigRef = useRef<TursoSyncConfigResponse | null>(null);
  const lastTursoSyncRefreshRef = useRef(0);
  const nextTursoSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeSocketRef = useRef<WebSocket | null>(null);
  const realtimeReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReconnectAttemptRef = useRef(0);
  const realtimeHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (!isTauri()) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const writeToken = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const token = await getToken();
        if (!cancelled && token) {
          await invoke('write_auth_token_to_file', { token });
        }
      } catch {
        // Ignore when not available yet.
      }
    };

    void writeToken();
    interval = setInterval(() => {
      void writeToken();
    }, 5 * 60_000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [getToken]);

  useEffect(() => {
    if (!isTauri() || !user?.id) return;

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
  }, [getToken, user?.id]);

  useEffect(() => {
    if (!isTauri()) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const checkForTokenRefreshRequests = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const timestamp = await invoke<number>('check_token_refresh_request');

        if (timestamp > 0 && timestamp !== lastTokenRefreshCheckRef.current) {
          lastTokenRefreshCheckRef.current = timestamp;
          const token = await getToken();
          if (token) {
            await invoke('write_auth_token_to_file', { token });
          }
        }
      } catch {
        // Ignore outside desktop runtime.
      }
    };

    interval = setInterval(checkForTokenRefreshRequests, 3000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [getToken]);

  useEffect(() => {
    if (!isTauri()) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const checkForDashboardRefresh = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const timestamp = await invoke<number>('check_dashboard_refresh_trigger');

        if (timestamp > 0 && timestamp !== lastDashboardRefreshRef.current) {
          lastDashboardRefreshRef.current = timestamp;
          const userId = user?.id || 'anonymous';
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: habitLogKeys.all }),
            queryClient.invalidateQueries({ queryKey: ['analytics-summary', userId] }),
          ]);
        }
      } catch {
        // Ignore outside desktop runtime.
      }
    };

    interval = setInterval(checkForDashboardRefresh, 3000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [queryClient, user?.id]);

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
      <WatcherConfigReconciler />
      <RecorderConfigReconciler />
      <RuntimeSyncBridge />
    </>
  );
}
