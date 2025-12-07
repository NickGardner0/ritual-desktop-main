/**
 * Integrations Client Component
 * 
 * Handles all client-side interactions:
 * - OAuth flows
 * - Connection/disconnection
 * - Sync operations
 * - Polling for desktop app
 * 
 * Receives initial connection status from Server Component
 */

'use client';

import { useState, useEffect, memo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { Hourglass, Power } from 'lucide-react';
import { openInBrowser, isTauri } from '@/lib/tauri-utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Slider } from '@/components/ui/slider';

const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// Helper to convert 0-23 hour to 12-hour display string
function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${period}`;
}

/**
 * Fetch Whoop connection status with React Query (cached!)
 */
function useWhoopStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['whoop-status', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Whoop status');
      }

      const data = await response.json();
      return data; // return full status object
    },
    staleTime: 1000 * 60 * 2, // Cache for 2 minutes
    enabled: !!user?.id,
  });
}

// Memoized integration card
const IntegrationCard = memo(({
  logo,
  title,
  description,
  comingSoon,
  isConnected,
  isConnecting,
  isSyncing,
  onConnect,
  onSync,
  onDisconnect,
  onDetails
}: {
  logo: React.ReactNode
  title: string
  description: string
  comingSoon?: boolean
  isConnected?: boolean
  isConnecting?: boolean
  isSyncing?: boolean
  onConnect?: () => void
  onSync?: () => void
  onDisconnect?: () => void
  onDetails?: () => void
}) => (
  <div className="bg-white border border-gray-300 p-5 flex flex-col h-[280px]">
    <div className="h-14 mb-4 flex items-start">
      {logo}
    </div>
    <div className="flex items-center mb-2">
      <h3 className="text-base font-medium">{title}</h3>
      {comingSoon && (
        <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
      )}
    </div>
    <p className="text-gray-600 text-sm mb-5 flex-grow">
      {description}
    </p>
    
    <div className="flex items-center gap-3 mt-auto">
      {isConnected ? (
        <>
          <button
            onClick={onDisconnect}
            className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full bg-lime-500 transition-colors focus:outline-none focus:ring-2 focus:ring-lime-500 focus:ring-offset-2"
            role="switch"
            aria-checked="true"
          >
            <span className="pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow-sm transition-transform" />
          </button>
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="px-3 py-2 text-sm whitespace-nowrap border border-gray-300 rounded-none hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50"
            >
              {isSyncing ? (
                <>
                  <Hourglass className="w-4 h-4 mr-2 animate-spin inline-block" />
                  Syncing...
                </>
              ) : (
                'Sync Now'
              )}
            </button>
          )}
          <button
            onClick={onDetails}
            className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#F3F3F3] text-gray-900"
          >
            Details
          </button>
        </>
      ) : comingSoon ? (
        <>
          <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
            Connect
          </button>
          <button
            onClick={onDetails}
            className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]"
          >
            Details
          </button>
        </>
      ) : (
        <>
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className="px-3 py-2 text-sm bg-black text-white rounded-none hover:bg-gray-800 disabled:opacity-50"
          >
            {isConnecting ? (
              <>
                <Hourglass className="w-4 h-4 mr-2 animate-spin inline-block" />
                Connecting...
              </>
            ) : (
              'Connect'
            )}
          </button>
          <button
            onClick={onDetails}
            className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]"
          >
            Details
          </button>
        </>
      )}
    </div>
  </div>
));

IntegrationCard.displayName = 'IntegrationCard';

// ================================
// MAIN CLIENT COMPONENT
// ================================

export function IntegrationsClient() {
  const { getToken } = useAuth();
  const { data: whoopStatusData, isLoading, refetch: refetchWhoopStatus } = useWhoopStatus();
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopSyncHour, setWhoopSyncHour] = useState(9); // Default to 9 AM
  const [whoopConnecting, setWhoopConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Update local state when query data changes
  useEffect(() => {
    if (whoopStatusData !== undefined) {
      setWhoopConnected(whoopStatusData.connected || false);
      setWhoopSyncHour(whoopStatusData.sync_hour || 9);
    }
  }, [whoopStatusData]);

  const callbackProcessedRef = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const oauthSessionIdRef = useRef<string | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const whoopCode = searchParams.get('whoop_code');
    const whoopError = searchParams.get('whoop_error');

    if (whoopCode && !callbackProcessedRef.current) {
      callbackProcessedRef.current = true;
      setIsProcessingCallback(true);
      handleWhoopCallback(whoopCode);
      return;
    }

    if (whoopError) {
      console.error('❌ Whoop OAuth error:', whoopError);
      alert(`Whoop connection failed: ${whoopError}`);
      router.replace('/integrations');
    }
  }, [searchParams]);

  async function handleWhoopCallback(code: string) {
    try {
      setWhoopConnecting(true);

      const token = await getToken();
      if (!token) {
        setWhoopConnecting(false);
        setIsProcessingCallback(false);
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/callback?code=${code}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to connect Whoop');
      }

      const result = await response.json();
      console.log('✅ Whoop connected:', result);

      setWhoopConnected(true);
      setWhoopConnecting(false);
      setIsProcessingCallback(false);
      refetchWhoopStatus(); // Update cache
      router.replace('/integrations');

      setTimeout(() => handleWhoopSync(), 1000);
    } catch (error) {
      console.error('❌ Error handling Whoop callback:', error);
      alert(`Failed to connect Whoop: ${error}`);
      setWhoopConnecting(false);
      setIsProcessingCallback(false);
      callbackProcessedRef.current = false;
      router.replace('/integrations');
    }
  }

  function startPollingForConnection() {
    console.log('🔄 Starting to poll for Whoop connection...');
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
          stopPolling();
          return;
        }

        const sessionId = oauthSessionIdRef.current;
        if (sessionId) {
          const codeResponse = await fetch(`/api/integrations/whoop/store-code?sessionId=${sessionId}`);

          if (codeResponse.ok) {
            const codeData = await codeResponse.json();
            if (codeData.found && codeData.code) {
              oauthSessionIdRef.current = null;
              await handleWhoopCallback(codeData.code);
              stopPolling();
              return;
            }
          }
        }

        const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.connected) {
            setWhoopConnected(true);
            setWhoopConnecting(false);
            refetchWhoopStatus(); // Update cache
            stopPolling();
            alert('✅ Whoop connected successfully!');
            return;
          }
        }

        if (pollCount >= maxPolls) {
          setWhoopConnecting(false);
          stopPolling();
        }
      } catch (error) {
        console.error('❌ Error polling connection:', error);
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }

  async function handleWhoopConnect() {
    try {
      setWhoopConnecting(true);

      const clientId = process.env.NEXT_PUBLIC_WHOOP_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_WHOOP_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        throw new Error('Whoop configuration missing');
      }

      const randomState = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const isDesktopApp = isTauri();

      let sessionId = null;
      if (isDesktopApp) {
        sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        oauthSessionIdRef.current = sessionId;
      }

      const stateData = {
        random: randomState,
        source: isDesktopApp ? 'desktop' : 'web',
        ...(sessionId && { sessionId })
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
      console.error('❌ Error connecting to Whoop:', error);
      setWhoopConnecting(false);
    }
  }

  async function handleWhoopSync() {
    try {
      setSyncing(true);

      const token = await getToken();
      if (!token) {
        setSyncing(false);
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Sync failed');
      }

      const result = await response.json();
      const { recovery, sleep, workouts } = result.data || {};
      const total = (recovery || 0) + (sleep || 0) + (workouts || 0);

      if (total > 0) {
        alert(`Synced ${total} record(s) successfully!\n\n` +
          `- Recovery: ${recovery || 0}\n` +
          `- Sleep: ${sleep || 0}\n` +
          `- Workouts: ${workouts || 0}`);
      } else {
        alert('Sync completed! No new data found.');
      }
    } catch (error) {
      console.error('❌ Error syncing Whoop:', error);
      alert(`Sync failed: ${error}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleWhoopDisconnect() {
    try {
      const token = await getToken();
      if (!token) return;

      if (!confirm('Are you sure you want to disconnect Whoop?')) {
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect Whoop');
      }

      setWhoopConnected(false);
      refetchWhoopStatus(); // Update cache
      callbackProcessedRef.current = false;
      alert('Whoop disconnected successfully');
    } catch (error) {
      console.error('❌ Error disconnecting Whoop:', error);
      alert(`Failed to disconnect: ${error}`);
    }
  }

  async function handleWhoopSyncHourUpdate(newHour: number) {
    try {
      const token = await getToken();
      if (!token) {
        console.error('No authentication token');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/sync-hour`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sync_hour: newHour }),
      });

      if (response.ok) {
        setWhoopSyncHour(newHour);
        alert('✅ Sync time updated successfully!');
        refetchWhoopStatus(); // Update cache
      } else {
        console.error('Failed to update sync hour');
        alert('❌ Failed to update sync time');
      }
    } catch (error) {
      console.error(error);
      alert('❌ Error updating sync time');
    }
  }

  // Show loading skeleton on first fetch only
  const shimmerClass = "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200";
  
  if (isLoading && whoopStatusData === undefined) {
    return (
      <>
        <div className="flex items-center mb-8">
          <div className={`w-5 h-5 rounded mr-2 ${shimmerClass}`}></div>
          <div className={`h-6 w-32 rounded ${shimmerClass}`}></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className={`border border-gray-300 p-5 h-[280px] ${shimmerClass}`} />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-medium">Integrations</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Whoop Card */}
        <IntegrationCard
          logo={
            <Image
              src="/images/whoop.svg"
              alt="Whoop"
              width={120}
              height={48}
              className="h-12 w-auto object-contain"
            />
          }
          title="Whoop"
          description="Track your recovery, sleep, and strain data from your Whoop device"
          isConnected={whoopConnected}
          isConnecting={whoopConnecting}
          isSyncing={syncing}
          onConnect={handleWhoopConnect}
          onSync={handleWhoopSync}
          onDisconnect={handleWhoopDisconnect}
          onDetails={() => {
            setSelectedIntegration('whoop');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={
            <svg className="h-8 w-8" viewBox="0 0 814 1000" fill="currentColor">
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
            </svg>
          }
          title="Apple Watch"
          description="Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics."
          comingSoon
          onDetails={() => {
            setSelectedIntegration('applewatch');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={40} height={40} className="h-10 w-10" />}
          title="Apple Screen Time"
          description="Track your digital habits by importing Screen Time data from your iPhone or iPad."
          comingSoon
          onDetails={() => {
            setSelectedIntegration('screentime');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/oura.svg" alt="Oura" width={120} height={48} className="h-12 w-auto object-contain" />}
          title="Oura Ring"
          description="Sync your sleep and readiness scores from Oura Ring"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('oura');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/fitbit.svg" alt="Fitbit" width={120} height={48} className="h-12 w-auto object-contain" />}
          title="Fitbit"
          description="Connect your Fitbit to track activity and health metrics"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('fitbit');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/garmin.svg" alt="Garmin" width={120} height={48} className="h-12 w-auto object-contain" />}
          title="Garmin"
          description="Integrate Garmin devices for comprehensive activity tracking"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('garmin');
            setDetailsOpen(true);
          }}
        />
      </div>

      {/* Side Panel for Integration Details */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="overflow-hidden [&>button]:hidden">
          {selectedIntegration === 'whoop' && (
            <>
              <SheetHeader className="px-6">
                <SheetTitle className="sr-only">Whoop Integration</SheetTitle>
                {/* Image Banner */}
                <div className="-mx-6 -mt-6 mb-6 bg-[#F5F5F5] flex items-center justify-center p-8">
                  <Image
                    src="/images/whoop_band.png"
                    alt="Whoop"
                    width={465}
                    height={290}
                    quality={100}
                    className="w-full h-auto object-contain"
                  />
                </div>
                
                {/* Header with Logo, Name, and Action Button */}
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <div className="flex items-center space-x-2">
                    <Image
                      src="/images/whoop.svg"
                      alt="Whoop"
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded"
                    />
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-lg leading-none">Whoop</h3>
                        {whoopConnected && (
                          <div className="bg-green-600 dark:bg-green-300 rounded-full size-1" />
                        )}
                      </div>
                      <span className="text-xs text-[#878787]">Health & Fitness • Published by Ritual</span>
                    </div>
                  </div>
                  <div>
                    {whoopConnected ? (
                      <button
                        onClick={handleWhoopDisconnect}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#F3F3F3] text-gray-900"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={handleWhoopConnect}
                        disabled={whoopConnecting}
                        className="px-3 py-2 text-sm bg-black text-white rounded-none hover:bg-gray-800 disabled:opacity-50"
                      >
                        {whoopConnecting ? 'Installing...' : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              </SheetHeader>
              
              {/* Scrollable Content Area */}
              <div className="mt-4 px-6">
                <ScrollArea className="h-[calc(100vh-530px)] pt-2" hideScrollbar>
                <Accordion type="multiple" defaultValue={["description", ...(whoopConnected ? ["settings"] : [])]} className="mt-4">
                  <AccordionItem value="description" className="border-none">
                    <AccordionTrigger>How it works</AccordionTrigger>
                    <AccordionContent className="text-[#878787] text-sm">
                      <p className="mb-4">
                        Automatically sync your Whoop data to track sleep, recovery, and workout metrics directly in your dashboard.
                      </p>
                      {!whoopConnected && (
                        <div className="space-y-4">
                          <div className="flex items-start">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-black text-white text-xs font-semibold mr-3 mt-0.5 flex-shrink-0">1</div>
                            <div>
                              <p className="text-sm font-medium text-foreground">Connect your Whoop account</p>
                              <p className="text-xs text-[#878787] mt-1">Securely authenticate with your Whoop credentials</p>
                            </div>
                          </div>
                          <div className="flex items-start">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-black text-white text-xs font-semibold mr-3 mt-0.5 flex-shrink-0">2</div>
                            <div>
                              <p className="text-sm font-medium text-foreground">Choose your sync schedule</p>
                              <p className="text-xs text-[#878787] mt-1">Set your preferred time for automatic daily syncing</p>
                            </div>
                          </div>
                          <div className="flex items-start">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-black text-white text-xs font-semibold mr-3 mt-0.5 flex-shrink-0">3</div>
                            <div>
                              <p className="text-sm font-medium text-foreground">Track your habits automatically</p>
                              <p className="text-xs text-[#878787] mt-1">Sleep and recovery data syncs to your dashboard daily</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {whoopConnected && (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-foreground">What gets synced:</p>
                          <div className="space-y-2">
                            <div className="flex items-start">
                              <span className="mr-2">•</span>
                              <span>Sleep duration and quality metrics</span>
                            </div>
                            <div className="flex items-start">
                              <span className="mr-2">•</span>
                              <span>Recovery scores and readiness</span>
                            </div>
                            <div className="flex items-start">
                              <span className="mr-2">•</span>
                              <span>Workout strain and intensity data</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                  
                  {whoopConnected && (
                    <AccordionItem value="settings" className="border-none">
                      <AccordionTrigger>Settings</AccordionTrigger>
                      <AccordionContent className="text-[#878787] text-sm">
                        <div className="space-y-4">
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <label className="text-sm font-medium text-foreground">Automatic sync time</label>
                              <span className="text-sm font-semibold text-foreground">{formatHour(whoopSyncHour)}</span>
                            </div>
                            <Slider
                              defaultValue={[whoopSyncHour]}
                              value={[whoopSyncHour]}
                              onValueChange={(value) => setWhoopSyncHour(value[0])}
                              min={0}
                              max={23}
                              step={1}
                              className="w-full"
                            />
                            <p className="text-xs text-[#878787] mt-2">
                              Data will automatically sync daily at {formatHour(whoopSyncHour)}
                            </p>
                          </div>
                          <button
                            onClick={() => handleWhoopSyncHourUpdate(whoopSyncHour)}
                            className="w-full px-3 py-2 text-sm bg-black text-white rounded-none hover:bg-gray-800"
                          >
                            Save Settings
                          </button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
                </ScrollArea>
                
                {/* Fixed Footer */}
                <div className="absolute bottom-4 pt-8 border-t border-border">
                  <p className="text-[10px] text-[#878787]">
                    All integrations are securely connected and your data is encrypted. Ritual maintains high standards but doesn&apos;t endorse third-party services. Report any concerns about data handling or behavior.
                  </p>
                  <a
                    href="mailto:support@ritual.com"
                    className="text-[10px] text-red-500"
                  >
                    Report integration
                  </a>
                </div>
              </div>
            </>
          )}

          {selectedIntegration === 'screentime' && (
            <>
              <SheetHeader className="sr-only">
                <SheetTitle>Apple Screen Time Integration Details</SheetTitle>
              </SheetHeader>
              
              <div className="flex items-center justify-center w-full h-56 bg-gradient-to-br from-blue-600 to-blue-800 -m-6 mb-0">
                <Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={80} height={80} className="h-20 w-20 opacity-90" />
              </div>
              
              <div className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl bg-white border border-gray-300 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={40} height={40} className="h-10 w-10" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold mb-1">Apple Screen Time</h2>
                      <p className="text-sm text-gray-500">Digital Wellness</p>
                    </div>
                  </div>
                </div>

                <p className="text-[15px] text-gray-600 leading-relaxed mb-6">
                  Track your digital habits by importing Screen Time data from your iPhone or iPad.
                </p>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-amber-600 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-900">Coming Soon</p>
                      <p className="text-sm text-amber-700 mt-1">
                        We're working on bringing Screen Time integration to help you understand your digital habits better.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-4 uppercase tracking-wide text-gray-500">What you'll be able to track</h3>
                  <div className="space-y-3">
                    <p className="text-[15px] text-gray-700 flex items-start">
                      <span className="mr-2">•</span>
                      <span>Daily screen time across all your devices</span>
                    </p>
                    <p className="text-[15px] text-gray-700 flex items-start">
                      <span className="mr-2">•</span>
                      <span>App usage breakdowns and categories</span>
                    </p>
                    <p className="text-[15px] text-gray-700 flex items-start">
                      <span className="mr-2">•</span>
                      <span>Notification and pickup statistics</span>
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedIntegration === 'applewatch' && (
            <>
              <SheetHeader className="sr-only">
                <SheetTitle>Apple Watch Integration Details</SheetTitle>
              </SheetHeader>
              
              <div className="flex items-center justify-center w-full h-56 bg-gradient-to-br from-gray-900 to-gray-700 -m-6 mb-0">
                <svg className="h-20 w-20 opacity-90" viewBox="0 0 814 1000" fill="white">
                  <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
                </svg>
              </div>
              
              <div className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl bg-white border border-gray-300 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <svg className="h-8 w-8" viewBox="0 0 814 1000" fill="currentColor">
                        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold mb-1">Apple Watch</h2>
                      <p className="text-sm text-gray-500">Health & Fitness</p>
                    </div>
                  </div>
                </div>

                <p className="text-[15px] text-gray-600 leading-relaxed mb-6">
                  Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics.
                </p>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-amber-600 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-900">Coming Soon</p>
                      <p className="text-sm text-amber-700 mt-1">
                        Apple Watch integration is under development to bring comprehensive health and fitness tracking.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-4 uppercase tracking-wide text-gray-500">What you'll be able to track</h3>
                  <div className="space-y-3">
                    <p className="text-[15px] text-gray-700 flex items-start">
                      <span className="mr-2">•</span>
                      <span>Activity rings and daily movement goals</span>
                    </p>
                    <p className="text-[15px] text-gray-700 flex items-start">
                      <span className="mr-2">•</span>
                      <span>Heart rate and cardiovascular health metrics</span>
                    </p>
                    <p className="text-[15px] text-gray-700 flex items-start">
                      <span className="mr-2">•</span>
                      <span>Workout details and fitness trends</span>
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {(selectedIntegration === 'oura' || selectedIntegration === 'fitbit' || selectedIntegration === 'garmin') && (
            <>
              <SheetHeader className="sr-only">
                <SheetTitle className="capitalize">{selectedIntegration} Integration Details</SheetTitle>
              </SheetHeader>
              
              <div className="flex items-center justify-center w-full h-56 bg-gradient-to-br from-gray-900 to-gray-700 -m-6 mb-0">
                {selectedIntegration === 'oura' && (
                  <Image src="/images/oura.svg" alt="Oura" width={200} height={80} className="h-20 w-auto object-contain opacity-90" />
                )}
                {selectedIntegration === 'fitbit' && (
                  <Image src="/images/fitbit.svg" alt="Fitbit" width={200} height={80} className="h-20 w-auto object-contain opacity-90" />
                )}
                {selectedIntegration === 'garmin' && (
                  <Image src="/images/garmin.svg" alt="Garmin" width={200} height={80} className="h-20 w-auto object-contain opacity-90" />
                )}
              </div>
              
              <div className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl bg-white border border-gray-300 flex items-center justify-center flex-shrink-0 shadow-sm">
                      {selectedIntegration === 'oura' && (
                        <Image src="/images/oura.svg" alt="Oura" width={40} height={40} className="h-8 w-auto object-contain" />
                      )}
                      {selectedIntegration === 'fitbit' && (
                        <Image src="/images/fitbit.svg" alt="Fitbit" width={40} height={40} className="h-8 w-auto object-contain" />
                      )}
                      {selectedIntegration === 'garmin' && (
                        <Image src="/images/garmin.svg" alt="Garmin" width={40} height={40} className="h-8 w-auto object-contain" />
                      )}
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold mb-1 capitalize">{selectedIntegration === 'oura' ? 'Oura Ring' : selectedIntegration}</h2>
                      <p className="text-sm text-gray-500">Health & Fitness</p>
                    </div>
                  </div>
                </div>

                <p className="text-[15px] text-gray-600 leading-relaxed mb-6">
                  {selectedIntegration === 'oura' && 'Sync your sleep and readiness scores from Oura Ring to track your recovery and health patterns.'}
                  {selectedIntegration === 'fitbit' && 'Connect your Fitbit to track activity and health metrics including steps, heart rate, and more.'}
                  {selectedIntegration === 'garmin' && 'Integrate Garmin devices for comprehensive activity tracking and performance monitoring.'}
                </p>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-amber-600 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-amber-900">Coming Soon</p>
                      <p className="text-sm text-amber-700 mt-1">
                        We're working on bringing {selectedIntegration === 'oura' ? 'Oura Ring' : selectedIntegration} integration to enhance your habit tracking experience.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

