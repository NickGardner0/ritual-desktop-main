"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  AudioLines,
  Check,
  Keyboard,
  MessageCircle,
  Mic,
  Monitor,
  Volume2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { getDesktopCapabilities } from "@/lib/desktop-capabilities"
import { cn } from "@/lib/utils"

type SetupScreen = "permissions" | "practice"
type PermissionKey = "microphone" | "speech" | "accessibility"

type PermissionState = Record<PermissionKey, boolean>

const DEFAULT_PERMISSION_STATE: PermissionState = {
  microphone: false,
  speech: false,
  accessibility: false,
}

async function getInvoke() {
  if (!getDesktopCapabilities().isDesktop) return null
  try {
    const mod = await import("@tauri-apps/api/core")
    return mod.invoke
  } catch {
    return null
  }
}

function StepProgress({ current }: { current: SetupScreen }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-label={current === "permissions" ? "Setup step 1 of 2" : "Setup step 2 of 2"}>
      <span
        className={cn(
          "h-[6px] rounded-full transition-all duration-200",
          current === "permissions" ? "w-[22px] bg-[#18181b]" : "w-[6px] bg-[#d4d4d8]",
        )}
      />
      <span
        className={cn(
          "h-[6px] rounded-full transition-all duration-200",
          current === "practice" ? "w-[22px] bg-[#18181b]" : "w-[6px] bg-[#d4d4d8]",
        )}
      />
    </div>
  )
}

function PrimaryAction({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-11 w-full rounded-[8px] border border-[#18181b] bg-[#18181b] px-4 text-[15px] font-semibold text-white shadow-[0_10px_28px_rgba(24,24,27,0.12)] transition duration-150 hover:bg-[#27272a] active:translate-y-px active:bg-[#09090b] disabled:pointer-events-none disabled:border-[#e4e4e7] disabled:bg-[#f4f4f5] disabled:text-[#a1a1aa] disabled:opacity-100 disabled:shadow-none",
      )}
    >
      {children}
    </Button>
  )
}

function QuietSkip({
  children = "Skip for now",
  disabled,
  onClick,
}: {
  children?: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mx-auto rounded-md px-3 py-1.5 text-[14px] font-semibold text-[#71717a] transition-colors hover:text-[#18181b] disabled:pointer-events-none disabled:opacity-45"
    >
      {children}
    </button>
  )
}

function StepShell({
  current,
  title,
  subtitle,
  children,
  actions,
  onBack,
  wide,
}: {
  current: SetupScreen
  title: string
  subtitle: ReactNode
  children: ReactNode
  actions: ReactNode
  onBack?: () => void
  wide?: boolean
}) {
  return (
    <div
      className="relative flex h-[612px] w-full max-w-[800px] flex-col overflow-hidden bg-white text-[#18181b]"
      style={{ fontFamily: "var(--ritual-selected-font-family)" }}
    >
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-0 h-12" />
      <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center px-7 pt-7">
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className={cn(
            "grid h-9 w-9 place-items-center rounded-[8px] text-[#71717a] transition-colors hover:bg-[#f4f4f5] hover:text-[#18181b]",
            !onBack && "invisible",
          )}
        >
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.1} />
        </button>
        <StepProgress current={current} />
      </div>

      <main className="relative z-10 flex flex-1 items-center justify-center px-8 pb-5 pt-2">
        <section
          className={cn(
            "flex w-full animate-in fade-in slide-in-from-bottom-1 flex-col",
            wide ? "max-w-[560px]" : "max-w-[430px]",
          )}
        >
          <h1
            className="text-center text-[34px] font-semibold leading-[1.14] tracking-normal text-[#18181b]"
          >
            {title}
          </h1>
          <p className={cn("mx-auto mt-3 text-center text-[15px] leading-[1.42] text-[#71717a]", wide ? "max-w-[430px]" : "max-w-[350px]")}>
            {subtitle}
          </p>
          <div className="mt-6">{children}</div>
          <div className="mt-5 flex flex-col gap-2.5">{actions}</div>
        </section>
      </main>
    </div>
  )
}

function PermissionIcon({
  granted,
  probing,
  children,
}: {
  granted?: boolean
  probing?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-white text-[#71717a] transition-colors",
        granted
          ? "border-[#cfd8cf] bg-[#f0f7f0] text-[#3f6b44]"
          : "border-[#e4e4e7]",
        probing && "animate-pulse",
      )}
      aria-hidden="true"
    >
      {granted ? <Check className="h-[15px] w-[15px]" strokeWidth={2.7} /> : children}
    </span>
  )
}

