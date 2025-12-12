'use client'

import { useState, FormEvent, useEffect } from 'react'
import { useSignIn, useSignUp, useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler'
import { Loader } from 'lucide-react'
import { RitualLogo } from '@/components/ritual-logo'
import { setOnboardingWindowSize } from '@/lib/tauri-utils'

export default function AuthPage() {
  const { isSignedIn, isLoaded: userLoaded } = useUser()
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn()
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  // Set compact window size for auth
  useEffect(() => {
    setOnboardingWindowSize();
  }, []);

  // Redirect if already signed in
  useEffect(() => {
    if (userLoaded && isSignedIn) {
      console.log('👤 User already signed in...')
      // Check if coming from welcome flow
      const isFromWelcome = localStorage.getItem('ritual-from-welcome')
      if (isFromWelcome === 'true') {
        localStorage.removeItem('ritual-from-welcome')
        router.replace('/onboarding')
      } else {
        router.replace('/dashboard')
      }
    }
  }, [isSignedIn, userLoaded, router])

  // Show loading while checking auth state
  if (!userLoaded) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-gray-900" />
      </div>
    )
  }

  // Don't render auth form if user is signed in (will redirect)
  if (isSignedIn) {
    return null
  }

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault()
    if (!signInLoaded || !signUpLoaded) return
    
    setLoading(true)
    setError('')

    try {
      if (isSignUp) {
        // Sign up flow
        const result = await signUp.create({
          emailAddress: email,
          password,
        })

        if (result.status === 'complete') {
          await setActiveSignUp({ session: result.createdSessionId })
          router.push('/onboarding')
        } else {
          // Handle email verification if needed
          console.log('Sign up status:', result.status)
        }
      } else {
        // Sign in flow
        const result = await signIn.create({
          identifier: email,
          password,
        })

        if (result.status === 'complete') {
          await setActiveSignIn({ session: result.createdSessionId })
          router.push('/dashboard')
        }
      }
    } catch (err: any) {
      console.error('Auth error:', err)
      setError(err.errors?.[0]?.message || 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    if (!signInLoaded) return
    
    setLoading(true)
    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/auth/sso-callback',
        redirectUrlComplete: '/auth/sso-callback',
      })
    } catch (err: any) {
      console.error('Google sign in error:', err)
      setError(err.errors?.[0]?.message || 'Failed to sign in with Google')
      setLoading(false)
    }
  }

  const handleAppleSignIn = async () => {
    if (!signInLoaded) return
    
    setLoading(true)
    try {
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_apple',
        redirectUrl: '/auth/sso-callback',
        redirectUrlComplete: '/auth/sso-callback',
      })
    } catch (err: any) {
      console.error('Apple sign in error:', err)
      setError(err.errors?.[0]?.message || 'Failed to sign in with Apple')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <ClerkOAuthHandler />
      
      {/* Window Drag Region */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 w-full h-16 z-50 pointer-events-none"
      />

      {/* Centered Auth Card */}
      <div className="w-full max-w-md bg-white rounded-none shadow-sm border border-gray-300 p-6">
        {/* Logo */}
        <div className="flex justify-center mb-4">
          <RitualLogo className="h-14 w-auto" />
        </div>

        {/* Header */}
        <h1 className="text-xl text-gray-900 text-center mb-5">
          {isSignUp ? 'Create your account' : 'Log in to Ritual'}
        </h1>

        {/* OAuth Buttons - Stacked */}
        <div className="space-y-2 mb-4">
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white text-sm text-gray-700"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          <button
            onClick={handleAppleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-none hover:bg-[#F3F3F3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white text-sm text-gray-700"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            Continue with Apple
          </button>
        </div>

        {/* Divider */}
        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2 bg-white text-gray-400 uppercase">Or</span>
          </div>
        </div>

        {/* Email Form */}
        <form onSubmit={handleEmailAuth} className="space-y-3">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1.5 uppercase tracking-wide">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-700 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent text-sm"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-none px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-2 px-4 rounded-none hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm font-medium uppercase tracking-wide"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                {isSignUp ? 'Creating account...' : 'Logging in...'}
              </>
            ) : (
              <>{isSignUp ? 'Sign Up' : 'Login'}</>
            )}
          </button>
        </form>

        {/* Forgot Password */}
        {!isSignUp && (
          <div className="mt-2.5 text-center">
            <button
              onClick={() => {
                // TODO: Implement forgot password flow
                console.log('Forgot password clicked')
              }}
              className="text-sm text-gray-600 hover:underline"
            >
              Forgot Password?
            </button>
          </div>
        )}

        {/* Toggle Sign Up/Sign In */}
        <div className="mt-5 text-center text-sm text-gray-600">
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <button
                onClick={() => {
                  setIsSignUp(false)
                  setError('')
                  setPassword('')
                }}
                className="text-gray-900 font-medium hover:underline"
              >
                Log in
              </button>
            </>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <button
                onClick={() => {
                  setIsSignUp(true)
                  setError('')
                  setPassword('')
                }}
                className="text-gray-900 font-medium hover:underline"
              >
                Sign up
              </button>
            </>
          )}
        </div>

        {/* Footer Links */}
        <div className="mt-5 pt-4 border-t border-gray-200 text-center text-xs text-gray-400">
          <span>
            You acknowledge that you read, and agree to our{' '}
            <a href="#" className="text-gray-600 hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="text-gray-600 hover:underline">
              Privacy Policy
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}
