'use client';

import { useEffect } from 'react';
import type { ReadonlyURLSearchParams } from 'next/navigation';

type IntegrationOAuthEffectsParams = {
  searchParams: ReadonlyURLSearchParams;
  router: { replace: (path: string) => void };
  callbackProcessedRef: { current: boolean };
  setIsProcessingCallback: (value: boolean) => void;
  setWearableConnectingProvider: (value: string | null) => void;
  refetchOverview: () => unknown;
  handleWhoopCallback: (code: string) => Promise<void>;
  handleTeslaCallback: (code: string) => Promise<void>;
};

export function useIntegrationOAuthEffects({
  callbackProcessedRef,
  handleTeslaCallback,
  handleWhoopCallback,
  refetchOverview,
  router,
  searchParams,
  setIsProcessingCallback,
  setWearableConnectingProvider,
}: IntegrationOAuthEffectsParams) {
  useEffect(() => {
    const whoopCode = searchParams.get('whoop_code');
    const whoopError = searchParams.get('whoop_error');
    const wearableProvider = searchParams.get('wearable_provider');
    const wearableConnected = searchParams.get('wearable_connected');
    const wearableError = searchParams.get('wearable_error');
    const teslaCode = searchParams.get('tesla_code');
    const teslaError = searchParams.get('tesla_error');

    if (whoopCode && !callbackProcessedRef.current) {
      callbackProcessedRef.current = true;
      setIsProcessingCallback(true);
      void handleWhoopCallback(whoopCode);
      return;
    }

    if (teslaCode && !callbackProcessedRef.current) {
      callbackProcessedRef.current = true;
      setIsProcessingCallback(true);
      void handleTeslaCallback(teslaCode);
      return;
    }

    if (teslaError) {
      console.error('Tesla OAuth error:', teslaError);
      alert(`Tesla connection failed: ${teslaError}`);
      router.replace('/integrations');
      return;
    }

    if (wearableProvider && wearableConnected === '1') {
      refetchOverview();
      setWearableConnectingProvider(null);
      alert(`${wearableProvider === 'oura' ? 'Oura' : wearableProvider === 'garmin' ? 'Garmin' : wearableProvider} connected successfully.`);
      router.replace('/integrations');
      return;
    }

    if (wearableProvider && wearableError) {
      setWearableConnectingProvider(null);
      alert(`${wearableProvider} connection failed: ${wearableError}`);
      router.replace('/integrations');
      return;
    }

    if (whoopError) {
      console.error('Whoop OAuth error:', whoopError);
      alert(`Whoop connection failed: ${whoopError}`);
      router.replace('/integrations');
    }
  }, [
    callbackProcessedRef,
    handleTeslaCallback,
    handleWhoopCallback,
    refetchOverview,
    router,
    searchParams,
    setIsProcessingCallback,
    setWearableConnectingProvider,
  ]);
}
