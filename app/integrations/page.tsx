"use client"

import { Button } from "@/components/ui/button"
import { Plug2, Search } from "lucide-react"

export default function IntegrationsPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold mb-2">Integrations</h1>
        <p className="text-gray-600">Connect and integrate your data with self-tracking tools</p>
      </div>

      <div className="flex items-center gap-4 mb-8">
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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-8">
        {/* Apple Screen Time */}
        <div className="bg-white border border-gray-300 hover:border-gray-400 p-6 flex flex-col">
          <div className="mb-4">
            <img src="https://developer.apple.com/design/human-interface-guidelines/foundations/app-icons/images/app-icon-familiar-look.png" alt="Apple Screen Time" className="h-8 w-8" />
          </div>
          <div className="flex items-center mb-1">
            <h3 className="text-lg font-medium">Apple Screen Time</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-6 flex-grow">
            Track your digital habits by importing Screen Time data from your iPhone or iPad. Monitor app usage, notifications, and device pickups to understand your digital consumption patterns.
          </p>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Apple Watch */}
        <div className="bg-white border border-gray-300 hover:border-gray-400 p-6 flex flex-col">
          <div className="mb-4">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Apple_logo_black.svg/1667px-Apple_logo_black.svg.png" alt="Apple Watch" className="h-8 w-8" />
          </div>
          <div className="flex items-center mb-1">
            <h3 className="text-lg font-medium">Apple Watch</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-6 flex-grow">
            Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics. Track your health patterns over time to optimize your well-being and fitness routines.
          </p>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Oura Ring */}
        <div className="bg-white border border-gray-300 hover:border-gray-400 p-6 flex flex-col">
          <div className="mb-4">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Oura_Health_logo.svg/2560px-Oura_Health_logo.svg.png" alt="Oura Ring" className="h-8" />
          </div>
          <div className="flex items-center mb-1">
            <h3 className="text-lg font-medium">Oura Ring</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-6 flex-grow">
            Import your Oura Ring data to analyze sleep quality, readiness scores, and activity metrics. Get comprehensive insights about your recovery patterns and overall health trends.
          </p>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Whoop */}
        <div className="bg-white border border-gray-300 hover:border-gray-400 p-6 flex flex-col">
          <div className="mb-4">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/3b/Whoop_logo.png" alt="Whoop" className="h-8" />
          </div>
          <div className="flex items-center mb-1">
            <h3 className="text-lg font-medium">Whoop</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-6 flex-grow">
            Connect your Whoop data to track recovery, strain, and sleep performance. Gain insights into how your daily activities impact your body's recovery and optimize your training schedule.
          </p>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Fitbit */}
        <div className="bg-white border border-gray-300 hover:border-gray-400 p-6 flex flex-col">
          <div className="mb-4">
            <img src="https://1000logos.net/wp-content/uploads/2021/05/Fitbit-logo.png" alt="Fitbit" className="h-8" />
          </div>
          <div className="flex items-center mb-1">
            <h3 className="text-lg font-medium">Fitbit</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-6 flex-grow">
            Integrate your Fitbit device data to track steps, heart rate, sleep, and exercise. Monitor your fitness progress over time and identify patterns in your daily activity levels.
          </p>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>

        {/* Garmin */}
        <div className="bg-white border border-gray-300 hover:border-gray-400 p-6 flex flex-col">
          <div className="mb-4">
            <img src="https://logos-world.net/wp-content/uploads/2021/08/Garmin-Logo.png" alt="Garmin" className="h-8" />
          </div>
          <div className="flex items-center mb-1">
            <h3 className="text-lg font-medium">Garmin</h3>
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Coming soon</span>
          </div>
          <p className="text-gray-600 text-sm mb-6 flex-grow">
            Sync your Garmin device data to analyze running, cycling, swimming and other activities. Track performance metrics, training load, and recovery to optimize your athletic performance.
          </p>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Details
            </button>
            <button className="px-4 py-2 text-sm border border-gray-300 rounded-none hover:bg-[#EBEAE8]">
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  )
} 