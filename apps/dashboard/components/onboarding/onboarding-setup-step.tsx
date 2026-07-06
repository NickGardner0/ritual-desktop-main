"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  Accessibility,
  ArrowLeft,
  AudioLines,
  Check,
  Keyboard,
  Mic,
  MessageCircle,
  Speech,
  Volume2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { BrailleSpinner } from "@/components/ui/braille-spinner"
import { getDesktopCapabilities } from "@/lib/desktop-capabilities"
import {
  clearNativeDesktopSpeechState,
  formatNativeSpeechError,
  getNativeDesktopSpeechState,
  getNativeSpeechErrorMessage,
  startNativeDesktopSpeechRecognition,
  stopNativeDesktopSpeechRecognition,
} from "@/lib/native-voice"
import { ensureMicrophonePermission } from "@/lib/tauri-utils"
import { cn } from "@/lib/utils"

type SetupStep = "permissions" | "practice"
type PermissionKey = "microphone" | "speech" | "accessibility" | "systemAudio"

type PermissionState = Record<PermissionKey, boolean> & {
  checked: boolean
  systemAudioUnsupported: boolean
  systemAudioMessage: string
}

type SourceReadiness = {
  source: "microphone" | "system"
  ready: boolean
  permissionState: string
  recoveryAction?: string | null
  message?: string | null
}

type RecordingSourceReadiness = {
  ready: boolean
  sources: SourceReadiness[]
}

const SETUP_STEPS: SetupStep[] = ["permissions", "practice"]

const DEFAULT_PERMISSION_STATE: PermissionState = {
  checked: false,
  microphone: false,
  speech: false,
  accessibility: false,
  systemAudio: false,
  systemAudioUnsupported: false,
  systemAudioMessage: "",
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

function StepProgress({ step }: { step: SetupStep }) {
  const currentIndex = SETUP_STEPS.indexOf(step)

  return (
    <div className="flex items-center justify-center gap-1.5" aria-label="Setup progress">
      {SETUP_STEPS.map((item, index) => (
        <span
          key={item}
          className={cn(
            "h-1.5 rounded-full transition-all duration-150",
            index === currentIndex ? "w-6 bg-[#18181b]" : index < currentIndex ? "w-1.5 bg-[#a1a1aa]" : "w-1.5 bg-[#d4d4d8]",
          )}
        />
      ))}
    </div>
  )
}

function SetupShell({
  step,
  children,
  onBack,
}: {
  step: SetupStep
  children: ReactNode
  onBack?: () => void
}) {
  return (
    <div
      className="relative flex h-[690px] w-full max-w-[800px] flex-col overflow-hidden bg-white text-[#18181b]"
      style={{ fontFamily: "var(--ritual-selected-font-family, var(--ritual-font-fk)), 'FK Grotesk Neue', -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-8" />
      <div className="grid h-[72px] shrink-0 grid-cols-[1fr_auto_1fr] items-center px-7 pt-6">
        <div className="flex justify-start">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#71717a] transition-colors duration-75 hover:bg-[#f4f4f5] hover:text-[#18181b]"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <StepProgress step={step} />
        <div />
      </div>
      <div className="flex flex-1 items-center justify-center px-7 pb-10">
        {children}
      </div>
    </div>
  )
}

function PrimarySetupButton({
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
        "h-11 w-full rounded-[8px] border px-4 text-[14px] font-semibold transition-colors duration-75",
        disabled
          ? "border-[#e4e4e7] bg-[#f4f4f5] text-[#a1a1aa] shadow-none hover:bg-[#f4f4f5]"
          : "border-[#18181b] bg-[#18181b] text-white shadow-[0_10px_28px_rgba(24,24,27,0.12)] hover:bg-[#27272a]",
      )}
    >
      {children}
    </Button>
  )
}

function QuietSetupButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mx-auto block rounded-md px-3 py-2 text-[13px] font-medium text-[#71717a] transition-colors duration-75 hover:text-[#18181b] disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function PermissionIcon({
  granted,
  children,
}: {
  granted: boolean
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
        granted
          ? "border-[#c7d2c2] bg-[#eef3ec] text-[#3f5f38]"
          : "border-[#e4e4e7] bg-white text-[#71717a]",
      )}
    >
      {granted ? <Check className="h-4 w-4" strokeWidth={2.2} /> : children}
    </span>
  )
}

