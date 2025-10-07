'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'

export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Processing authentication...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log('🔐 Desktop auth callback page loaded');
        if (typeof window !== 'undefined') {
          console.log('🔍 Current URL:', window.location.href);
          console.log('🔍 URL search params:', window.location.search);
          console.log('🔍 URL hash:', window.location.hash);
          console.log('🔍 Full URL object:', window.location);
          console.log('🔍 All URL parameters:', Object.fromEntries(new URLSearchParams(window.location.search)));
        }
        setStatus('Processing authentication...')
        
        // Check for OAuth errors in URL params
        if (typeof window !== 'undefined') {
          const urlParams = new URLSearchParams(window.location.search)
          const error = urlParams.get('error')
          const errorDescription = urlParams.get('error_description')
          const code = urlParams.get('code')
          const state = urlParams.get('state')
          
          // Check for tokens in URL hash (implicit flow)
          const hashParams = new URLSearchParams(window.location.hash.substring(1))
          const accessToken = hashParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token')
          const tokenType = hashParams.get('token_type')
          
          console.log('🔍 OAuth params:', { error, errorDescription, code: code ? 'present' : 'missing', state: state ? 'present' : 'missing' });
          console.log('🔍 Hash params:', { accessToken: accessToken ? 'present' : 'missing', refreshToken: refreshToken ? 'present' : 'missing', tokenType });
          
          if (error) {
            console.error('❌ OAuth error detected:', error, errorDescription);
            setStatus(`Authentication failed: ${errorDescription || error}`)
            
            // Log additional debugging info
            console.log('🔍 URL params:', Object.fromEntries(urlParams.entries()));
            
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/'
              }
            }, 5000);
            return;
          }
          
          // Handle implicit flow (tokens in hash)
          if (accessToken && refreshToken) {
            console.log('✅ Tokens found in hash, setting session...');
            setStatus('Setting up session...');
            
            // Set the session manually with the tokens
            const { data, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });
            
            if (sessionError) {
              console.error('❌ Error setting session:', sessionError);
              setStatus(`Authentication failed: ${sessionError.message}`);
              setTimeout(() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/';
                }
              }, 3000);
              return;
            }
            
            if (data.session && data.session.user) {
              console.log('✅ Session set successfully:', data.session.user.email);
              setStatus('Authentication successful! Setting up profile...');
              
              // Wait a bit to ensure the session is properly set
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Check if user profile exists, create if it doesn't
              let { data: profile } = await supabase
                .from('profiles')
                .select('onboarding_completed')
                .eq('id', data.session.user.id)
                .single();
              
              if (!profile) {
                console.log('🔄 Creating new profile for user:', data.session.user.email);
                // Create profile for new user
                const { error: profileError } = await supabase
                  .from('profiles')
                  .insert({
                    id: data.session.user.id,
                    email: data.session.user.email,
                    full_name: data.session.user.user_metadata?.full_name || data.session.user.email?.split('@')[0],
                    onboarding_completed: false
                  });
                
                if (profileError) {
                  console.error('❌ Error creating profile:', profileError);
                } else {
                  console.log('✅ Profile created successfully');
                  profile = { onboarding_completed: false };
                }
              }
              
              // Navigate to onboarding or dashboard based on completion status
              setTimeout(() => {
                if (typeof window !== 'undefined') {
                  const redirectUrl = profile?.onboarding_completed ? '/dashboard' : '/onboarding';
                  console.log('🔄 Redirecting to:', redirectUrl);
                  window.location.href = redirectUrl;
                }
              }, 1000);
              return;
            }
          }
          
          // Handle authorization code flow
          if (!code) {
            console.error('❌ No authorization code found in URL');
            setStatus('No authorization code found. Please try signing in again.');
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/'
              }
            }, 3000);
            return;
          }
          
          console.log('✅ Authorization code found, exchanging for session...');
          setStatus('Exchanging code for session...');
          
          // Exchange the authorization code for a session
          const { data: { session }, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
          
          if (sessionError) {
            console.error('❌ Error exchanging code for session:', sessionError);
            setStatus(`Authentication failed: ${sessionError.message}`)
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/'
              }
            }, 3000);
            return;
          }
          
          if (session && session.user) {
            console.log('✅ Session created successfully:', session.user.email);
            setStatus('Authentication successful! Communicating with desktop app...')
            
            // For desktop apps, redirect back to the main app with session tokens
            console.log('🔐 Redirecting back to desktop app with session tokens...')
            setStatus('Authentication successful! Redirecting back to app...')
            
            // Store session data in localStorage for desktop app to detect
            const authData = {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              user_email: session.user?.email
            }
            
            console.log('🔐 Storing auth data in localStorage for desktop app...')
            localStorage.setItem('supabase_auth_success', JSON.stringify(authData))
            
            // Try multiple communication methods for desktop app
            if (window.opener) {
              console.log('🔐 Sending postMessage to opener window...')
              window.opener.postMessage({ 
                type: 'SUPABASE_AUTH_SUCCESS', 
                data: authData 
              }, '*')
            }
            
            // Also try to communicate via URL redirect to desktop app
            console.log('🔐 Attempting to redirect to desktop app with auth data...')
            const params = new URLSearchParams({
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              user_email: session.user?.email || ''
            })
            
            // Display tokens for manual entry in desktop app
            console.log('🔐 Displaying tokens for manual entry...')
            setStatus(`✅ Authentication successful! 
            
Copy these tokens to your desktop app:

Access Token: ${session.access_token}

Refresh Token: ${session.refresh_token}

Email: ${session.user?.email}

You can now close this window and paste the tokens in the desktop app.`)
            
            // Also try the redirect as backup
            setTimeout(() => {
              try {
                window.location.href = `http://localhost:3001/?auth_success=true&${params.toString()}`
              } catch (e) {
                console.log('🔐 Redirect failed, tokens displayed for manual entry')
              }
            }, 2000)
            
            // Show success message and close window
            setStatus('✅ Authentication successful! You can close this window.')
            
            // Try to close the window after a short delay
            setTimeout(() => {
              console.log('🔐 Attempting to close auth window')
              window.close()
            }, 2000)
            
            return;
          } else {
            console.log('❌ No session created');
            setStatus('Failed to create session. Please try signing in again.')
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/'
              }
            }, 3000);
          }
        }
      } catch (error) {
        console.error('💥 Exception in handleCallback:', error);
        setStatus('Authentication error occurred')
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/'
          }
        }, 3000);
      }
    };

    handleCallback();
  }, []);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      {/* Window Drag Region - Top Bar */}
      <div 
        className="tauri-drag-region"
        data-tauri-drag-region
      />
      
      <div className="max-w-md w-full text-center px-6">
        {/* Logo */}
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center">
            <img 
              src="/images/ritual.svg" 
              alt="Ritual Logo" 
              className="w-full h-full rotate-180"
            />
          </div>
          
          {/* Status */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-gray-900 mb-3" style={{ fontFamily: 'PP Neue Montreal, -apple-system, BlinkMacSystemFont, sans-serif' }}>
              OAuth Complete! ✨
            </h1>
            <p className="text-base text-gray-500 leading-relaxed">
              You can close this window.
            </p>
          </div>
          
          {/* Elegant Loading Spinner */}
          <div className="mb-6">
            <div className="w-8 h-8 mx-auto">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-200">
                <div className="rounded-full h-8 w-8 border-2 border-transparent border-t-gray-900"></div>
              </div>
            </div>
          </div>
          
          {/* Subtle status text */}
          {status !== 'Processing authentication...' && (
            <div className="text-sm text-gray-400 mb-4 max-w-sm mx-auto">
              {status}
            </div>
          )}
        </div>
        
        {/* Footer text */}
        <div className="text-xs text-gray-400 mt-8">
          If Ritual doesn't open in a few seconds, <button onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.href = '/dashboard'
            }
          }} className="underline hover:text-gray-600 transition-colors">click here</button>.
        </div>
        
        <div className="text-xs text-gray-300 mt-4">
          You may close this browser tab when done
        </div>
      </div>
    </div>
  )
} 