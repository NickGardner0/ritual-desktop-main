'use client';

import React, { createContext, useContext, useEffect, useState } from 'react'
import { User, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { clearUserCache } from '@/lib/auth-utils'

type AuthContextType = {
  user: User | null
  loading: boolean
  signInWithGoogle: () => Promise<{ error: AuthError | null }>
  signInWithApple: () => Promise<{ error: AuthError | null }>
  signInWithX: () => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

// Helper function to fetch Google user info
const fetchGoogleUserInfo = async (accessToken: string) => {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.status}`)
    }
    
    return await response.json()
  } catch (error) {
    console.error('Error fetching Google user info:', error)
    throw error
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true) // Keep original loading behavior for auth checks
  
  // Debug logging for state changes
  useEffect(() => {
    console.log('🔐 AuthContext state - user:', user?.email || 'null', 'loading:', loading)
  }, [user, loading])

  // Set up persistent Tauri event listeners
  useEffect(() => {
    const setupTauriListeners = async () => {
      const isTauri = typeof window !== 'undefined' && '__TAURI__' in window
      if (!isTauri) return

      console.log('🔐 Setting up persistent Tauri event listeners...')
      
      try {
        // Listen for auth success events
        const unlistenSuccess = await listen('auth:success', async (event) => {
          console.log('🔐 Received auth:success event:', event.payload)
          console.log('🔐 Event type:', typeof event.payload)
          console.log('🔐 Event keys:', Object.keys(event.payload || {}))
          const tokenData = event.payload as any
          
          if (tokenData.error) {
            console.error('❌ OAuth failed:', tokenData.error, tokenData.error_description)
            return
          }
          
          // Handle authorization code (authorization code flow)
          if (tokenData.code) {
            try {
              console.log('🔐 Exchanging authorization code for session...')
              const { data, error } = await supabase.auth.exchangeCodeForSession(tokenData.code as string)
              if (error) {
                console.error('❌ exchangeCodeForSession error:', error)
              } else {
                console.log('✅ Session established from code!')
                setUser(data.session?.user ?? null)
              }
            } catch (err) {
              console.error('❌ Error exchanging code for session:', err)
            } finally {
              console.log('🔄 Navigating to dashboard after code exchange...')
              if (typeof window !== 'undefined') {
                window.location.href = '/dashboard'
              }
            }
            return
          }

          // Handle direct access tokens
          if (tokenData.access_token) {
            console.log('✅ OAuth successful! Processing tokens...')
            console.log('🔐 Access token length:', tokenData.access_token.length)
            console.log('🔐 Refresh token present:', !!tokenData.refresh_token)
            
            // Store tokens
            localStorage.setItem('google_access_token', tokenData.access_token)
            if (tokenData.refresh_token) {
              localStorage.setItem('google_refresh_token', tokenData.refresh_token)
            }
            
            // Try to create Supabase session directly with the received token
            supabase.auth.setSession({
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token || ''
            }).then(({ data, error }) => {
              if (error) {
                console.error('❌ Error setting Supabase session:', error)
                // Fallback: get user info from Google API
                return fetchGoogleUserInfo(tokenData.access_token).then((userInfo) => {
                  console.log('🔐 Using Google user info as fallback:', userInfo)
                  setUser({
                    id: userInfo.id || 'google-user',
                    email: userInfo.email || 'user@gmail.com',
                    user_metadata: { 
                      name: userInfo.name || 'Google User',
                      picture: userInfo.picture 
                    }
                  } as any)
                  localStorage.setItem('google_user_info', JSON.stringify(userInfo))
                })
              } else {
                console.log('✅ Supabase session set successfully!')
                console.log('🔐 User email:', data.session?.user?.email)
                setUser(data.session?.user ?? null)
              }
            }).then(() => {
              // Navigate to dashboard after processing
              console.log('🔄 Navigating to dashboard...')
              if (typeof window !== 'undefined') {
                window.location.href = '/dashboard'
              }
            }).catch((err) => {
              console.error('❌ Error in token processing:', err)
            })
          }
        })
        
        // Listen for auth errors
        const unlistenError = await listen('auth:error', (event) => {
          console.error('❌ OAuth error:', event.payload)
        })
        
        console.log('🔐 Persistent Tauri event listeners set up successfully')
        
        // Cleanup on unmount
        return () => {
          unlistenSuccess()
          unlistenError()
        }
      } catch (error) {
        console.error('🔐 Error setting up Tauri listeners:', error)
      }
    }

    setupTauriListeners()
  }, [])

  useEffect(() => {
    let mounted = true
    
    const initializeAuth = async () => {
      console.log('🔐 Initializing auth state...')
      
      try {
        // First, try to get existing session from Supabase
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('🔐 Error getting session:', error)
        }
        
        if (session?.user && mounted) {
          console.log('🔐 Found existing Supabase session:', session.user.email)
          setUser(session.user)
        } else {
          // Fallback: check for stored tokens in localStorage (Tauri)
          const googleToken = localStorage.getItem('google_access_token')
          const googleUserInfo = localStorage.getItem('google_user_info')
          
          console.log('🔐 Checking localStorage fallback:', {
            googleToken: googleToken ? 'present' : 'missing',
            googleUserInfo: googleUserInfo ? 'present' : 'missing'
          })
          
          if (googleToken && googleUserInfo && mounted) {
            try {
              const userInfo = JSON.parse(googleUserInfo)
              console.log('🔐 Attempting to restore user from localStorage:', userInfo.email)
              
              // Try to restore Supabase session with stored token
              const { data, error: sessionError } = await supabase.auth.setSession({
                access_token: googleToken,
                refresh_token: localStorage.getItem('google_refresh_token') || ''
              })
              
              if (sessionError) {
                console.log('🔐 Could not restore Supabase session, clearing stale tokens:', sessionError.message)
                // Clear stale tokens to prevent broken state
                localStorage.removeItem('google_access_token')
                localStorage.removeItem('google_refresh_token')
                localStorage.removeItem('google_user_info')
                setUser(null)
              } else {
                console.log('🔐 Successfully restored Supabase session from localStorage')
                setUser(data.session?.user ?? null)
              }
            } catch (parseError) {
              console.error('🔐 Error parsing stored user info, clearing tokens:', parseError)
              // Clear corrupted tokens
              localStorage.removeItem('google_access_token')
              localStorage.removeItem('google_refresh_token')
              localStorage.removeItem('google_user_info')
              setUser(null)
            }
          } else if (mounted) {
            console.log('🔐 No existing session or stored tokens found')
            setUser(null)
          }
        }
      } catch (error) {
        console.error('❌ Error initializing auth:', error)
        if (mounted) setUser(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    // Set up auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('🔐 Auth state changed:', event, session?.user?.email || 'no user')
        
        // Clear auth cache on any auth state change
        clearUserCache();
        
        if (mounted) {
          if (session?.user) {
            setUser(session.user)
          } else {
            setUser(null)
          }
        }
      }
    )

    initializeAuth()

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = async () => {
    console.log('🔐 signInWithGoogle function started!')
    
    // Skip token clearing for faster authentication
    // Only clear if there's an existing user to avoid conflicts
    if (user && typeof window !== 'undefined') {
      console.log('🔐 Clearing existing session for fresh auth...')
      await supabase.auth.signOut()
      setUser(null)
    }
    
    try {
      console.log('🔐 Starting Tauri Google OAuth...')
      
      // Check if we're in Tauri environment
      const isTauri = typeof window !== 'undefined' && '__TAURI__' in window
      console.log('🔐 Tauri environment detected:', isTauri)
      
      if (isTauri) {
        // Start the OAuth flow (persistent listeners will handle the response)
        console.log('🔐 Invoking start_google_oauth command...')
        try {
          const port = await invoke('start_google_oauth') as number
          console.log('🔐 OAuth server started on port:', port)
          console.log('🔐 Persistent event listeners will handle auth callback...')
        } catch (invokeError) {
          console.error('🔐 Error invoking start_google_oauth:', invokeError)
          throw invokeError
        }
        
        return { error: null }
      } else {
        // Fallback to browser-based Supabase OAuth
        console.log('🔐 Not in Tauri, using Supabase OAuth...')
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: 'http://localhost:3001/auth/callback'
          }
        })
        
        if (error) {
          console.error('❌ Supabase OAuth failed:', error)
          return { error }
        }
        
        return { error: null }
      }
    } catch (error) {
      console.error('🔐 Google sign in error:', error)
      return { error: error as AuthError }
    }
  }

  const signOut = async () => {
    try {
      console.log('🔐 Starting sign out process...')
      
      // Clear Supabase session
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Supabase sign out error:', error)
        // Continue with cleanup even if Supabase signOut fails
      }
      
      // Clear all stored tokens and user data
      if (typeof window !== 'undefined') {
        console.log('🔐 Clearing localStorage tokens...')
        localStorage.removeItem('google_access_token')
        localStorage.removeItem('google_refresh_token')
        localStorage.removeItem('google_user_info')
        
        // Clear any other auth-related localStorage items
        localStorage.removeItem('supabase.auth.token')
        
        console.log('🔐 Tokens cleared, setting user to null')
      }
      
      // Clear user state
      setUser(null)
      
      // Force redirect to home page
      if (typeof window !== 'undefined') {
        console.log('🔐 Redirecting to home page after sign out...');
        setTimeout(() => {
          window.location.href = '/';
        }, 100); // Small delay to ensure state is updated
      }
      
      console.log('🔐 Sign out completed successfully')
    } catch (error) {
      console.error('Sign out error:', error)
      // Even if there's an error, clear the user state and tokens
      setUser(null)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('google_access_token')
        localStorage.removeItem('google_refresh_token')
        localStorage.removeItem('google_user_info')
        localStorage.removeItem('supabase.auth.token')
        
        // Force redirect even on error
        console.log('🔐 Sign out had errors, but still redirecting to home page...');
        setTimeout(() => {
          window.location.href = '/';
        }, 100);
      }
    }
  }

  const signInWithApple = async () => {
    console.log('🔐 signInWithApple function started!')

    try {
      // Detect Tauri
      const isTauri = typeof window !== 'undefined' && '__TAURI__' in window
      console.log('🔐 Tauri environment detected (Apple):', isTauri)

      if (isTauri) {
        // Start the OAuth flow (persistent listeners in this context will handle the response)
        console.log('🔐 Invoking start_apple_oauth command...')
        try {
          const port = await invoke('start_apple_oauth') as number
          console.log('🔐 Apple OAuth server started on port:', port)
          console.log('🔐 Persistent event listeners will handle auth callback...')
        } catch (invokeError) {
          console.error('🔐 Error invoking start_apple_oauth:', invokeError)
          throw invokeError
        }
        
        return { error: null }
      } else {
        // Browser-based Supabase OAuth for Apple
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: {
            redirectTo: 'http://localhost:3001/auth/callback'
          }
        })

        if (error) {
          console.error('❌ Supabase OAuth (Apple) failed:', error)
          return { error }
        }
        return { error: null }
      }
    } catch (error) {
      console.error('🔐 Apple sign in error:', error)
      return { error: error as AuthError }
    }
  }

  const signInWithX = async () => {
    console.log('🔐 signInWithX function started!')

    try {
      // Detect Tauri
      const isTauri = typeof window !== 'undefined' && '__TAURI__' in window
      console.log('🔐 Tauri environment detected (X):', isTauri)

      if (isTauri) {
        // Start the OAuth flow (persistent listeners in this context will handle the response)
        console.log('🔐 Invoking start_x_oauth command...')
        try {
          const port = await invoke('start_x_oauth') as number
          console.log('🔐 X OAuth server started on port:', port)
          console.log('🔐 Persistent event listeners will handle auth callback...')
        } catch (invokeError) {
          console.error('🔐 Error invoking start_x_oauth:', invokeError)
          throw invokeError
        }
        
        return { error: null }
      } else {
        // Browser-based Supabase OAuth for Twitter/X
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'twitter',
          options: {
            redirectTo: 'http://localhost:3001/auth/callback'
          }
        })

        if (error) {
          console.error('❌ Supabase OAuth (X) failed:', error)
          return { error }
        }
        return { error: null }
      }
    } catch (error) {
      console.error('🔐 X sign in error:', error)
      return { error: error as AuthError }
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      signInWithGoogle,
      signInWithApple,
      signInWithX,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  return useContext(AuthContext)
} 