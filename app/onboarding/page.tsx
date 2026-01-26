"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useUser, useAuth } from "@clerk/nextjs"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { setOnboardingWindowSize } from "@/lib/tauri-utils"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CountrySelector } from "@/components/onboarding/country-selector"
import { MultiSelect } from "@/components/onboarding/multi-select"

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000'

const formSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  age_bracket: z.string({
    required_error: "Please select an age range.",
  }),
  gender: z.string({
    required_error: "Please select a gender.",
  }),
  country: z.string({
    required_error: "Please select a country.",
  }),
  tracking_interests: z.array(z.string()).min(1, {
    message: "Select at least one interest.",
  }),
  wearable_devices: z.array(z.string()).min(1, {
    message: "Select at least one device.",
  }),
})

const ageBrackets = ['12-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+']
const genderOptions = ['Male', 'Female']
const trackingInterests = ['Productivity', 'Education', 'Fitness & Health', 'Experiments', 'Other']
const wearableDevices = ['Screen Time (phone/computer)', 'Apple Watch', 'Oura Ring', 'Whoop', 'Garmin', 'Fitbit', 'None']

export default function OnboardingPage() {
  const router = useRouter()
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const [loading, setLoading] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(true)

  // Check if user has already completed onboarding
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      // Check localStorage first (fastest check)
      const hasCompletedLocally = localStorage.getItem('ritual-onboarding-completed') === 'true'
      if (hasCompletedLocally) {
        console.log('🔄 User already completed onboarding (localStorage), redirecting to dashboard')
        window.location.href = '/dashboard'
        return
      }

      // If user is loaded, check backend
      if (isLoaded && user) {
        try {
          const token = await getToken()
          if (token) {
            // Check if user has habits (indicates they're an existing user)
            const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, {
              headers: { 'Authorization': `Bearer ${token}` }
            })
            if (habitsResponse.ok) {
              const habits = await habitsResponse.json()
              if (habits && habits.length > 0) {
                console.log('🔄 User has existing habits, redirecting to dashboard')
                localStorage.setItem('ritual-onboarding-completed', 'true')
                window.location.href = '/dashboard'
                return
              }
            }

            // Check backend profile
            const response = await fetch(`${PYTHON_API_BASE}/api/user/profile`, {
              headers: { 'Authorization': `Bearer ${token}` }
            })
            if (response.ok) {
              const profile = await response.json()
              if (profile.onboarding_completed) {
                console.log('🔄 User already completed onboarding (backend), redirecting to dashboard')
                localStorage.setItem('ritual-onboarding-completed', 'true')
                window.location.href = '/dashboard'
                return
              }
            }
          }
        } catch (error) {
          console.error('Error checking onboarding status:', error)
        }
      }

      setCheckingStatus(false)
    }

    checkOnboardingStatus()
  }, [isLoaded, user, getToken])

  // Set compact window size for onboarding
  useEffect(() => {
    setOnboardingWindowSize()
  }, [])

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      tracking_interests: [],
      wearable_devices: [],
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user || loading) return

    setLoading(true)
    try {
      console.log('🔄 Submitting onboarding data:', values)

      const token = await getToken()
      if (!token) {
        throw new Error('Authentication required')
      }

      const response = await fetch(`${PYTHON_API_BASE}/api/user/onboarding`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(values)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to save onboarding data')
      }

      const userData = await response.json()
      console.log('✅ Onboarding completed successfully:', userData)

      // Always set the local onboarding completed flag
      localStorage.setItem('ritual-onboarding-completed', 'true')

      const isFromWelcome = localStorage.getItem('ritual-from-welcome')
      if (isFromWelcome === 'true') {
        localStorage.setItem('ritual-onboarding-backend-completed', 'true')
        window.location.href = '/?page=4'
      } else {
        window.location.href = '/dashboard'
      }
    } catch (error) {
      console.error('❌ Error submitting onboarding:', error)
      alert(`Error saving onboarding data: ${error instanceof Error ? error.message : String(error)}`)
      setLoading(false)
    }
  }

  // Show loading while checking onboarding status
  if (checkingStatus) {
    return (
      <div className="flex min-h-screen justify-center items-center overflow-hidden p-6 md:p-0 bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen justify-center items-center overflow-hidden p-6 md:p-0 bg-white">
      {/* Invisible drag region for window movement */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 h-12 z-50"
      />

      <div className="relative z-20 m-auto flex w-full max-w-[400px] flex-col">
        <div className="text-center">
          <h1 className="text-lg mb-2 font-medium">Welcome to Ritual</h1>
          <p className="text-gray-500 text-sm mb-8">
            Let's personalize your experience
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-gray-500 font-normal">Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your name" className="rounded-none" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="age_bracket"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-gray-500 font-normal">Age</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="rounded-none hover:bg-[#F3F3F3]">
                        <SelectValue placeholder="Select age range" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="rounded-none">
                      {ageBrackets.map((age) => (
                        <SelectItem key={age} value={age}>
                          {age}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-gray-500 font-normal">Gender</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="rounded-none hover:bg-[#F3F3F3]">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="rounded-none">
                      {genderOptions.map((gender) => (
                        <SelectItem key={gender} value={gender}>
                          {gender}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-gray-500 font-normal">Country</FormLabel>
                  <FormControl>
                    <CountrySelector
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tracking_interests"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-gray-500 font-normal">What are you interested in tracking?</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={trackingInterests}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select interests"
                      searchPlaceholder="Search interests..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="wearable_devices"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-gray-500 font-normal">Which devices do you use for self-tracking?</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={wearableDevices}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select devices"
                      searchPlaceholder="Search devices..."
                      side="top"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full mt-6 bg-black text-white hover:bg-gray-800 rounded-none"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Continue to Dashboard'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  )
}
