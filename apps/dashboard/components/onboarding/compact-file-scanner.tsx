"use client"

import { useEffect, useState } from "react"

const RAW_LINES = [
  '<HealthData locale="en_US">',
  '<Record type="StepCount" value="2847"/>',
  '<Record type="HeartRate" value="72"/>',
  '<Record type="Sleep" duration="7h34m"/>',
  '<Workout type="Running" distance="3.2mi"/>',
  "</HealthData>",
]

const PARSED_LINES = [
  "Apple Health Export",
  "Steps  2,847  ·  iPhone",
  "Heart rate  72 bpm  ·  Apple Watch",
  "Sleep  7h 34m  ·  Apple Watch",
  "Running workout  3.2 mi",
  "2,418 records normalized",
]

const SCRAMBLE_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_#"

function scrambleLine(
  initial: string,
  final: string,
  frame: number,
  totalFrames: number,
  lineIndex: number,
) {
  if (frame >= totalFrames) return final

  const revealedCharacters = Math.floor((final.length * frame) / totalFrames)

  return Array.from(final, (character, characterIndex) => {
    if (characterIndex < revealedCharacters || character === " ") {
      return character
    }

    const initialCharacter = initial[characterIndex]
    if (frame === 0 && initialCharacter) return initialCharacter

    const scrambleIndex =
      (characterIndex * 13 + lineIndex * 7 + frame * 5) %
      SCRAMBLE_CHARACTERS.length
    return SCRAMBLE_CHARACTERS[scrambleIndex]
  }).join("")
}

export function CompactFileScanner() {
  const [lines, setLines] = useState(RAW_LINES)
  const [scanCycle, setScanCycle] = useState(0)

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    if (reducedMotion) {
      const animationFrame = window.requestAnimationFrame(() => {
        setLines(PARSED_LINES)
      })
      return () => window.cancelAnimationFrame(animationFrame)
    }

    const timeouts = new Set<number>()
    const intervals = new Set<number>()
    let stopped = false

    function runScan() {
      if (stopped) return

      setLines(RAW_LINES)
      setScanCycle((cycle) => cycle + 1)

      const transitionTimeout = window.setTimeout(() => {
        let frame = 0
        const totalFrames = 12
        const scrambleInterval = window.setInterval(() => {
          frame += 1
          setLines(
            PARSED_LINES.map((line, index) =>
              scrambleLine(
                RAW_LINES[index] ?? "",
                line,
                frame,
                totalFrames,
                index,
              ),
            ),
          )

          if (frame >= totalFrames) {
            window.clearInterval(scrambleInterval)
            intervals.delete(scrambleInterval)
          }
        }, 60)

        intervals.add(scrambleInterval)
      }, 620)

      timeouts.add(transitionTimeout)
    }

    runScan()
    const loopInterval = window.setInterval(runScan, 4200)
    intervals.add(loopInterval)

    return () => {
      stopped = true
      timeouts.forEach((timeout) => window.clearTimeout(timeout))
      intervals.forEach((interval) => window.clearInterval(interval))
    }
  }, [])

  return (
    <div
      role="img"
      aria-label="Ritual scanning and normalizing an Apple Health export"
      className="relative h-[158px] overflow-hidden rounded-[10px] border border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-chip)]"
    >
      <div className="relative flex h-6 items-center border-b border-[var(--px-onboarding-border)] bg-[var(--px-onboarding-recessed)] px-2.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9c7c3]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9c7c3]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9c7c3]" />
        </div>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-medium text-[var(--px-onboarding-muted)]">
          Ritual
        </span>
      </div>

      <div
        className="flex h-6 overflow-hidden border-b border-[var(--px-onboarding-border)]"
        aria-hidden="true"
      >
        <span className="flex min-w-0 flex-[1.18] items-center border-r border-[var(--px-onboarding-border)] px-2 text-[9px] text-[var(--px-onboarding-ink)]">
          <span className="truncate">apple_health_export.xml</span>
          <span className="ml-auto pl-1 text-[11px] text-[var(--px-onboarding-muted)]">
            ×
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-center border-r border-[var(--px-onboarding-border)] px-2 text-[9px] text-[var(--px-onboarding-muted)]">
          <span className="truncate">whoop_import.csv</span>
        </span>
        <span className="flex min-w-0 flex-1 items-center px-2 text-[9px] text-[var(--px-onboarding-muted)]">
          <span className="truncate">oura_ring_import.csv</span>
        </span>
      </div>

      <div className="relative h-[110px] overflow-hidden px-4 py-3">
        <code className="block text-[8.5px] font-normal leading-[14px] text-[var(--px-onboarding-ink)] [font-variant-ligatures:none]">
          {lines.map((line, index) => (
            <span
              key={index}
              className="block h-[14px] truncate whitespace-pre transition-colors duration-100"
            >
              {line}
            </span>
          ))}
        </code>

        <span
          key={scanCycle}
          aria-hidden="true"
          className="ritual-compact-scan-line pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--ritual-focus-ring)]"
        />
      </div>

      <style jsx>{`
        .ritual-compact-scan-line {
          animation: ritual-compact-file-scan 2100ms
            cubic-bezier(0.65, 0, 0.35, 1) forwards;
        }

        @keyframes ritual-compact-file-scan {
          0% {
            opacity: 0;
            transform: translateY(0);
          }
          8%,
          88% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateY(110px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ritual-compact-scan-line {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  )
}