function PermissionRow({
  icon,
  title,
  detail,
  granted,
  loading,
  prompted,
  onAllow,
}: {
  icon: ReactNode
  title: string
  detail: string
  granted: boolean
  loading?: boolean
  prompted?: boolean
  onAllow: () => void
}) {
  return (
    <li className="grid min-h-[74px] grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t border-[#e8e8ea] px-4 first:border-t-0">
      <PermissionIcon granted={granted}>{icon}</PermissionIcon>
      <div className="min-w-0 py-3 text-left">
        <h2 className="text-[15px] font-semibold leading-tight text-[#18181b]">{title}</h2>
        <p className="mt-1 text-[13px] leading-snug text-[#71717a]">{detail}</p>
      </div>
      {granted ? null : (
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={onAllow}
          className="h-8 min-w-[74px] shrink-0 rounded-sm border-[#dfe1e5] bg-white px-3 text-[13px] font-medium text-[#18181b] shadow-none transition-colors duration-75 hover:bg-[#f5f5f5]"
          aria-label={`${prompted ? "Open settings for" : "Allow"} ${title}`}
        >
          {loading ? <BrailleSpinner className="text-sm" intervalMs={45} /> : prompted ? "Open" : "Allow"}
        </Button>
      )}
    </li>
  )
}

function PermissionsStep({
  permissions,
  workingKey,
  prompted,
  busy,
  onGrant,
  onContinue,
  onSkip,
}: {
  permissions: PermissionState
  workingKey: PermissionKey | null
  prompted: Record<PermissionKey, boolean>
  busy?: boolean
  onGrant: (key: PermissionKey) => void
  onContinue: () => void
  onSkip: () => void
}) {
  const ready = permissions.microphone && permissions.speech && permissions.accessibility
    && (permissions.systemAudio || permissions.systemAudioUnsupported)

  return (
    <SetupShell step="permissions">
      <section className="w-full max-w-[590px] text-center">
        <img src="/images/eclipse.svg" alt="" width={34} height={34} className="mx-auto h-[34px] w-[34px]" />
        <h1 className="mt-5 text-[34px] font-semibold leading-tight tracking-normal text-[#18181b]">
          Let Ritual listen and read context
        </h1>
        <p className="mx-auto mt-3 max-w-[430px] text-[15px] leading-snug text-[#71717a]">
          Voice logging and desktop context need four macOS permissions.
        </p>

        {permissions.checked ? (
          <ul
            className="mt-8 overflow-hidden rounded-[10px] border border-[#e4e4e7] bg-white shadow-[0_8px_24px_rgba(24,24,27,0.06)]"
            aria-busy={false}
          >
            <PermissionRow
              icon={<Mic className="h-4 w-4" strokeWidth={1.8} />}
              title="Microphone"
              detail={
                prompted.microphone && !permissions.microphone
                  ? "Turn it on in System Settings, then return to Ritual."
                  : "Hears you only when you ask Ritual to listen."
              }
              granted={permissions.microphone}
              loading={workingKey === "microphone"}
              prompted={prompted.microphone && !permissions.microphone}
              onAllow={() => onGrant("microphone")}
            />
            <PermissionRow
              icon={<Speech className="h-4 w-4" strokeWidth={1.8} />}
              title="Speech Recognition"
              detail={
                prompted.speech && !permissions.speech
                  ? "Turn it on in System Settings, then return to Ritual."
                  : "Converts your voice into text for fast habit logging."
              }
              granted={permissions.speech}
              loading={workingKey === "speech"}
              prompted={prompted.speech && !permissions.speech}
              onAllow={() => onGrant("speech")}
            />
            <PermissionRow
              icon={<Accessibility className="h-4 w-4" strokeWidth={1.8} />}
              title="Accessibility"
              detail={
                prompted.accessibility && !permissions.accessibility
                  ? "Enable Ritual in Accessibility settings, then come back here."
                  : "Lets Ritual read active app and window context for desktop tracking."
              }
              granted={permissions.accessibility}
              loading={workingKey === "accessibility"}
              prompted={prompted.accessibility && !permissions.accessibility}
              onAllow={() => onGrant("accessibility")}
            />
            <PermissionRow
              icon={<Volume2 className="h-4 w-4" strokeWidth={1.8} />}
              title="System audio"
              detail={
                permissions.systemAudioUnsupported
                  ? permissions.systemAudioMessage || "System audio capture is not available on this Mac."
                  : prompted.systemAudio && !permissions.systemAudio
                    ? permissions.systemAudioMessage || "Enable Ritual in Screen & System Audio Recording settings, then come back here."
                    : permissions.systemAudioMessage || "Hears Mac audio only when you include system audio in a voice log."
              }
              granted={permissions.systemAudio || permissions.systemAudioUnsupported}
              loading={workingKey === "systemAudio"}
              prompted={prompted.systemAudio && !permissions.systemAudio && !permissions.systemAudioUnsupported}
              onAllow={() => onGrant("systemAudio")}
            />
          </ul>
        ) : (
          <div className="mt-8 flex h-[300px] items-center justify-center">
            <BrailleSpinner className="text-2xl text-[#18181b]" />
          </div>
        )}

        <div className="mx-auto mt-8 w-full max-w-[590px] space-y-2">
          <PrimarySetupButton disabled={busy || !ready} onClick={onContinue}>
            Continue
          </PrimarySetupButton>
          <QuietSetupButton disabled={busy} onClick={onSkip}>
            Skip for now
          </QuietSetupButton>
        </div>
      </section>
    </SetupShell>
  )
}

