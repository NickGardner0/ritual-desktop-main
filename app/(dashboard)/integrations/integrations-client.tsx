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

import { useState, useEffect, memo, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { Loader, Power, Monitor, ChevronLeft } from 'lucide-react';
import { openInBrowser, isTauri } from '@/lib/tauri-utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Slider } from '@/components/ui/slider';
import { useHabits } from '@/contexts/HabitsContext';
import { ComputerTrackingSettings } from '@/components/computer-tracking-settings';

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

/**
 * Fetch Apple Watch/Health connection status with React Query
 * Checks for registered devices from the iOS companion app
 */
function useAppleWatchStatus() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['apple-watch-status', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/wearables/apple/devices`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Apple Watch status');
      }

      const data = await response.json();
      // Check if there's at least one active iOS device
      const activeDevices = (data.devices || []).filter((d: any) => d.is_active && d.platform === 'ios');
      return {
        connected: activeDevices.length > 0,
        devices: activeDevices,
        lastSyncAt: activeDevices[0]?.last_sync_at || null,
        deviceName: activeDevices[0]?.device_name || null,
      };
    },
    staleTime: 1000 * 60 * 2, // Cache for 2 minutes
    enabled: !!user?.id,
  });
}

/**
 * Fetch Computer Tracking status with React Query
 * Checks for registered watcher devices (macOS desktop)
 */
function useComputerTrackingStatus() {
  const { user } = useUser();

  return useQuery({
    queryKey: ['computer-tracking-status', user?.id],
    queryFn: async () => {
      try {
        const response = await fetch('/api/watcher/devices');
        
        if (!response.ok) {
          return { connected: false, enabled: false, deviceName: null };
        }

        const data = await response.json();
        const devices = data.devices || [];
        const activeDevice = devices.find((d: any) => d.is_enabled);
        
        return {
          connected: devices.length > 0,
          enabled: !!activeDevice,
          deviceName: activeDevice?.device_name || devices[0]?.device_name || 'My Mac',
          deviceId: activeDevice?.device_id || devices[0]?.device_id || null,
        };
      } catch {
        return { connected: false, enabled: false, deviceName: null, deviceId: null };
      }
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
                  <Loader className="w-4 h-4 mr-2 animate-spin inline-block" />
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
                <Loader className="w-4 h-4 mr-2 animate-spin inline-block" />
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
  const { user } = useUser();
  const { fetchHabits, fetchHabitLogs } = useHabits();
  const { data: whoopStatusData, isLoading, refetch: refetchWhoopStatus } = useWhoopStatus();
  const { data: appleWatchStatusData, isLoading: isLoadingAppleWatch, refetch: refetchAppleWatchStatus } = useAppleWatchStatus();
  const { data: computerTrackingStatus, isLoading: isLoadingComputerTracking, refetch: refetchComputerTracking } = useComputerTrackingStatus();
  const [whoopConnected, setWhoopConnected] = useState(false);
  const [whoopSyncHour, setWhoopSyncHour] = useState(9); // Default to 9 AM
  const [whoopConnecting, setWhoopConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [appleWatchSyncing, setAppleWatchSyncing] = useState(false);
  const [isProcessingCallback, setIsProcessingCallback] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const [showComputerTrackingSettings, setShowComputerTrackingSettings] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Apple Watch connection state
  const appleWatchConnected = appleWatchStatusData?.connected || false;
  const appleWatchDeviceName = appleWatchStatusData?.deviceName || 'Apple Watch';
  const appleWatchLastSync = appleWatchStatusData?.lastSyncAt;

  // Computer Tracking connection state
  const computerTrackingConnected = computerTrackingStatus?.connected || false;
  const computerTrackingEnabled = computerTrackingStatus?.enabled || false;
  const computerTrackingDeviceName = computerTrackingStatus?.deviceName || 'My Mac';

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

      // Refresh habits and logs to reflect new data
      await Promise.all([
        fetchHabits(),
        fetchHabitLogs()
      ]);

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

  // ================================
  // APPLE WATCH HANDLERS
  // ================================

  async function handleAppleWatchDisconnect() {
    try {
      const token = await getToken();
      if (!token) return;

      if (!confirm('Are you sure you want to disconnect Apple Watch? You can reconnect using the Ritual iOS companion app.')) {
        return;
      }

      // Get the device ID to deactivate
      const devices = appleWatchStatusData?.devices || [];
      if (devices.length === 0) {
        alert('No Apple Watch device found');
        return;
      }

      // Deactivate all connected devices
      for (const device of devices) {
        const response = await fetch(`${API_BASE_URL}/api/wearables/apple/devices/${device.device_id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to disconnect device');
        }
      }

      refetchAppleWatchStatus(); // Update cache
      alert('Apple Watch disconnected successfully. You can reconnect using the Ritual iOS companion app.');
    } catch (error) {
      console.error('❌ Error disconnecting Apple Watch:', error);
      alert(`Failed to disconnect: ${error}`);
    }
  }

  function handleAppleWatchConnect() {
    // Show instructions for connecting via iOS companion app
    alert(
      '📱 To connect your Apple Watch:\n\n' +
      '1. Download the Ritual Companion app on your iPhone\n' +
      '2. Sign in with your Ritual account\n' +
      '3. Tap "Connect" to register your device\n' +
      '4. Grant HealthKit permissions\n' +
      '5. Tap "Sync Now" to sync your data\n\n' +
      'Your Apple Watch data will be synced through your iPhone.'
    );
  }

  // Show loading skeleton on first fetch only
  const shimmerClass = "animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200";

  if ((isLoading && whoopStatusData === undefined) || (isLoadingAppleWatch && appleWatchStatusData === undefined) || (isLoadingComputerTracking && computerTrackingStatus === undefined)) {
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
        {/* Computer Tracking Card - Only show on desktop (Tauri) */}
        {isTauri() && (
          <IntegrationCard
            logo={<Monitor className="h-10 w-10 text-gray-900" />}
            title="Computer Tracking"
            description={computerTrackingEnabled 
              ? `Tracking active on ${computerTrackingDeviceName}. Monitor app usage, browser activity, and screen time.`
              : "Track your computer usage including apps, websites, and active time automatically."
            }
            isConnected={computerTrackingEnabled}
            onConnect={() => setShowComputerTrackingSettings(true)}
            onDisconnect={() => setShowComputerTrackingSettings(true)}
            onDetails={() => setShowComputerTrackingSettings(true)}
          />
        )}

        {/* Whoop Card */}
        <IntegrationCard
          logo={
            <Image
              src="/images/whoop.svg"
              alt="Whoop"
              width={80}
              height={32}
              className="h-8 w-auto object-contain"
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
          description={appleWatchConnected 
            ? `Connected via ${appleWatchDeviceName}. Sync data from your iPhone's Ritual Companion app.`
            : "Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics."
          }
          isConnected={appleWatchConnected}
          onConnect={handleAppleWatchConnect}
          onDisconnect={handleAppleWatchDisconnect}
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
          logo={<Image src="/images/oura.svg" alt="Oura" width={56} height={56} className="h-14 w-auto object-contain" />}
          title="Oura Ring"
          description="Sync your sleep and readiness scores from Oura Ring"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('oura');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/fitbit.svg" alt="Fitbit" width={80} height={32} className="h-8 w-auto object-contain" />}
          title="Fitbit"
          description="Connect your Fitbit to track activity and health metrics"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('fitbit');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/garmin.svg" alt="Garmin" width={80} height={32} className="h-8 w-auto object-contain" />}
          title="Garmin"
          description="Integrate Garmin devices for comprehensive activity tracking"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('garmin');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/cal_ai.svg" alt="Cal AI" width={120} height={48} className="h-12 w-auto object-contain" />}
          title="Cal AI"
          description="Track your nutrition and calories with AI-powered food recognition"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('calai');
            setDetailsOpen(true);
          }}
        />

        <IntegrationCard
          logo={<Image src="/images/Google_Calendar_Logo.svg" alt="Google Calendar" width={32} height={32} className="h-8 w-8" />}
          title="Google Calendar"
          description="Track meeting time, frequency, and patterns by syncing your Google Calendar events"
          comingSoon
          onDetails={() => {
            setSelectedIntegration('googlecalendar');
            setDetailsOpen(true);
          }}
        />
      </div>

      {/* Side Panel for Integration Details */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="overflow-hidden [&>button]:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Integration Details</SheetTitle>
          </SheetHeader>
          {/* Empty for now */}
        </SheetContent>
      </Sheet>

      {/* Computer Tracking Settings Sheet */}
      <Sheet open={showComputerTrackingSettings} onOpenChange={setShowComputerTrackingSettings}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-hidden">
          <SheetHeader className="flex flex-row items-center gap-3 pb-4 border-b border-gray-200">
            <button 
              onClick={() => setShowComputerTrackingSettings(false)}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <SheetTitle className="text-base font-medium">Computer Tracking</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] pr-4">
            <div className="py-4">
              {user?.id && (
                <ComputerTrackingSettings 
                  userId={user.id} 
                  onClose={() => {
                    setShowComputerTrackingSettings(false);
                    refetchComputerTracking();
                  }} 
                />
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