function PermissionRow({
  icon,
  title,
  detail,
  granted,
  loading,
  onAllow,
  badge,
}: {
  icon: ReactNode
  title: string
  detail: string
  granted?: boolean
  loading?: boolean
  onAllow?: () => void
  badge?: string
}) {
  return (
    <li className="grid min-h-[70px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#ededee] px-4 last:border-b-0">
      <PermissionIcon granted={granted} probing={loading}>
        {icon}
      </PermissionIcon>
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold leading-[1.15] text-[#18181b]">{title}</h2>
        <p className="mt-1 text-[14px] leading-[1.35] text-[#71717a]">{detail}</p>
      </div>
      {onAllow && !granted ? (
        <Button
          type="button"
          disabled={loading}
          onClick={onAllow}
          className="h-8 min-w-[68px] rounded-[8px] border border-[#d4d4d8] bg-white px-3 text-[13px] font-semibold text-[#18181b] shadow-none hover:bg-[#f4f4f5] disabled:pointer-events-none disabled:opacity-75"
        >
          {loading ? <BrailleSpinner className="text-[13px]" intervalMs={45} /> : "Allow"}
        </Button>
      ) : badge ? (
        <span className="rounded-md bg-[#f4f4f5] px-2 py-1 text-[12px] font-semibold text-[#71717a]">
          {badge}
        </span>
      ) : null}
    </li>
  )
}

function PermissionsCard({
  permissions,
  workingKey,
  onGrant,
}: {
  permissions: PermissionState
  workingKey: PermissionKey | null
  onGrant: (key: PermissionKey) => void
}) {
  return (
    <ul className="overflow-hidden rounded-[12px] border border-[#e4e4e7] bg-white p-0 text-left shadow-[0_18px_44px_rgba(24,24,27,0.06)]">
      <PermissionRow
        icon={<Mic className="h-[16px] w-[16px]" strokeWidth={2.1} />}
        title="Microphone"
        detail="Hears you only when you ask Ritual to listen."
        granted={permissions.microphone}
        loading={workingKey === "microphone"}
        onAllow={() => onGrant("microphone")}
      />
      <PermissionRow
        icon={<AudioLines className="h-[16px] w-[16px]" strokeWidth={2.1} />}
        title="Speech Recognition"
        detail="Converts your voice into text for fast habit logging."
        granted={permissions.speech}
        loading={workingKey === "speech"}
        onAllow={() => onGrant("speech")}
      />
      <PermissionRow
        icon={<Monitor className="h-[16px] w-[16px]" strokeWidth={2.1} />}
        title="Accessibility"
        detail="Reads active app and window context for desktop tracking."
        granted={permissions.accessibility}
        loading={workingKey === "accessibility"}
        onAllow={() => onGrant("accessibility")}
      />
      <PermissionRow
        icon={<Volume2 className="h-[16px] w-[16px]" strokeWidth={2.1} />}
        title="System audio"
        detail="Ritual asks macOS the first time a recording needs app audio."
        badge="Later"
      />
    </ul>
  )
}

function VoicePracticeCard({
  value,
  setValue,
  textareaRef,
  isListening,
  isProcessingVoice,
  partialTranscript,
  onToggleVoice,
}: {
  value: string
  setValue: (value: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  isListening: boolean
  isProcessingVoice: boolean
  partialTranscript: string | null
  onToggleVoice: () => void
}) {
  const hasText = value.trim().length > 0
  const statusText = isListening ? "Listening" : isProcessingVoice ? "Processing" : "Voice"

  return (
    <div className="flex flex-col">
      <div className="mx-6 -mb-5 flex min-h-[72px] items-start justify-between gap-3 rounded-t-[12px] border border-[#e4e4e7] bg-white px-6 pb-8 pt-4">
        <span className="inline-flex items-center gap-2 text-[14px] text-[#3f3f46]">
          <Keyboard className="h-[16px] w-[16px] text-[#71717a]" strokeWidth={2.1} />
          Use the microphone button to dictate
        </span>
        <span className="rounded-[8px] bg-[#f4f4f5] px-3 py-1.5 text-[13px] font-semibold text-[#52525b]">
          {statusText}
        </span>
      </div>

      <div className="relative rounded-[12px] border border-[#e4e4e7] bg-white p-4 text-left shadow-[0_18px_44px_rgba(24,24,27,0.07)]">
        <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 px-1 pb-4">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[#18181b] text-white" aria-hidden="true">
            <MessageCircle className="h-[15px] w-[15px]" strokeWidth={2.1} />
          </span>
          <div>
            <p className="text-[14px] font-semibold leading-none text-[#71717a]">Ritual</p>
            <p className="mt-2 text-[17px] leading-[1.3] text-[#18181b]">What do you want to log first?</p>
          </div>
        </div>

        <div className="rounded-[10px] border border-[#e4e4e7] bg-white p-2 shadow-[0_8px_22px_rgba(24,24,27,0.05)] transition-shadow focus-within:shadow-[0_0_0_1px_rgba(24,24,27,0.18),0_10px_24px_rgba(24,24,27,0.07)]">
          <textarea
            ref={textareaRef}
            rows={3}
            value={value}
            placeholder={partialTranscript?.trim() || "Tell Ritual what to log..."}
            onChange={(event) => setValue(event.target.value)}
            className="block min-h-[96px] w-full resize-none bg-transparent px-3 py-2 text-[16px] leading-[1.45] text-[#18181b] outline-none placeholder:text-[#a1a1aa]"
          />
          <div className="flex min-h-9 items-center justify-between gap-3 px-1 pb-1">
            <span className="inline-flex h-7 items-center rounded-md bg-[#f4f4f5] px-2 text-[13px] font-semibold text-[#71717a]">
              mic
            </span>
            <div className="flex items-center gap-2">
              {hasText ? (
                <span className="grid h-7 w-7 place-items-center rounded-md bg-[#f0f7f0] text-[#3f6b44]" aria-label="Practice entry ready">
                  <Check className="h-[15px] w-[15px]" strokeWidth={2.6} />
                </span>
              ) : null}
              <button
                type="button"
                onClick={onToggleVoice}
                aria-label={isListening ? "Stop voice recording" : "Start voice recording"}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-[9px] bg-[#f4f4f5] text-[#71717a] transition-colors hover:bg-[#e4e4e7] hover:text-[#18181b]",
                  isListening && "bg-[#18181b] text-white shadow-[0_0_0_3px_rgba(24,24,27,0.12)]",
                )}
              >
                {isProcessingVoice ? (
                  <BrailleSpinner className="text-[14px]" intervalMs={45} />
                ) : (
                  <Mic className="h-[18px] w-[18px]" strokeWidth={2.1} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OnboardingSetupStep({
  busy,
  onFinish,
}: {
  busy?: boolean
  onFinish: () => void
  userId?: string | null
}) {
  const [screen, setScreen] = useState<SetupScreen>("permissions")
  const [permissions, setPermissions] = useState<PermissionState>(DEFAULT_PERMISSION_STATE)
  const [workingKey, setWorkingKey] = useState<PermissionKey | null>(null)
  const [practiceValue, setPracticeValue] = useState("")
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const [partialTranscript, setPartialTranscript] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const speechRecognitionRef = useRef<any | null>(null)
  const partialTranscriptRef = useRef("")
  const isDesktop = getDesktopCapabilities().isDesktop

  const refreshPermissions = useCallback(async () => {
    const invoke = await getInvoke()
    if (!invoke) return

    const [accessibility, microphone, speech] = await Promise.all([
      invoke<boolean>("check_accessibility_permission").catch(() => false),
      invoke<boolean>("check_native_microphone_permission").catch(() => false),
      invoke<boolean>("check_native_speech_recognition_permission").catch(() => false),
    ])

    setPermissions({ accessibility, microphone, speech })
  }, [])

  useEffect(() => {
    void refreshPermissions()
    const interval = window.setInterval(() => {
      void refreshPermissions()
    }, 1800)
    return () => window.clearInterval(interval)
  }, [refreshPermissions])

  const schedulePermissionRefresh = useCallback(() => {
    void refreshPermissions()
    window.setTimeout(() => void refreshPermissions(), 900)
    window.setTimeout(() => void refreshPermissions(), 2200)
  }, [refreshPermissions])

  async function openSettings(command: string) {
    const invoke = await getInvoke()
    if (!invoke) return
    await invoke(command).catch(() => undefined)
  }

  async function handleGrant(key: PermissionKey) {
    if (workingKey) return
    setWorkingKey(key)
    try {
      const invoke = await getInvoke()
      if (!invoke) return

      if (key === "microphone") {
        const granted = await invoke<boolean>("show_native_microphone_permission_dialog").catch(() => false)
        if (!granted) {
          await openSettings("open_microphone_settings")
        }
      }

      if (key === "speech") {
        const granted = await invoke<boolean>("show_native_speech_recognition_permission_dialog").catch(() => false)
        if (!granted) {
          await openSettings("open_speech_recognition_settings")
        }
      }

      if (key === "accessibility") {
        const granted = await invoke<boolean>("request_accessibility_permission").catch(() => false)
        if (!granted) {
          await openSettings("open_accessibility_settings")
        }
      }

      schedulePermissionRefresh()
    } finally {
      setWorkingKey(null)
    }
  }

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.abort?.()
    }
  }, [])

  function handleToggleVoice() {
    if (isProcessingVoice) return
    if (isListening) {
      setIsProcessingVoice(true)
      speechRecognitionRef.current?.stop?.()
      return
    }

    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null

    if (!SpeechRecognition) {
      setVoiceError("Voice input is unavailable here. Type a first log to continue.")
      textareaRef.current?.focus()
      return
    }

    setVoiceError(null)
    setPartialTranscript(null)
    partialTranscriptRef.current = ""
    setIsProcessingVoice(true)

    const recognition = new SpeechRecognition()
    speechRecognitionRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = navigator.language || "en-US"

    recognition.onstart = () => {
      setIsProcessingVoice(false)
      setIsListening(true)
    }

    recognition.onresult = (event: any) => {
      let transcript = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? ""
      }

      if (!transcript.trim()) return
      partialTranscriptRef.current = transcript
      setPartialTranscript(transcript)

      const latestResult = event.results[event.results.length - 1]
      if (latestResult?.isFinal) {
        setPracticeValue(transcript.trim().replace(/[.?!]\s*$/, ""))
        setPartialTranscript(null)
        partialTranscriptRef.current = ""
      }
    }

    recognition.onerror = () => {
      setVoiceError("Voice input failed. Type a first log to continue.")
      setIsListening(false)
      setIsProcessingVoice(false)
      setPartialTranscript(null)
      speechRecognitionRef.current = null
      textareaRef.current?.focus()
    }

    recognition.onend = () => {
      const transcript = partialTranscriptRef.current.trim()
      if (transcript) {
        setPracticeValue(transcript.replace(/[.?!]\s*$/, ""))
      }
      setIsListening(false)
      setIsProcessingVoice(false)
      setPartialTranscript(null)
      partialTranscriptRef.current = ""
      speechRecognitionRef.current = null
      window.setTimeout(() => textareaRef.current?.focus(), 80)
    }

    try {
      recognition.start()
    } catch {
      setVoiceError("Voice input is already starting. Try again in a moment.")
      setIsProcessingVoice(false)
      speechRecognitionRef.current = null
    }
  }

  const permissionContinueDisabled =
    Boolean(busy) ||
    Boolean(workingKey) ||
    (isDesktop && (!permissions.microphone || !permissions.speech || !permissions.accessibility))
  const practiceReady = practiceValue.trim().length > 0

  if (screen === "practice") {
    return (
      <StepShell
        current="practice"
        title="Talk to Ritual"
        subtitle="Try a first voice log, or type one if you want to keep moving."
        onBack={() => setScreen("permissions")}
        actions={
          <>
            <PrimaryAction disabled={busy || !practiceReady} onClick={onFinish}>
              {busy ? "Starting Ritual" : "Start using Ritual"}
            </PrimaryAction>
            <QuietSkip disabled={busy} onClick={onFinish} />
          </>
        }
      >
        <VoicePracticeCard
          value={practiceValue}
          setValue={setPracticeValue}
          textareaRef={textareaRef}
          isListening={isListening}
          isProcessingVoice={isProcessingVoice}
          partialTranscript={partialTranscript}
          onToggleVoice={handleToggleVoice}
        />
        {voiceError ? (
          <p className="mt-3 rounded-[10px] border border-[#e4e4e7] bg-[#fafafa] px-3 py-2 text-center text-[13px] leading-[1.35] text-[#52525b]">
            {voiceError}
          </p>
        ) : null}
      </StepShell>
    )
  }

  return (
    <StepShell
      current="permissions"
      title="Let Ritual listen and read context"
      subtitle="Voice logging and desktop context need a few macOS permissions."
      wide
      actions={
        <>
          <PrimaryAction disabled={permissionContinueDisabled} onClick={() => setScreen("practice")}>
            Continue
          </PrimaryAction>
          <QuietSkip disabled={busy} onClick={() => setScreen("practice")} />
        </>
      }
    >
      <PermissionsCard
        permissions={permissions}
        workingKey={workingKey}
        onGrant={(key) => void handleGrant(key)}
      />
    </StepShell>
  )
}
