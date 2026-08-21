'use client';

import { useEffect, useState } from 'react';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { openInBrowser } from '@/lib/native-gateway';
import { formatErrorMessage } from '../../integrations-client.shared';
import type { IntegrationOrchestratorDeps, TeslaConnection } from '../types';

type UseTeslaIntegrationParams = Pick<
  IntegrationOrchestratorDeps,
  | 'callbackProcessedRef'
  | 'fetchHabitLogs'
  | 'fetchHabits'
  | 'getToken'
  | 'oauthSessionIdRef'
  | 'oauthSessionTokenRef'
  | 'pollingIntervalRef'
  | 'refetchOverview'
  | 'router'
  | 'setIsProcessingCallback'
> & {
  teslaConnection: TeslaConnection | undefined;
};

export function useTeslaIntegration({
  callbackProcessedRef,
  fetchHabitLogs,
  fetchHabits,
  getToken,
  oauthSessionIdRef,
  oauthSessionTokenRef,
  pollingIntervalRef,
  refetchOverview,
  router,
  setIsProcessingCallback,
  teslaConnection,
}: UseTeslaIntegrationParams) {
  const { isDesktop } = useDesktopCapabilities();
const [teslaConnected, setTeslaConnected] = useState(false);
const [teslaConnecting, setTeslaConnecting] = useState(false);
const [teslaSyncing, setTeslaSyncing] = useState(false);
const [teslaBackfilling, setTeslaBackfilling] = useState(false);
const [teslaBackfillOdometer, setTeslaBackfillOdometer] = useState('');
const [teslaBackfillDate, setTeslaBackfillDate] = useState('');
  const effectiveTeslaConnected = Boolean(teslaConnected || (teslaConnection && teslaConnection.status === 'active'));

  useEffect(() => {
    setTeslaConnected(effectiveTeslaConnected);
  }, [effectiveTeslaConnected]);

  function stopTeslaPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }

// ── Tesla handlers ───────────────────────────────────

async function handleTeslaCallback(code: string) {
  try {
    setTeslaConnecting(true);
    const token = await getToken();
    if (!token) {
      setTeslaConnecting(false);
      setIsProcessingCallback(false);
      return;
    }

    const response = await fetch(`/api/integrations/tesla/callback?code=${code}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error('Failed to connect Tesla');

    setTeslaConnected(true);
    setTeslaConnecting(false);
    setIsProcessingCallback(false);
    refetchOverview();
    router.replace('/integrations');
  } catch (error) {
    console.error('Error handling Tesla callback:', error);
    alert(`Failed to connect Tesla: ${formatErrorMessage(error, 'Unknown error')}`);
    setTeslaConnecting(false);
    setIsProcessingCallback(false);
    callbackProcessedRef.current = false;
    router.replace('/integrations');
  }
}

async function handleTeslaConnect() {
  try {
    setTeslaConnecting(true);
    oauthSessionIdRef.current = null;
    oauthSessionTokenRef.current = null;

    const clientId = process.env.NEXT_PUBLIC_TESLA_CLIENT_ID;
    const redirectUri = process.env.NEXT_PUBLIC_TESLA_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error('Tesla configuration missing. Set NEXT_PUBLIC_TESLA_CLIENT_ID and NEXT_PUBLIC_TESLA_REDIRECT_URI.');
    }

    const randomState = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const isDesktopApp = isDesktop;

    let sessionId = null;
    if (isDesktopApp) {
      sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
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

    const authUrl = new URL('https://auth.tesla.com/oauth2/v3/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid vehicle_device_data offline_access');
    authUrl.searchParams.set('state', state);

    await openInBrowser(authUrl.toString());

    if (isDesktopApp) {
      startPollingForTeslaConnection();
    }
  } catch (error) {
    console.error('Error connecting to Tesla:', error);
    setTeslaConnecting(false);
  }
}

function startPollingForTeslaConnection() {
  let pollCount = 0;
  const maxPolls = 60;

  if (pollingIntervalRef.current) {
    clearInterval(pollingIntervalRef.current);
  }

  pollingIntervalRef.current = setInterval(async () => {
    pollCount++;

    try {
      const token = await getToken();
      if (!token) {
        stopTeslaPolling();
        return;
      }

      const sessionId = oauthSessionIdRef.current;
      const sessionToken = oauthSessionTokenRef.current;
      if (sessionId && sessionToken) {
        const codeResponse = await fetch(
          `/api/integrations/oauth/store-code?sessionId=${encodeURIComponent(sessionId)}&sessionToken=${encodeURIComponent(sessionToken)}`
        );

        if (codeResponse.ok) {
          const codeData = await codeResponse.json();
          if (codeData.found && codeData.code) {
            oauthSessionIdRef.current = null;
            oauthSessionTokenRef.current = null;
            await handleTeslaCallback(codeData.code);
            stopTeslaPolling();
            return;
          }
        }
      }

      const response = await fetch(`/api/integrations/tesla/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.connected) {
          setTeslaConnected(true);
          setTeslaConnecting(false);
          refetchOverview();
          stopTeslaPolling();
          return;
        }
      }

      if (pollCount >= maxPolls) {
        setTeslaConnecting(false);
        stopTeslaPolling();
      }
    } catch (error) {
      console.error('Error polling Tesla connection:', error);
    }
  }, 2000);
}

async function handleTeslaSync() {
  try {
    setTeslaSyncing(true);
    const token = await getToken();
    if (!token) return;

    const response = await fetch(`/api/integrations/tesla/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) throw new Error('Tesla sync failed');
    const result = await response.json();
    console.log('Tesla sync result:', result);
    refetchOverview();
    fetchHabits();
    fetchHabitLogs();
  } catch (error) {
    console.error('Tesla sync error:', error);
    alert(`Tesla sync failed: ${formatErrorMessage(error, 'Unknown error')}`);
  } finally {
    setTeslaSyncing(false);
  }
}

async function handleTeslaBackfill() {
  const odometer = parseFloat(teslaBackfillOdometer);
  if (!odometer || odometer <= 0 || !teslaBackfillDate) {
    alert('Please enter a valid odometer reading and date.');
    return;
  }

  try {
    setTeslaBackfilling(true);
    const token = await getToken();
    if (!token) return;

    const response = await fetch(`/api/integrations/tesla/backfill-odometer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ previous_odometer: odometer, as_of_date: teslaBackfillDate }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Backfill failed');
    }

    const result = await response.json();
    alert(`Backfilled ${result.days_backfilled} days (${result.total_miles} total miles, ~${result.daily_average} mi/day)`);
    setTeslaBackfillOdometer('');
    setTeslaBackfillDate('');
    refetchOverview();
    fetchHabits();
    fetchHabitLogs();
  } catch (error) {
    console.error('Tesla backfill error:', error);
    alert(`Backfill failed: ${formatErrorMessage(error, 'Unknown error')}`);
  } finally {
    setTeslaBackfilling(false);
  }
}

async function handleTeslaDisconnect() {
  try {
    const token = await getToken();
    if (!token) return;

    await fetch(`/api/integrations/tesla`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    setTeslaConnected(false);
    refetchOverview();
  } catch (error) {
    console.error('Tesla disconnect error:', error);
  }
}


  return {
    effectiveTeslaConnected,
    handleTeslaBackfill,
    handleTeslaCallback,
    handleTeslaConnect,
    handleTeslaDisconnect,
    handleTeslaSync,
    setTeslaBackfillDate,
    setTeslaBackfillOdometer,
    teslaBackfillDate,
    teslaBackfillOdometer,
    teslaBackfilling,
    teslaConnecting,
    teslaSyncing,
  };
}
