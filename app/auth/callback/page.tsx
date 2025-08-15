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
              setStatus('Authentication successful! Redirecting...');
              
              // Wait a bit to ensure the session is properly set
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Navigate back to main app after successful authentication
              setTimeout(() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/dashboard';
                }
              }, 1000);
              return;
            }
          }
          
          // Handle authorization code flow
          if (!code) {
            console.error('❌ No authorization code or tokens found in URL');
            setStatus('No authorization code found. Please try signing in again.');
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/'
              }
            }, 3000);
            return;
          }
          
          console.log('✅ Authorization code found, processing...');
          setStatus('Processing authentication...');
          
          // Let Supabase handle the OAuth callback automatically
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            console.error('❌ Error getting session:', sessionError);
            setStatus(`Authentication failed: ${sessionError.message}`)
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/'
              }
            }, 3000);
            return;
          }
          
          if (session && session.user) {
            console.log('✅ Session found in callback:', session.user.email);
            setStatus('Authentication successful! Redirecting...')
            
            // Wait a bit to ensure the session is properly set
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Navigate back to main app after successful authentication
            setTimeout(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/dashboard'
              }
            }, 1000);
            return;
          } else {
            console.log('❌ No session found in callback');
            setStatus('No active session found. Please try signing in again.')
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
      
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Ritual Desktop</h1>
          <p className="text-gray-600 mb-4">{status}</p>
        </div>
        
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
        
        <Button 
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.href = '/dashboard'
            }
          }}
          className="mt-4"
        >
          Return to App
        </Button>
      </div>
    </div>
  )
} 