/**
 * Integrations Page - Updated to use Python FastAPI Backend
 * 
 * Migration Note: No longer uses Supabase for Whoop integration
 * Now uses: Clerk (auth) + Python Backend (integration storage)
 */

"use client"

import { Button } from "@/components/ui/button"
import { Plug2, Search, CheckCircle2, Loader2 } from "lucide-react"
import { useState, useEffect, memo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from '@clerk/nextjs'
import Image from "next/image"
import { openInBrowser, isTauri } from "@/lib/tauri-utils"

// Python backend API URL
const API_BASE_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// Memoized integration card to prevent unnecessary re-renders
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
  onDisconnect 
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
}) => (
  <div className="bg-white border border-gray-200 p-5 flex flex-col h-[280px]">
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
            className="relative inline-flex h-7 w-12 items-center rounded-full bg-lime-500 transition-colors focus:outline-none focus:ring-2 focus:ring-lime-500 focus:ring-offset-2"
            role="switch"
            aria-checked="true"
          >
            <span className="inline-block h-6 w-6 transform rounded-full bg-white transition-transform translate-x-5 shadow-sm" />
          </button>
          {onSync && (
            <button 
              onClick={onSync}
              disabled={isSyncing}
              className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50 flex items-center"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                'Sync Now'
              )}
            </button>
          )}
          {onDisconnect && (
            <button 
              onClick={onDisconnect}
              className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#F3F3F3] text-gray-900"
            >
              Disconnect
            </button>
          )}
        </>
      ) : comingSoon ? (
        <>
          <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
            Details
          </button>
          <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
            Connect
          </button>
        </>
      ) : (
        <>
          <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
            Details
          </button>
          <button 
            onClick={onConnect}
            disabled={isConnecting}
            className="px-3 py-2 text-sm bg-black text-white rounded-none hover:bg-gray-800 disabled:opacity-50 flex items-center"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              'Connect'
            )}
          </button>
        </>
      )}
    </div>
  </div>
))

IntegrationCard.displayName = 'IntegrationCard'

