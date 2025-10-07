"use client"

import { Button } from "@/components/ui/button"
import { Plug2, Search, CheckCircle2, Loader2 } from "lucide-react"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter, useSearchParams } from "next/navigation"

export default function IntegrationsPage() {
  // Use cached value from sessionStorage for instant initial render
  const [whoopConnected, setWhoopConnected] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem('whoop_connected')
      return cached === 'true'
    }
    return false
  })
  const [whoopConnecting, setWhoopConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Check connection status in background after render
    const checkConnection = async () => {
      await checkWhoopConnection()
    }
    
    // Defer the connection check to not block initial render
    const timeoutId = setTimeout(checkConnection, 0)
    
    // Check for success/error messages from OAuth callback
    const connected = searchParams.get('connected')
    const error = searchParams.get('error')
    
    if (connected === 'whoop') {
      setWhoopConnected(true)
      sessionStorage.setItem('whoop_connected', 'true')
      
      // Check if user came from modal
      const returnToModal = sessionStorage.getItem('whoop_return_to_modal')
      
      if (returnToModal === 'true') {
        // Clear the flag
        sessionStorage.removeItem('whoop_return_to_modal')
        // Redirect to dashboard with modal trigger
        router.replace('/dashboard?open_whoop_modal=true')
        return
      }
      
      // Otherwise, trigger initial sync and stay on integrations page
      handleWhoopSync()
      router.replace('/integrations')
    }
    
    if (error) {
      console.error('Integration error:', error)
      // Clean URL
      router.replace('/integrations')
    }
    
    return () => clearTimeout(timeoutId)
  }, [searchParams])

  async function checkWhoopConnection() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) return

      const { data, error } = await supabase
        .from('whoop_connections')
        .select('is_active')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .single()

      const isConnected = !!(data && !error)
      setWhoopConnected(isConnected)
      
      // Cache the result for instant future loads
      sessionStorage.setItem('whoop_connected', isConnected.toString())
    } catch (error) {
      console.error('Error checking Whoop connection:', error)
      setWhoopConnected(false)
      sessionStorage.setItem('whoop_connected', 'false')
    }
  }

  async function handleWhoopConnect() {
    try {
      setWhoopConnecting(true)
      
      // Get current user session
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) {
        console.error('No active session')
        setWhoopConnecting(false)
        return
      }
      
      // Get the authorization URL from our API with user ID
      const response = await fetch(`/api/integrations/whoop/auth?userId=${session.user.id}`)
      const data = await response.json()
      
      if (data.authUrl) {
        console.log('🔗 Redirecting to Whoop authorization...')
        // Redirect to Whoop authorization page
        window.location.href = data.authUrl
      }
    } catch (error) {
      console.error('Error connecting to Whoop:', error)
      setWhoopConnecting(false)
    }
  }

  async function handleWhoopSync() {
    try {
      setSyncing(true)
      
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) {
        console.error('❌ No user session found')
        setSyncing(false)
        return
      }

      console.log('🔄 Starting Whoop sync for user:', session.user.id)

      const response = await fetch('/api/integrations/whoop/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.user.id }),
      })

      const result = await response.json()
      
      if (result.success) {
        console.log('✅ Whoop sync successful:', result)
        console.log(`📊 Synced: ${result.counts.sleep} sleep records`)
        
        // Show success message to user
        alert(`Synced ${result.counts.sleep} sleep record(s) successfully! Go to your dashboard to see your sleep data.`)
        
        // Redirect to dashboard
        router.push('/dashboard')
      } else {
        console.error('❌ Sync failed:', result.error)
        alert(`Sync failed: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('❌ Error syncing Whoop data:', error)
      alert('Error syncing Whoop data. Check console for details.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleWhoopDisconnect() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) return

      const { error } = await supabase
        .from('whoop_connections')
        .update({ is_active: false })
        .eq('user_id', session.user.id)

      if (error) {
        console.error('Error disconnecting Whoop:', error)
        return
      }

      setWhoopConnected(false)
      // Clear the cache
      sessionStorage.setItem('whoop_connected', 'false')
      console.log('✅ Whoop disconnected successfully')
    } catch (error) {
      console.error('Error disconnecting Whoop:', error)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1.5">Integrations</h1>
        <p className="text-gray-600 text-sm">Connect and integrate your data with self-tracking tools</p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button className="px-4 py-2 text-sm font-medium bg-white rounded-none hover:bg-gray-50 border border-gray-300">
          All
        </button>
        <button className="px-4 py-2 text-sm font-medium text-gray-600 rounded-none hover:bg-gray-50">
          Connected
        </button>
        <div className="relative flex-1 max-w-md ml-auto">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search apps" 
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
      </div>

      {/* Integration apps grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {/* Apple Screen Time */}
        <div className="bg-white border border-gray-200 p-5 flex flex-col h-[280px]">
          <div className="mb-4">
            <img src="/images/Screen_Time.svg" alt="Apple Screen Time" className="h-8 w-8" />
          </div>
          <div className="flex items-center mb-2">
            <h3 className="text-base font-medium">Apple Screen Time</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-5 flex-grow">
            Track your digital habits by importing Screen Time data from your iPhone or iPad. Monitor app usage, notifications, and device pickups to understand your digital consumption patterns.
          </p>
          <div className="flex gap-2 mt-auto">
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Apple Watch */}
        <div className="bg-white border border-gray-200 p-5 flex flex-col h-[280px]">
          <div className="mb-4">
            <svg className="h-8 w-8" viewBox="0 0 814 1000" fill="currentColor">
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
            </svg>
          </div>
          <div className="flex items-center mb-2">
            <h3 className="text-base font-medium">Apple Watch</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-5 flex-grow">
            Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics. Track your health patterns over time to optimize your well-being and fitness routines.
          </p>
          <div className="flex gap-2 mt-auto">
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Oura Ring */}
        <div className="bg-white border border-gray-200 p-5 flex flex-col h-[280px]">
          <div className="mb-4">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Oura_Health_logo.svg/2560px-Oura_Health_logo.svg.png" alt="Oura Ring" className="h-8" />
          </div>
          <div className="flex items-center mb-2">
            <h3 className="text-base font-medium">Oura Ring</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-5 flex-grow">
            Import your Oura Ring data to analyze sleep quality, readiness scores, and activity metrics. Get comprehensive insights about your recovery patterns and overall health trends.
          </p>
          <div className="flex gap-2 mt-auto">
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Whoop */}
        <div className="bg-white border border-gray-200 p-5 flex flex-col h-[280px]">
          <div className="mb-4">
            <img src="/images/whoop.svg" alt="Whoop" className="h-8" />
          </div>
          <div className="flex items-center mb-2">
            <h3 className="text-base font-medium">Whoop</h3>
          </div>
          <p className="text-gray-600 text-sm mb-5 flex-grow">
            Connect your Whoop data to track recovery, strain, and sleep performance. Gain insights into how your daily activities impact your body's recovery and optimize your training schedule.
          </p>
          <div className="flex gap-2 mt-auto">
            {whoopConnected ? (
              <>
                <button className="px-3 py-2 text-sm bg-lime-500 text-white rounded-none hover:bg-lime-600">
                  Connected
                </button>
                <button 
                  onClick={handleWhoopSync}
                  disabled={syncing}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50 flex items-center"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    'Sync Now'
                  )}
                </button>
                <button 
                  onClick={handleWhoopDisconnect}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#F3F3F3] text-gray-900"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button 
                onClick={handleWhoopConnect}
                disabled={whoopConnecting}
                className="px-3 py-2 text-sm bg-black text-white rounded-none hover:bg-gray-800 disabled:opacity-50 flex items-center"
              >
                {whoopConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Fitbit */}
        <div className="bg-white border border-gray-200 p-5 flex flex-col h-[280px]">
          <div className="mb-4">
            <img src="https://1000logos.net/wp-content/uploads/2021/05/Fitbit-logo.png" alt="Fitbit" className="h-8" />
          </div>
          <div className="flex items-center mb-2">
            <h3 className="text-base font-medium">Fitbit</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-5 flex-grow">
            Integrate your Fitbit device data to track steps, heart rate, sleep, and exercise. Monitor your fitness progress over time and identify patterns in your daily activity levels.
          </p>
          <div className="flex gap-2 mt-auto">
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Garmin */}
        <div className="bg-white border border-gray-200 p-5 flex flex-col h-[280px]">
          <div className="mb-4">
            <img src="https://logos-world.net/wp-content/uploads/2021/08/Garmin-Logo.png" alt="Garmin" className="h-8" />
          </div>
          <div className="flex items-center mb-2">
            <h3 className="text-base font-medium">Garmin</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-5 flex-grow">
            Sync your Garmin device data to analyze running, cycling, swimming and other activities. Track performance metrics, training load, and recovery to optimize your athletic performance.
          </p>
          <div className="flex gap-2 mt-auto">
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-3 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  )
} 