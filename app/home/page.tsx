"use client"

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { ArrowRight } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { supabase } from '@/lib/supabase';

export default function HomePage() {
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGetStarted = () => {
    // Navigate to the main app/dashboard
    if (typeof window !== 'undefined') {
      window.location.href = '/dashboard';
    }
  };

  const handleSignIn = () => {
    setShowLoginModal(true);
  };

  const handleGoogleLogin = async () => {
    setLoginLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard`
        }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Google login error:', error);
      setError('Failed to sign in with Google');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (error) throw error;
      // Redirect to dashboard on success
      if (typeof window !== 'undefined') {
        window.location.href = '/dashboard';
      }
    } catch (error) {
      console.error('Email login error:', error);
      setError('Invalid email or password');
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white relative overflow-hidden">
      {/* Window Drag Region */}
      <div className="tauri-drag-region" data-tauri-drag-region />
      
      {/* Minimal Header */}
      <header className="relative z-10 px-6 py-4">
        <div className="flex items-center justify-end">
          <Button 
            onClick={handleSignIn}
            variant="ghost"
            size="sm"
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            Sign In
          </Button>
        </div>
      </header>

      {/* Main Content - Centered with Grid Pattern */}
      <main className="relative z-10 flex-1 flex items-center justify-center min-h-[calc(100vh-80px)]">
        {/* Grid Pattern Background */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-full opacity-[0.08]" style={{
            backgroundImage: `
              linear-gradient(rgba(0, 0, 0, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 0, 0, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0'
          }}></div>
        </div>
        
        <div className="text-center relative z-10">
          {/* Small Greyish Logo */}
          <div className="flex justify-center mb-8">
            <div className="w-12 h-12 bg-gray-200 rounded-lg flex items-center justify-center">
              <div className="w-6 h-6 bg-gray-400 rounded-sm"></div>
            </div>
          </div>
        </div>
      </main>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Sign in to Ritual</h2>
              <p className="text-sm text-gray-600 mt-1">Desktop App</p>
            </div>
            
            <div className="space-y-4">
              <Button
                onClick={handleGoogleLogin}
                disabled={loginLoading}
                className="w-full flex items-center justify-center space-x-2"
              >
                {loginLoading ? (
                  <Spinner className="w-4 h-4" />
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span>Continue with Google</span>
                  </>
                )}
              </Button>
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">Or continue with email</span>
                </div>
              </div>
              
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div>
                  <Input
                    type="email"
                    placeholder="Email address"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    className="rounded-none"
                  />
                </div>
                <div>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className="rounded-none"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full rounded-none"
                >
                  {loginLoading ? <Spinner className="w-4 h-4" /> : 'Sign in'}
                </Button>
              </form>
            </div>
            
            {error && (
              <div className="text-red-600 text-sm text-center bg-red-50 p-3 rounded mt-4">
                {error}
              </div>
            )}
            
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 