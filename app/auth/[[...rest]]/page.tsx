'use client'

import { useState, FormEvent } from 'react'
import { useSignIn, useSignUp } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler'
import { Zap, Loader2 } from 'lucide-react'
import Image from 'next/image'

export default function AuthPage() {
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn()
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

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
    <div className="min-h-screen bg-[#f5f5f5] flex">
      <ClerkOAuthHandler />
      
      {/* Window Drag Region */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 w-full h-16 z-50 pointer-events-none"
      />

      {/* Left Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 bg-white">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-12">
            <Zap className="w-8 h-8 text-black" />
          </div>

          {/* Header */}
          <div className="mb-10">
            <h1 className="text-[40px] font-normal text-gray-900 mb-2 leading-tight">
              Welcome back!
            </h1>
            <p className="text-sm text-gray-500">
              Your work, your team, your flow — all in one place.
            </p>
          </div>

          {/* OAuth Buttons - Side by Side */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white"
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
              <span className="text-[13px] font-medium text-gray-700">
                Sign in with Google
              </span>
            </button>

            <button
              onClick={handleAppleSignIn}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              <span className="text-[13px] font-medium text-gray-700">
                Sign in with Apple
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-[13px]">
              <span className="px-3 bg-white text-gray-400">Or</span>
            </div>
          </div>

          {/* Email Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent text-[14px] bg-[#fafafa]"
              />
            </div>

            {isSignUp && (
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent text-[14px] bg-[#fafafa]"
                />
              </div>
            )}

            {error && (
              <div className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white py-3 px-4 rounded-full hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-[14px] font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isSignUp ? 'Creating account...' : 'Signing in...'}
                </>
              ) : (
                <>{isSignUp ? 'Sign up with email' : 'Sign in with email'}</>
              )}
            </button>
          </form>

          {/* Toggle Sign Up/Sign In */}
          <div className="mt-6 text-center text-[13px] text-gray-500">
            {isSignUp ? (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => {
                    setIsSignUp(false)
                    setError('')
                  }}
                  className="text-gray-900 font-medium hover:underline"
                >
                  Sign In
                </button>
              </>
            ) : (
              <>
                Don't have an account?{' '}
                <button
                  onClick={() => {
                    setIsSignUp(true)
                    setError('')
                  }}
                  className="text-gray-900 font-medium hover:underline"
                >
                  Sign Up
                </button>
              </>
            )}
          </div>

          {/* Footer Links */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-8 text-[12px] text-gray-400">
            <a href="#" className="hover:text-gray-600 transition-colors">
              Help
            </a>
            <a href="#" className="hover:text-gray-600 transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-gray-600 transition-colors">
              Privacy
            </a>
          </div>
        </div>
      </div>

      {/* Right Panel - Decorative Image */}
      <div className="hidden lg:block lg:flex-1 bg-[#e5e5e5] relative overflow-hidden">
        {/* Placeholder for your image - add your actual image here */}
        {/* <Image 
          src="/images/auth-background.jpg" 
          alt="Background" 
          fill 
          className="object-cover"
          style={{ filter: 'contrast(1.1) brightness(0.95)' }}
        /> */}
        
        {/* Halftone/Dithered pattern overlay effect */}
        <div className="absolute inset-0 opacity-40" 
          style={{
            backgroundImage: `
              radial-gradient(circle, black 1px, transparent 1px)
            `,
            backgroundSize: '4px 4px'
          }}
        />
        
        {/* Additional texture */}
        <div className="absolute inset-0 mix-blend-multiply opacity-20"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}
        />
      </div>
    </div>
  )
}
