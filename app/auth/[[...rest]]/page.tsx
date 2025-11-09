'use client'

import { SignIn } from '@clerk/nextjs'
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler'

export default function AuthPage() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <ClerkOAuthHandler />
      
      {/* Window Drag Region - Top area */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 w-full h-16 z-50"
      />
      
      <div className="w-full max-w-md">
        <SignIn
          routing="path"
          path="/auth"
          appearance={{
            elements: {
              card: "shadow-lg border border-gray-200 rounded-none",
              cardBox: "rounded-none",
              headerTitle: "text-2xl font-medium text-gray-900",
              headerSubtitle: "text-base text-gray-500",
              socialButtonsBlockButton: "border border-gray-200 text-gray-700 hover:bg-gray-100 rounded-none font-medium transition-colors text-sm shadow-sm",
              socialButtonsBlockButtonText: "font-medium",
              formButtonPrimary: "bg-gray-900 text-white hover:bg-gray-800 rounded-none font-medium transition-colors text-sm shadow-sm",
              footerActionText: "text-gray-500",
              footerActionLink: "text-gray-900 hover:text-gray-700",
              formFieldInput: "border border-gray-200 rounded-none focus:ring-gray-900 focus:border-gray-900",
              formFieldLabel: "text-gray-700 font-medium",
              dividerLine: "bg-gray-200",
              dividerText: "text-gray-500"
            },
            layout: {
              socialButtonsPlacement: "top"
            },
            variables: {
              fontFamily: "inherit",
              fontSize: "14px",
              fontWeight: {
                normal: 400,
                medium: 500,
                semibold: 600,
                bold: 700
              }
            }
          }}
        />
      </div>
    </div>
  )
}
