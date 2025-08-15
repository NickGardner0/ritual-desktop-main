'use client';

import React, { createContext, useContext, useEffect, useState } from 'react'
import { User, AuthError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type AuthContextType = {
  user: User | null
  loading: boolean
  signInWithGoogle: () => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setUser(session?.user ?? null)
      } catch (error) {
        console.error('Error getting session:', error)
      } finally {
        setLoading(false)
      }
    }

    getSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)
        setLoading(false)
        
        if (event === 'SIGNED_IN' && session?.user) {
          console.log('User signed in:', session.user.email)
          // Simple redirect to dashboard
          if (typeof window !== 'undefined') {
            window.location.href = '/dashboard'
          }
        } else if (event === 'SIGNED_OUT') {
          console.log('User signed out')
          // Simple redirect to home
          if (typeof window !== 'undefined') {
            window.location.href = '/'
          }
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    try {
      console.log('🔐 Starting Tauri Google OAuth...')
      
      // For Tauri apps, we need to handle OAuth differently
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'http://localhost:3001/auth/callback',
          skipBrowserRedirect: true, // Don't redirect automatically
          queryParams: {
            access_type: 'offline',
            prompt: 'consent'
          }
        }
      })
      
      if (error) {
        console.error('❌ OAuth URL generation failed:', error)
        return { error }
      }
      
      if (!data?.url) {
        console.error('❌ No OAuth URL generated')
        return { error: new Error('No OAuth URL generated') as AuthError }
      }
      
      console.log('🔐 Opening OAuth URL in system browser...')
      console.log('🔐 Generated OAuth URL:', data.url)
      
      // Dynamically import Tauri shell API to avoid SSR issues
      const { shell } = await import('@tauri-apps/api')
      await shell.open(data.url)
      
      console.log('🔐 OAuth URL opened in system browser')
      
      // Start polling for session changes to detect when OAuth completes
      const pollForSession = () => {
        const interval = setInterval(async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession()
            if (session?.user) {
              console.log('🔐 OAuth success detected! User authenticated:', session.user.email)
              clearInterval(interval)
              
              // Redirect to dashboard
              if (typeof window !== 'undefined') {
                window.location.href = '/dashboard'
              }
            }
          } catch (error) {
            console.error('🔐 Error polling for session:', error)
          }
        }, 2000) // Poll every 2 seconds
        
        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(interval)
          console.log('🔐 OAuth polling timeout reached')
        }, 300000)
      }
      
      pollForSession()
      return { error: null }
    } catch (error) {
      console.error('Google sign in error:', error)
      return { error: error as AuthError }
    }
  }

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      signInWithGoogle,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  return useContext(AuthContext)
} 