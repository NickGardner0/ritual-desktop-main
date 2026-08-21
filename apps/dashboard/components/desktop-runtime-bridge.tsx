'use client';

import { useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { DesktopUpdater } from '@/components/desktop-updater';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  DESKTOP_RUNTIME_BRIDGE_OVERVIEW_POLL_MS,
  DESKTOP_RUNTIME_BRIDGE_POLL_MS,
  type DesktopBridgeMode,
} from '@/components/desktop-runtime-bridge.shared';
import {
  useDesktopActivityBackfill,
  useDesktopAuthBridge,
  useDesktopBridgeMode,
  useDesktopLegacySignals,
  useDesktopNativeEvents,
  useDesktopProfileSync,
  useDesktopRealtimeSync,
} from '@/components/desktop-runtime-bridge.lifecycle';

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

  useDesktopBridgeMode(isDesktop, setBridgeMode);
  useDesktopProfileSync({
    isDesktop,
    user,
    getToken,
    lastProfileSyncKeyRef,
  });
  useDesktopAuthBridge({
    isDesktop,
    bridgeMode,
    setBridgeMode,
    getToken,
    userId: user?.id,
    lastLegacyReconciledUserRef,
  });
  useDesktopLegacySignals({
    isDesktop,
    bridgeMode,
    getToken,
    queryClient,
    runtimeBridgePollMs,
    userId: user?.id,
    lastTokenRefreshCheckRef,
    lastDashboardRefreshRef,
  });
  useDesktopNativeEvents({
    isDesktop,
    bridgeMode,
    getToken,
    queryClient,
    userId: user?.id,
  });
  useDesktopActivityBackfill({
    isDesktop,
    bridgeMode,
    getToken,
    queryClient,
    userId: user?.id,
  });
  useDesktopRealtimeSync({
    isDesktop,
    getToken,
    queryClient,
    userId: user?.id,
    realtimeSocketRef,
    realtimeReconnectTimerRef,
    realtimeReconnectAttemptRef,
    realtimeHeartbeatRef,
  });

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