export default function IntegrationsPage() {
  const { getToken } = useAuth()
  const [whoopConnected, setWhoopConnected] = useState(false)
  const [whoopConnecting, setWhoopConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [isCheckingConnection, setIsCheckingConnection] = useState(false)
  const [isProcessingCallback, setIsProcessingCallback] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  
  // Use ref to prevent duplicate callback processing (React Strict Mode issue)
  const callbackProcessedRef = useRef(false)
  
  // Ref to store polling interval
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // Ref to store session ID for OAuth flow
  const oauthSessionIdRef = useRef<string | null>(null)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        console.log('🧹 Cleaned up polling on unmount')
      }
    }
  }, [])

  // Check if user returned from Whoop OAuth with a code
  useEffect(() => {
    const whoopCode = searchParams.get('whoop_code')
    const whoopError = searchParams.get('whoop_error')
    
    if (whoopCode && !callbackProcessedRef.current) {
      console.log('✅ Received Whoop OAuth code, exchanging with backend...')
      callbackProcessedRef.current = true // Set immediately to prevent duplicate calls
      setIsProcessingCallback(true)
      handleWhoopCallback(whoopCode)
      return
    }
    
    if (whoopError) {
      console.error('❌ Whoop OAuth error:', whoopError)
      alert(`Whoop connection failed: ${whoopError}`)
      router.replace('/integrations')
      return
    }
    
    // Check connection status on mount (only if not processing callback)
    if (!whoopCode && !whoopError) {
      checkWhoopConnection()
    }
  }, [searchParams])

  /**
   * Handle Whoop OAuth callback - exchange code for token
   */
  async function handleWhoopCallback(code: string) {
    try {
      setWhoopConnecting(true)
      
      const token = await getToken()
      if (!token) {
        console.error('❌ No authentication token')
        setWhoopConnecting(false)
        setIsProcessingCallback(false)
        return
      }

      console.log('🔄 Exchanging Whoop code with Python backend...')
      
      // Send code to Python backend which will exchange it and save the integration
      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/callback?code=${code}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to connect Whoop: ${error}`)
      }

      const result = await response.json()
      console.log('✅ Whoop connected successfully:', result)
      
      setWhoopConnected(true)
      setWhoopConnecting(false)
      setIsProcessingCallback(false)
      
      // Clean URL
      router.replace('/integrations')
      
      // Trigger initial sync
      setTimeout(() => handleWhoopSync(), 1000)
      
    } catch (error) {
      console.error('❌ Error handling Whoop callback:', error)
      alert(`Failed to connect Whoop: ${error}`)
      setWhoopConnecting(false)
      setIsProcessingCallback(false)
      callbackProcessedRef.current = false // Reset so user can try again
      router.replace('/integrations')
    }
  }

  /**
   * Check Whoop connection status
   */
  async function checkWhoopConnection() {
    try {
      setIsCheckingConnection(true)
      
      const token = await getToken()
      if (!token) {
        setIsCheckingConnection(false)
        return
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setWhoopConnected(data.connected || false)
        console.log('✅ Whoop connection status:', data)
      }
      
    } catch (error) {
      console.error('❌ Error checking Whoop connection:', error)
    } finally {
      setIsCheckingConnection(false)
    }
  }

  /**
   * Start polling for Whoop connection status
   * This is used after opening OAuth in external browser (desktop app)
   */
  function startPollingForConnection() {
    console.log('🔄 Starting to poll for Whoop connection...')
    let pollCount = 0
    const maxPolls = 60 // Poll for up to 2 minutes (60 * 2 seconds)
    
    // Clear any existing polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }
    
    pollingIntervalRef.current = setInterval(async () => {
      pollCount++
      console.log(`🔄 Polling for connection... (${pollCount}/${maxPolls})`)
      
      try {
        const token = await getToken()
        if (!token) {
          console.log('⚠️ No auth token, stopping poll')
          stopPolling()
          return
        }

        // First, check if there's a stored OAuth code from the browser
        const sessionId = oauthSessionIdRef.current;
        if (sessionId) {
          console.log(`🔍 Checking for stored code with session ID: ${sessionId}`);
          const codeResponse = await fetch(`/api/integrations/whoop/store-code?sessionId=${sessionId}`);
          
          if (codeResponse.ok) {
            const codeData = await codeResponse.json();
            if (codeData.found && codeData.code) {
              console.log('✅ Found stored OAuth code! Exchanging with backend...');
              
              // Clear session ID so we don't try again
              oauthSessionIdRef.current = null;
              
              // Exchange the code
              await handleWhoopCallback(codeData.code);
              stopPolling();
              return;
            }
          }
        }

        // Check connection status as fallback
        const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/status`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (response.ok) {
          const data = await response.json()
          if (data.connected) {
            console.log('✅ Whoop connection detected!')
            setWhoopConnected(true)
            setWhoopConnecting(false)
            stopPolling()
            
            // Show success message
            alert('✅ Whoop connected successfully! You can now sync your health data.')
            return
          }
        }
        
        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          console.log('⏱️ Polling timeout - stopping')
          setWhoopConnecting(false)
          stopPolling()
          
          // Check one final time to see if it connected
          const finalCheck = await fetch(`${API_BASE_URL}/api/integrations/whoop/status`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
          if (finalCheck.ok) {
            const finalData = await finalCheck.json()
            if (finalData.connected) {
              setWhoopConnected(true)
              alert('✅ Whoop connected successfully! You can now sync your health data.')
            } else {
              alert('⏱️ Connection timeout. If you completed the authorization in your browser, please refresh the page.')
            }
          }
        }
        
      } catch (error) {
        console.error('❌ Error polling connection:', error)
      }
    }, 2000) // Poll every 2 seconds
  }
  
  /**
   * Stop polling for connection
   */
  function stopPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      console.log('🛑 Stopped polling for connection')
    }
  }

  /**
   * Initiate Whoop OAuth flow
   */
  async function handleWhoopConnect() {
    try {
      setWhoopConnecting(true)
      
      const clientId = process.env.NEXT_PUBLIC_WHOOP_CLIENT_ID
      const redirectUri = process.env.NEXT_PUBLIC_WHOOP_REDIRECT_URI
      
      if (!clientId || !redirectUri) {
        throw new Error('Whoop configuration missing')
      }

      // Generate a secure random state with source information
      const randomState = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      
      const isDesktopApp = isTauri()
      
      // Generate session ID for OAuth flow (desktop only)
      let sessionId = null;
      if (isDesktopApp) {
        sessionId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        oauthSessionIdRef.current = sessionId;
        console.log('🎫 Generated OAuth session ID:', sessionId);
      }
      
      // Encode source and session ID in state parameter
      const stateData = {
        random: randomState,
        source: isDesktopApp ? 'desktop' : 'web',
        ...(sessionId && { sessionId })
      }
      const state = btoa(JSON.stringify(stateData))

      // Build Whoop OAuth URL
      const authUrl = new URL('https://api.prod.whoop.com/oauth/oauth2/auth')
      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'offline read:recovery read:sleep read:workout read:cycles read:profile')
      authUrl.searchParams.set('state', state)

      console.log('🔗 Opening Whoop authorization in system browser...')
      
      // Use openInBrowser to open in system browser (Tauri-aware)
      // This will open in external browser when running as desktop app
      await openInBrowser(authUrl.toString())
      
      if (isDesktopApp) {
        // For desktop app: Start polling to detect when user completes OAuth in browser
        console.log('📱 Desktop app detected - will poll for connection')
        startPollingForConnection()
      } else {
        // For web app: Normal redirect flow (page will redirect back with code)
        // No need to poll, just keep showing connecting state
        console.log('🌐 Web app - using standard OAuth redirect flow')
      }
      
    } catch (error) {
      console.error('❌ Error connecting to Whoop:', error)
      setWhoopConnecting(false)
    }
  }

  /**
   * Sync Whoop data
   */
  async function handleWhoopSync() {
    try {
      setSyncing(true)
      
      const token = await getToken()
      if (!token) {
        console.error('❌ No authentication token')
        setSyncing(false)
        return
      }

      console.log('🔄 Starting Whoop sync...')

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Sync failed: ${error}`)
      }

      const result = await response.json()
      console.log('✅ Whoop sync successful:', result)
      
      const { recovery, sleep, workouts } = result.data || {}
      const total = (recovery || 0) + (sleep || 0) + (workouts || 0)
      
      if (total > 0) {
        alert(`Synced ${total} record(s) successfully!\n\n` +
              `- Recovery: ${recovery || 0}\n` +
              `- Sleep: ${sleep || 0}\n` +
              `- Workouts: ${workouts || 0}`)
      } else {
        alert('Sync completed! No new data found.')
      }
      
    } catch (error) {
      console.error('❌ Error syncing Whoop:', error)
      alert(`Sync failed: ${error}`)
    } finally {
      setSyncing(false)
    }
  }

  /**
   * Disconnect Whoop integration
   */
  async function handleWhoopDisconnect() {
    try {
      const token = await getToken()
      if (!token) return

      if (!confirm('Are you sure you want to disconnect Whoop?')) {
        return
      }

      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect Whoop')
      }

      setWhoopConnected(false)
      callbackProcessedRef.current = false // Reset for next connection
      console.log('✅ Whoop disconnected successfully')
      alert('Whoop disconnected successfully')
      
    } catch (error) {
      console.error('❌ Error disconnecting Whoop:', error)
      alert(`Failed to disconnect: ${error}`)
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto py-8 px-8">
        <div className="flex items-center mb-8">
          <Plug2 className="w-5 h-5 mr-2" />
          <h1 className="text-xl font-medium">Integrations</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          />

          {/* Apple integrations */}
          <IntegrationCard
            logo={<Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={40} height={40} className="h-10 w-10" />}
            title="Apple Screen Time"
            description="Track your digital habits by importing Screen Time data from your iPhone or iPad. Monitor app usage and device pickups."
            comingSoon
          />

          <IntegrationCard
            logo={
              <svg className="h-8 w-8" viewBox="0 0 814 1000" fill="currentColor">
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
              </svg>
            }
            title="Apple Watch"
            description="Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics. Track your health patterns over time."
            comingSoon
          />

          {/* Other integrations - Coming Soon */}
          <IntegrationCard
            logo={<Image src="/images/oura.svg" alt="Oura" width={120} height={48} className="h-12 w-auto object-contain" />}
            title="Oura Ring"
            description="Sync your sleep and readiness scores from Oura Ring"
            comingSoon
          />

          <IntegrationCard
            logo={<Image src="/images/fitbit.svg" alt="Fitbit" width={120} height={48} className="h-12 w-auto object-contain" />}
            title="Fitbit"
            description="Connect your Fitbit to track activity and health metrics"
            comingSoon
          />

          <IntegrationCard
            logo={<Image src="/images/garmin.svg" alt="Garmin" width={120} height={48} className="h-12 w-auto object-contain" />}
            title="Garmin"
            description="Integrate Garmin devices for comprehensive activity tracking"
            comingSoon
          />
        </div>
      </div>
    </div>
  )
}

