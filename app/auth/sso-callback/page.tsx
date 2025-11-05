'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export default function SSOCallback() {
  const router = useRouter()
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const [status, setStatus] = useState('Completing sign-in...')

  useEffect(() => {
    if (!isLoaded || !user) {
      return
    }

    const checkOnboardingAndRedirect = async () => {
      try {
        setStatus('Checking your profile...')
        
        const token = await getToken()
        if (!token) {
          router.replace('/onboarding')
          return
        }

        // Check onboarding status from backend
        const response = await fetch(`${PYTHON_API_BASE}/api/user/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })

        if (response.ok) {
          const profile = await response.json()
          
          if (profile.onboarding_completed) {
            setStatus('Welcome back! Taking you to your dashboard...')
            router.replace('/dashboard')
          } else {
            setStatus('Setting up your profile...')
            router.replace('/onboarding')
          }
        } else {
          // Profile doesn't exist yet, go to onboarding
          setStatus('Setting up your profile...')
          router.replace('/onboarding')
        }
      } catch (error) {
        console.error('Error checking onboarding:', error)
        router.replace('/onboarding')
      }
    }

    checkOnboardingAndRedirect()
  }, [isLoaded, user, getToken, router])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-gray-200 mx-auto mb-4">
          <div className="rounded-full h-12 w-12 border-2 border-transparent border-t-gray-900"></div>
        </div>
        <p className="text-sm text-gray-600">{status}</p>
      </div>
    </div>
  )
}

