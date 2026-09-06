"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { onboardingRouteForStep } from "@/lib/activation-flow.mjs"

export default function PermissionsOnboardingPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace(onboardingRouteForStep("setup"))
  }, [router])

  return (
    <div className="ritual-onboarding-font flex min-h-screen items-center justify-center bg-[#fcfcfa]">
      <BrailleSpinner className="text-2xl text-gray-900" />
    </div>
  )
}