function VoicePracticeStep({
  busy,
  onBack,
  onFinish,
}: {
  busy?: boolean
  onBack: () => void
  onFinish: () => void
}) {
  const [value, setValue] = useState("")
  const [greeted, setGreeted] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const [partialTranscript, setPartialTranscript] = useState("")
  const [voiceError, setVoiceError] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pollRef = useRef<number | null>(null)
  const autoStopRef = useRef<number | null>(null)
  const timestampRef = useRef(0)
  const partialRef = useRef("")

  const succeeded = value.trim().length > 0

  const clearVoiceTimers = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (autoStopRef.current) {
      window.clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
  }, [])

  const resetNativeVoiceSession = useCallback(async () => {
    clearVoiceTimers()
    timestampRef.current = 0
    partialRef.current = ""
    setPartialTranscript("")
    await clearNativeDesktopSpeechState().catch(() => undefined)
  }, [clearVoiceTimers])

  useEffect(() => {
    const timer = window.setTimeout(() => setGreeted(true), 650)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    return () => {
      clearVoiceTimers()
      void stopNativeDesktopSpeechRecognition().catch(() => undefined)
    }
  }, [clearVoiceTimers])

  const finishVoiceWithText = useCallback(async (text: string) => {
    await resetNativeVoiceSession()
    setIsListening(false)
    setIsProcessingVoice(false)
    if (text.trim()) {
      setValue(text.trim())
      window.setTimeout(() => textareaRef.current?.focus(), 80)
    } else {
      setVoiceError("No speech detected. Please try again.")
    }
  }, [resetNativeVoiceSession])

  const startVoice = useCallback(async () => {
    if (isListening) {
      setIsProcessingVoice(true)
      await stopNativeDesktopSpeechRecognition().catch((error) => {
        setVoiceError(formatNativeSpeechError(getNativeSpeechErrorMessage(error)))
        setIsListening(false)
        setIsProcessingVoice(false)
      })
      return
    }

    setVoiceError("")
    setIsProcessingVoice(false)
    await resetNativeVoiceSession()

    try {
      if (!(await ensureMicrophonePermission())) {
        throw new Error("microphone-permission-denied")
      }

      await startNativeDesktopSpeechRecognition()
      setIsListening(true)

      pollRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const state = await getNativeDesktopSpeechState()
            if (!state.timestamp || state.timestamp <= timestampRef.current) {
              return
            }
            timestampRef.current = state.timestamp

            if (state.event === "ritual:speech:partial") {
              partialRef.current = state.transcript || ""
              setPartialTranscript(state.transcript || "")
              return
            }

            if (state.event === "ritual:speech:final") {
              await finishVoiceWithText(state.transcript || partialRef.current)
              return
            }

            if (state.event === "ritual:speech:error") {
              await resetNativeVoiceSession()
              setIsListening(false)
              setIsProcessingVoice(false)
              setVoiceError(formatNativeSpeechError(state.transcript))
              return
            }

            if (state.event === "ritual:speech:status" && state.transcript === "stopped") {
              await finishVoiceWithText(partialRef.current)
            }
          } catch (error) {
            await resetNativeVoiceSession()
            setIsListening(false)
            setIsProcessingVoice(false)
            setVoiceError(formatNativeSpeechError(getNativeSpeechErrorMessage(error)))
          }
        })()
      }, 90)

      autoStopRef.current = window.setTimeout(() => {
        void stopNativeDesktopSpeechRecognition().catch(() => undefined)
      }, 10000)
    } catch (error) {
      await resetNativeVoiceSession()
      setIsListening(false)
      setIsProcessingVoice(false)
      setVoiceError(formatNativeSpeechError(getNativeSpeechErrorMessage(error)))
    }
  }, [finishVoiceWithText, isListening, resetNativeVoiceSession])

  return (
    <SetupShell step="practice" onBack={onBack}>
      <section className="w-full max-w-[590px] text-center">
        <h1 className="text-[36px] font-semibold leading-tight tracking-normal text-[#18181b]">
          Talk to Ritual
        </h1>
        <p className="mx-auto mt-3 max-w-[360px] text-[15px] leading-snug text-[#71717a]">
          Try a first voice log, or type one if you want to keep moving.
        </p>

        <div className="mx-auto mt-8 w-full max-w-[540px]">
          <div className="mx-7 mb-[-18px] flex items-center justify-between rounded-t-[10px] border border-[#e4e4e7] bg-white px-5 pb-7 pt-3 text-[14px] text-[#52525b]">
            <span className="inline-flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-[#71717a]" strokeWidth={1.8} />
              Use the microphone button to dictate
            </span>
            <span className="rounded-md bg-[#f4f4f5] px-2 py-1 text-[12px] font-medium text-[#71717a]">
              Voice
            </span>
          </div>

          <div className="relative rounded-[14px] border border-[#e4e4e7] bg-white p-4 text-left shadow-[0_10px_32px_rgba(24,24,27,0.08)]">
            <div className="flex items-start gap-3 px-1 pb-4">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#18181b] text-white">
                <MessageCircle className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[#71717a]">Ritual</div>
                {greeted ? (
                  <div className="text-[15px] leading-snug text-[#18181b]">What do you want to log first?</div>
                ) : (
                  <div className="flex h-[22px] items-center gap-1" aria-label="Ritual is typing">
                    <span className="h-1 w-1 rounded-full bg-[#a1a1aa]" />
                    <span className="h-1 w-1 rounded-full bg-[#a1a1aa]" />
                    <span className="h-1 w-1 rounded-full bg-[#a1a1aa]" />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[10px] border border-[#e4e4e7] bg-white p-3 transition-colors duration-75 focus-within:border-[#c7c7cc]">
              <textarea
                ref={textareaRef}
                value={partialTranscript || value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={isListening ? "Listening..." : "Tell Ritual what to log..."}
                rows={3}
                readOnly={isListening}
                className="block min-h-[82px] w-full resize-none border-0 bg-transparent text-[15px] leading-6 text-[#18181b] outline-none placeholder:text-[#9ca3af]"
              />
              <div className="flex min-h-8 items-center justify-between gap-3 pt-2">
                <span className="rounded-md bg-[#f4f4f5] px-2 py-1 text-[12px] font-semibold text-[#71717a]">
                  mic
                </span>
                <button
                  type="button"
                  onClick={() => void startVoice()}
                  disabled={isProcessingVoice}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-[9px] transition-colors duration-75",
                    isListening
                      ? "bg-[#18181b] text-white"
                      : "bg-[#eeeeef] text-[#52525b] hover:bg-[#e4e4e7] hover:text-[#18181b]",
                  )}
                  aria-label={isListening ? "Stop voice input" : "Start voice input"}
                >
                  {isProcessingVoice ? (
                    <BrailleSpinner className="text-sm" intervalMs={45} />
                  ) : isListening ? (
                    <AudioLines className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  ) : (
                    <Mic className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  )}
                </button>
              </div>
            </div>
          </div>

          {voiceError ? (
            <p className="mt-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-left text-[13px] leading-snug text-red-700">
              {voiceError}
            </p>
          ) : null}
        </div>

        <div className="mx-auto mt-8 w-full max-w-[590px] space-y-2">
          <PrimarySetupButton disabled={busy || !succeeded} onClick={onFinish}>
            {busy ? "Starting" : "Start using Ritual"}
          </PrimarySetupButton>
          <QuietSetupButton disabled={busy} onClick={onFinish}>
            Skip for now
          </QuietSetupButton>
        </div>
      </section>
    </SetupShell>
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
  const [step, setStep] = useState<SetupStep>("permissions")
  const [permissions, setPermissions] = useState<PermissionState>(DEFAULT_PERMISSION_STATE)
  const [workingKey, setWorkingKey] = useState<PermissionKey | null>(null)
  const [prompted, setPrompted] = useState<Record<PermissionKey, boolean>>({
    microphone: false,
    speech: false,
    accessibility: false,
    systemAudio: false,
  })
  const autoPromptedMicrophoneRef = useRef(false)
  const systemAudioCacheRef = useRef<{
    at: number
    granted: boolean
    unsupported: boolean
    message: string
  } | null>(null)

  const readSystemAudioPermission = useCallback(async (
    invoke: Awaited<ReturnType<typeof getInvoke>>,
    probeSystemAudio = false,
  ) => {
    if (!invoke) {
      return {
        granted: true,
        unsupported: false,
        message: "",
      }
    }

    if (!probeSystemAudio && systemAudioCacheRef.current && Date.now() - systemAudioCacheRef.current.at < 8000) {
      return systemAudioCacheRef.current
    }

    const readiness = await invoke<RecordingSourceReadiness>("check_recording_source_readiness", {
      request: {
        sourceMode: "microphonePlusSystem",
        probeSystemAudio,
      },
    }).catch(() => null)
    const system = readiness?.sources.find((source) => source.source === "system")
    const result = {
      at: Date.now(),
      granted: Boolean(system?.ready && system.permissionState === "granted"),
      unsupported: system?.permissionState === "unsupported",
      message: system?.message || "",
    }
    systemAudioCacheRef.current = result
    return result
  }, [])

  const refreshPermissions = useCallback(async () => {
    const invoke = await getInvoke()
    if (!invoke) {
      setPermissions({
        checked: true,
        microphone: true,
        speech: true,
        accessibility: true,
        systemAudio: true,
        systemAudioUnsupported: false,
        systemAudioMessage: "",
      })
      return
    }

    const [accessibility, microphone, speech, systemAudio] = await Promise.all([
      invoke<boolean>("check_accessibility_permission").catch(() => false),
      invoke<boolean>("check_native_microphone_permission").catch(() => false),
      invoke<boolean>("check_native_speech_recognition_permission").catch(() => false),
      readSystemAudioPermission(invoke),
    ])

    setPermissions({
      checked: true,
      microphone,
      speech,
      accessibility,
      systemAudio: systemAudio.granted,
      systemAudioUnsupported: systemAudio.unsupported,
      systemAudioMessage: systemAudio.message,
    })
  }, [readSystemAudioPermission])

  useEffect(() => {
    void refreshPermissions()
    const interval = window.setInterval(() => {
      void refreshPermissions()
    }, 1500)
    window.addEventListener("focus", refreshPermissions)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshPermissions)
    }
  }, [refreshPermissions])

  const schedulePermissionRefresh = useCallback(() => {
    void refreshPermissions()
    window.setTimeout(() => void refreshPermissions(), 900)
    window.setTimeout(() => void refreshPermissions(), 2400)
  }, [refreshPermissions])

  const openSettings = useCallback(async (command: string) => {
    const invoke = await getInvoke()
    if (!invoke) return
    await invoke(command).catch(() => undefined)
  }, [])

  const handleGrant = useCallback(async (key: PermissionKey) => {
    if (workingKey) return

    setWorkingKey(key)
    try {
      const invoke = await getInvoke()
      if (!invoke) return

      const alreadyPrompted = prompted[key]

      if (key === "microphone") {
        if (alreadyPrompted) {
          await openSettings("open_microphone_settings")
        } else {
          const granted = await invoke<boolean>("show_native_microphone_permission_dialog").catch(() => false)
          setPrompted((current) => ({ ...current, microphone: true }))
          if (!granted) await openSettings("open_microphone_settings")
        }
      }

      if (key === "speech") {
        if (alreadyPrompted) {
          await openSettings("open_speech_recognition_settings")
        } else {
          const granted = await invoke<boolean>("show_native_speech_recognition_permission_dialog").catch(() => false)
          setPrompted((current) => ({ ...current, speech: true }))
          if (!granted) await openSettings("open_speech_recognition_settings")
        }
      }

      if (key === "accessibility") {
        if (alreadyPrompted) {
          await openSettings("open_accessibility_settings")
        } else {
          await invoke<boolean>("request_accessibility_permission").catch(() => false)
          setPrompted((current) => ({ ...current, accessibility: true }))
        }
      }

      if (key === "systemAudio") {
        if (alreadyPrompted) {
          await openSettings("open_system_audio_settings")
        } else {
          const result = await readSystemAudioPermission(invoke, true)
          setPrompted((current) => ({ ...current, systemAudio: true }))
          setPermissions((current) => ({
            ...current,
            checked: true,
            systemAudio: result.granted,
            systemAudioUnsupported: result.unsupported,
            systemAudioMessage: result.message,
          }))
          if (!result.granted && !result.unsupported) {
            await openSettings("open_system_audio_settings")
          }
        }
      }

      schedulePermissionRefresh()
    } finally {
      setWorkingKey(null)
    }
  }, [openSettings, prompted, readSystemAudioPermission, schedulePermissionRefresh, workingKey])

  useEffect(() => {
    if (step !== "permissions") return
    if (autoPromptedMicrophoneRef.current) return
    if (!permissions.checked || permissions.microphone) return
    if (!getDesktopCapabilities().isDesktop) return

    autoPromptedMicrophoneRef.current = true
    window.setTimeout(() => {
      void handleGrant("microphone")
    }, 250)
  }, [handleGrant, permissions.checked, permissions.microphone, step])

  if (step === "practice") {
    return (
      <VoicePracticeStep
        busy={busy}
        onBack={() => setStep("permissions")}
        onFinish={onFinish}
      />
    )
  }

  return (
    <PermissionsStep
      permissions={permissions}
      workingKey={workingKey}
      prompted={prompted}
      busy={busy}
      onGrant={(key) => void handleGrant(key)}
      onContinue={() => setStep("practice")}
      onSkip={() => setStep("practice")}
    />
  )
}
