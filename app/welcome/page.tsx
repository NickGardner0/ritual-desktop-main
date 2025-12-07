'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUser, SignIn, SignUp } from '@clerk/nextjs'
import { RitualLogo } from '@/components/ritual-logo'
import { ArrowRight } from 'lucide-react'
import { setOnboardingWindowSize } from '@/lib/tauri-utils'
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler'

const TOTAL_PAGES = 4

export default function WelcomePage() {
  const searchParams = useSearchParams()
  const pageParam = searchParams.get('page')
  const authMode = searchParams.get('mode') // 'signup' or 'signin'
  const [currentPage, setCurrentPage] = useState(pageParam ? parseInt(pageParam) : 1)
  const [showSignUp, setShowSignUp] = useState(authMode === 'signup')
  const router = useRouter()
  const { isSignedIn, isLoaded } = useUser()

  // Update showSignUp when URL changes
  useEffect(() => {
    setShowSignUp(authMode === 'signup')
  }, [authMode])

  // Set compact window size for onboarding
  useEffect(() => {
    setOnboardingWindowSize();
  }, []);

  useEffect(() => {
    // If user is already signed in and has completed full onboarding flow, go to dashboard
    if (isLoaded && isSignedIn) {
      const hasCompletedWelcomeFlow = localStorage.getItem('ritual-onboarding-completed')
      const hasCompletedBackendOnboarding = localStorage.getItem('ritual-onboarding-backend-completed')

      // If returning from backend onboarding, continue to page 4
      if (hasCompletedBackendOnboarding === 'true' && pageParam === '4') {
        // Allow them to continue the flow
        return
      }

      // If fully completed, go to dashboard
      if (hasCompletedWelcomeFlow === 'true') {
        router.replace('/dashboard')
      }
    }
  }, [isSignedIn, isLoaded, router, pageParam])

  const handleNext = () => {
    if (currentPage === TOTAL_PAGES) {
      // Mark onboarding as completed and clean up flags
      localStorage.setItem('ritual-onboarding-completed', 'true')
      localStorage.removeItem('ritual-from-welcome')
      localStorage.removeItem('ritual-onboarding-backend-completed')
      router.push('/dashboard')
      return
    }

    setCurrentPage(prev => Math.min(prev + 1, TOTAL_PAGES))
  }

  // Set flag when user reaches page 3 (auth page) so we know they're coming from welcome flow
  useEffect(() => {
    if (currentPage === 3) {
      localStorage.setItem('ritual-from-welcome', 'true')
    }
  }, [currentPage])

  const handleBack = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1))
  }

  const handleDotClick = (page: number) => {
    setCurrentPage(page)
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col relative welcome-page">
      <ClerkOAuthHandler />
      <style jsx global>{`
        /* Hide any profile components during welcome flow */
        .welcome-page [class*="user"], 
        .welcome-page [class*="profile"],
        .welcome-page [class*="avatar"] {
          display: none !important;
        }
      `}</style>

      {/* Window Drag Region - Top bar that can be dragged */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 w-full h-12 z-50"
      />

      {/* Main Content - properly centered */}
      <div className="flex-1 flex items-center justify-center">
        <div className={`w-full text-center -mt-20 ${currentPage === 2 ? 'max-w-none px-0' : 'max-w-2xl px-8'}`}>
          {/* Page 1: Welcome */}
          {currentPage === 1 && (
            <div className="animate-in fade-in duration-500">
              <div className="flex justify-center mb-4">
                <RitualLogo className="h-10 w-auto" />
              </div>
              <h1 className="text-3xl font-medium text-gray-900 dark:text-white">
                Welcome to Ritual
              </h1>
            </div>
          )}

          {/* Page 2: Why Ritual */}
          {currentPage === 2 && (
            <div className="animate-in fade-in duration-500">
              <h1 className="text-4xl font-medium text-gray-900 dark:text-white mb-6">
                Why Ritual?
              </h1>
              <div className="max-w-2xl mx-auto text-left space-y-4 text-gray-700 dark:text-gray-300">
                <p className="text-lg leading-relaxed">
                  Ritual was created to help you understand your behavior patterns and build lasting habits.
                  Unlike other habit trackers, Ritual focuses on <strong>quantification</strong> and <strong>insights</strong>.
                </p>
                <p className="text-lg leading-relaxed">
                  Track not just whether you did something, but <em>how much</em>, <em>for how long</em>,
                  and <em>what the results were</em>. See your progress over time with beautiful analytics
                  and streak tracking.
                </p>
                <p className="text-lg leading-relaxed">
                  Whether you're trying to build a morning routine, improve your fitness, or develop
                  new skills—Ritual gives you the tools to measure what matters and stay consistent.
                </p>
              </div>
            </div>
          )}

          {/* Page 3: Clerk Auth Components */}
          {currentPage === 3 && (
            <div className="animate-in fade-in duration-500">
              {showSignUp ? (
                <SignUp
                  appearance={{
                    elements: {
                      rootBox: "mx-auto",
                      card: "bg-white shadow-sm border border-gray-300",
                      formFieldLabelRow__informational: "hidden"
                    }
                  }}
                  routing="virtual"
                  signInUrl="/welcome?page=3&mode=signin"
                  afterSignUpUrl="/auth/sso-callback"
                  redirectUrl="/auth/sso-callback"
                />
              ) : (
                <SignIn
                  appearance={{
                    elements: {
                      rootBox: "mx-auto",
                      card: "bg-white shadow-sm border border-gray-300"
                    }
                  }}
                  routing="virtual"
                  signUpUrl="/welcome?page=3&mode=signup"
                  afterSignInUrl="/auth/sso-callback"
                  redirectUrl="/auth/sso-callback"
                />
              )}
            </div>
          )}

          {/* Page 4: Let's Begin */}
          {currentPage === 4 && (
            <div className="animate-in fade-in duration-500">
              <div className="flex justify-center mb-8">
                <RitualLogo className="h-10 w-auto" />
              </div>
              <h1 className="text-4xl font-medium text-gray-900 dark:text-white mb-4">
                You're all set!
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400 max-w-md mx-auto">
                Let's start building your first ritual.
              </p>
            </div>
          )}

          {/* Navigation Buttons - Only show for non-auth pages */}
          {currentPage !== 3 && (
            <div className="mt-7 flex items-center justify-center gap-4">
              <button
                onClick={handleNext}
                className="px-5 py-2 bg-black dark:bg-white text-white dark:text-black rounded-none hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                {currentPage === 1 && 'Get Started'}
                {currentPage === TOTAL_PAGES && 'Go to Dashboard'}
                {currentPage !== 1 && currentPage !== TOTAL_PAGES && 'Next'}
                {currentPage !== 1 && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Page Dots - Hidden on first and auth page for minimal look */}
          {currentPage > 1 && currentPage !== 3 && (
            <div className="mt-16 flex items-center justify-center gap-2.5">
              {Array.from({ length: TOTAL_PAGES }).map((_, index) => (
                <button
                  key={index}
                  onClick={() => handleDotClick(index + 1)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${currentPage === index + 1
                      ? 'bg-gray-900 dark:bg-white'
                      : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500'
                    }`}
                  aria-label={`Go to page ${index + 1}`}
                />
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Terms of Service - Very subtle on page 1, hidden on others */}
      {currentPage === 1 && (
        <div className="absolute bottom-8 left-0 right-0 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500 opacity-50">
            By signing in you agree to our{' '}
            <a href="/terms" className="underline hover:text-gray-600 dark:hover:text-gray-400">
              Terms of service
            </a>
            {' '}&{' '}
            <a href="/privacy" className="underline hover:text-gray-600 dark:hover:text-gray-400">
              Privacy policy
            </a>
          </p>
        </div>
      )}
    </div>
  )
}

