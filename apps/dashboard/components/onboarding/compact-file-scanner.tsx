"use client"

import { useEffect, useRef, useState } from "react"
import { animate, scrambleText } from "animejs"
import { Check } from "lucide-react"
import { Badge } from "@ritual/ui/badge"
import { MenuSurface } from "@ritual/ui/menu"

const CYCLE_DURATION = 6000
const SCAN_START = 900
const SCAN_END = 3000
const SETTLE_END = 3500
const COMPLETION_DURATION = 240
const RESET_START = 5250
const RESET_END = 5650
const PROCESSING_BAND_HEIGHT = 48

type FileId = "apple" | "whoop" | "oura"

type FileContent = {
  sourceLines: string[]
  parsedLines: string[]
  completionLabel: string
}

const TABS: Array<{ id: FileId; label: string }> = [
  { id: "apple", label: "apple_health_export.xml" },
  { id: "whoop", label: "whoop_import.csv" },
  { id: "oura", label: "oura_ring_import.csv" },
]

const APPLE_HEALTH_SOURCE_LINES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<HealthData locale="en_US">',
  '  <ExportDate value="2026-05-15 18:42:18 -0400"/>',
  '  <Me HKCharacteristicTypeIdentifierDateOfBirth="1993-08-12"/>',
  '  <Record type="HKQuantityTypeIdentifierStepCount"',
  '    sourceName="iPhone" unit="count"',
  '    startDate="2026-05-14 00:00:00 -0400"',
  '    endDate="2026-05-14 23:59:59 -0400" value="2847"/>',
  '  <Record type="HKQuantityTypeIdentifierHeartRate"',
  '    sourceName="Apple Watch" unit="count/min"',
  '    startDate="2026-05-14 08:12:00 -0400" value="72"/>',
  '  <Record type="HKQuantityTypeIdentifierRestingHeartRate"',
  '    sourceName="Apple Watch" unit="count/min" value="61"/>',
  '  <Record type="HKQuantityTypeIdentifierActiveEnergyBurned"',
  '    sourceName="Apple Watch" unit="kcal" value="146.3"/>',
  '  <Record type="HKCategoryTypeIdentifierSleepAnalysis"',
  '    sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepCore"',
  '    startDate="2026-05-13 23:18:00 -0400"',
  '    endDate="2026-05-14 06:52:00 -0400"/>',
  '  <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning"',
  '    sourceName="Apple Watch" unit="mi"',
  '    startDate="2026-05-14 07:30:00 -0400" value="1.82"/>',
  '  <Record type="HKQuantityTypeIdentifierFlightsClimbed"',
  '    sourceName="Apple Watch" unit="count" value="8"/>',
  '  <Record type="HKQuantityTypeIdentifierAppleExerciseTime"',
  '    sourceName="Apple Watch" unit="min" value="42"/>',
  '  <Workout workoutActivityType="HKWorkoutActivityTypeWalking">',
  '    <MetadataEntry key="HKIndoorWorkout" value="0"/>',
  '    <MetadataEntry key="HKWeatherHumidity" value="58"/>',
  "  </Workout>",
  '  <CorrelationMetric type="steps_to_hrv" coefficient="0.41"/>',
  "</HealthData>",
]

const APPLE_HEALTH_PARSED_LINES = [
  "# Apple Health Export",
  "",
  "## Parsed daily summary",
  "",
  "| Metric | Value | Source |",
  "| --- | ---: | --- |",
  "| Steps | 2,847 | iPhone |",
  "| Heart rate | 72 bpm | Apple Watch |",
  "| Resting heart rate | 61 bpm | Apple Watch |",
  "| Active energy | 146.3 kcal | Apple Watch |",
  "| Sleep | 7h 34m core | Apple Watch |",
  "| Walking distance | 1.82 mi | Apple Watch |",
  "| Flights climbed | 8 | Apple Watch |",
  "| Exercise time | 42 min | Apple Watch |",
  "| Running workout | 3.2 mi | Apple Watch |",
  "",
  "## Normalized records",
  "",
  "| Window | Start | End |",
  "| --- | --- | --- |",
  "| Activity | May 14, 08:00 | May 14, 09:00 |",
  "| Sleep | May 13, 23:18 | May 14, 06:52 |",
  "| Workout | walking | 42 minutes |",
  "",
  "## Import validation",
  "",
  "- Export rows parsed: 2,418",
  "- Metric types detected: 12",
  "- Duplicate workouts: 0",
  "- Invalid timestamps: 0",
  "- Ready to add to Ritual",
]

const WHOOP_SOURCE_LINES = [
  "cycle_start,cycle_end,recovery_score,resting_hr,hrv_ms,",
  "2026-05-03T04:00Z,2026-05-04T04:00Z,74,51,58,",
  "2026-05-04T04:00Z,2026-05-05T04:00Z,81,49,64,",
  "2026-05-05T04:00Z,2026-05-06T04:00Z,62,56,49,",
  "2026-05-06T04:00Z,2026-05-07T04:00Z,88,47,71,",
  "2026-05-07T04:00Z,2026-05-08T04:00Z,69,53,55,",
  "2026-05-08T04:00Z,2026-05-09T04:00Z,77,50,61,",
  "2026-05-09T04:00Z,2026-05-10T04:00Z,90,46,74,",
  "2026-05-10T04:00Z,2026-05-11T04:00Z,58,59,43,",
  "2026-05-11T04:00Z,2026-05-12T04:00Z,73,52,57,",
  "2026-05-12T04:00Z,2026-05-13T04:00Z,85,48,68,",
  "2026-05-13T04:00Z,2026-05-14T04:00Z,71,54,54,",
  "2026-05-14T04:00Z,2026-05-15T04:00Z,79,50,63,",
  "2026-05-15T04:00Z,2026-05-16T04:00Z,83,49,66,",
  "2026-05-16T04:00Z,2026-05-17T04:00Z,67,55,52,",
  "2026-05-17T04:00Z,2026-05-18T04:00Z,92,45,76,",
  "2026-05-18T04:00Z,2026-05-19T04:00Z,76,51,60,",
  "",
  "strain,sleep_performance,sleep_hours,calories,",
  "10.8,84,7.42,2380",
  "8.7,91,7.88,2294",
  "14.1,72,6.21,2718",
  "6.3,94,8.16,2206",
  "12.4,79,6.92,2540",
  "11.2,86,7.35,2467",
  "5.9,96,8.44,2188",
  "15.8,65,5.88,2891",
  "9.6,82,7.10,2345",
  "7.4,92,8.02,2240",
  "12.9,76,6.74,2612",
  "9.1,88,7.61,2377",
]

const WHOOP_PARSED_LINES = [
  "# WHOOP Import",
  "",
  "## Recovery overview",
  "",
  "| Metric | Average | Range |",
  "| --- | ---: | ---: |",
  "| Recovery | 76 | 58–92 |",
  "| Resting HR | 51 bpm | 45–59 |",
  "| HRV | 60 ms | 43–76 |",
  "| Daily strain | 10.5 | 5.9–15.8 |",
  "| Sleep | 7h 28m | 5h 53m–8h 38m |",
  "| Calories | 2,429 | 2,188–2,891 |",
  "",
  "## Detected patterns",
  "",
  "- Best recovery: May 17 · 92%",
  "- Highest strain: May 10 · 15.8",
  "- Longest sleep: May 17 · 8h 38m",
  "- Recovery and HRV correlation: 0.82",
  "- Sleep consistency: 84%",
  "",
  "## Import validation",
  "",
  "- Date range: May 3–18, 2026",
  "- Daily cycles parsed: 16",
  "- Missing days: 0",
  "- Duplicate cycles: 0",
  "- Invalid values: 0",
  "- Timezone normalized: EDT",
  "- Ready to add to Ritual",
]

const OURA_SOURCE_LINES = [
  "day,score,temperature_deviation,temperature_trend_deviation,",
  "2026-05-03,82,-0.10,-0.05,",
  "2026-05-04,88,-0.06,-0.03,",
  "2026-05-05,70,0.14,0.09,",
  "2026-05-06,91,-0.12,-0.07,",
  "2026-05-07,76,0.03,0.01,",
  "2026-05-08,84,-0.04,-0.02,",
  "2026-05-09,93,-0.16,-0.09,",
  "2026-05-10,64,0.21,0.12,",
  "2026-05-11,79,0.02,0.01,",
  "2026-05-12,89,-0.09,-0.04,",
  "2026-05-13,75,0.07,0.04,",
  "2026-05-14,86,-0.05,-0.02,",
  "2026-05-15,90,-0.11,-0.06,",
  "2026-05-16,72,0.10,0.06,",
  "2026-05-17,94,-0.18,-0.10,",
  "2026-05-18,83,-0.02,-0.01,",
  "",
  "day,sleep_score,rem_sleep,deep_sleep,latency,",
  "2026-05-03,86,1.44,1.31,11",
  "2026-05-04,91,1.62,1.48,9",
  "2026-05-05,74,1.05,0.92,18",
  "2026-05-06,93,1.73,1.55,8",
  "2026-05-07,80,1.22,1.08,15",
  "2026-05-08,87,1.51,1.34,10",
  "2026-05-09,95,1.81,1.66,7",
  "2026-05-10,68,0.88,0.71,24",
  "2026-05-11,82,1.36,1.19,14",
  "2026-05-12,90,1.69,1.50,9",
  "2026-05-13,78,1.18,1.02,17",
  "2026-05-14,88,1.57,1.43,10",
]

const OURA_PARSED_LINES = [
  "# Oura Ring Import",
  "",
  "## Sleep and readiness",
  "",
  "| Metric | Average | Best |",
  "| --- | ---: | ---: |",
  "| Readiness | 82 | 94 |",
  "| Sleep score | 85 | 96 |",
  "| REM sleep | 1h 30m | 1h 52m |",
  "| Deep sleep | 1h 17m | 1h 42m |",
  "| Sleep latency | 12 min | 6 min |",
  "| Temperature deviation | -0.02 °C | -0.18 °C |",
  "",
  "## Detected patterns",
  "",
  "- Best readiness: May 17 · 94",
  "- Best sleep score: May 17 · 96",
  "- Average bedtime: 11:24 PM",
  "- Average wake time: 7:08 AM",
  "- Sleep regularity: 87%",
  "",
  "## Import validation",
  "",
  "- Date range: May 3–18, 2026",
  "- Nights parsed: 16",
  "- Missing nights: 0",
  "- Duplicate sessions: 0",
  "- Invalid values: 0",
  "- Timezone normalized: EDT",
  "- Ready to add to Ritual",
]

const FILE_CONTENT: Record<FileId, FileContent> = {
  apple: {
    sourceLines: APPLE_HEALTH_SOURCE_LINES,
    parsedLines: APPLE_HEALTH_PARSED_LINES,
    completionLabel: "2,418 logs imported",
  },
  whoop: {
    sourceLines: WHOOP_SOURCE_LINES,
    parsedLines: WHOOP_PARSED_LINES,
    completionLabel: "16 cycles normalized",
  },
  oura: {
    sourceLines: OURA_SOURCE_LINES,
    parsedLines: OURA_PARSED_LINES,
    completionLabel: "16 nights normalized",
  },
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum)
}

function easeInScan(progress: number) {
  return Math.pow(progress, 1.7)
}

function smoothStep(progress: number) {
  const clamped = clamp(progress)
  return clamped * clamped * (3 - 2 * clamped)
}

function DocumentText({
  lines,
  tone,
  onLineRef,
}: {
  lines: string[]
  tone: "source" | "parsed" | "processing"
  onLineRef?: (index: number, node: HTMLDivElement | null) => void
}) {
  const isSource = tone === "source"

  return (
    <code
      className={
        isSource
          ? "block text-[7px] font-normal leading-[9.5px] [font-variant-ligatures:none]"
          : "block text-[7.5px] font-normal leading-[10.5px] [font-variant-ligatures:none]"
      }
      style={{
        color:
          tone === "processing"
            ? "var(--ritual-text-secondary, #666666)"
            : "var(--ritual-text-primary, #111111)",
        fontFamily: "var(--ritual-font-fk)",
        opacity: isSource ? 0.68 : 1,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {lines.map((line, index) => (
        <div
          key={`${tone}-${index}`}
          ref={(node) => onLineRef?.(index, node)}
          className={
            isSource
              ? "h-[9.5px] truncate whitespace-pre"
              : "h-[10.5px] truncate whitespace-pre"
          }
        >
          {line || " "}
        </div>
      ))}
    </code>
  )
}

function ScannerBody({
  activeFile,
  content,
}: {
  activeFile: FileId
  content: FileContent
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const processingLineRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    const root = rootRef.current
    const body = bodyRef.current
    if (!root || !body) return

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    )
    let animationFrame = 0
    let bodyHeight = body.clientHeight
    let cycleStartedAt = performance.now()
    let activeCycle = -1
    let scrambleAnimations: Array<ReturnType<typeof animate>> = []
    const scrambledLineIndexes = new Set<number>()

    const setVariable = (name: string, value: string) => {
      root.style.setProperty(name, value)
    }

    const updateBodyHeight = () => {
      bodyHeight = body.clientHeight
      setVariable("--scanner-body-height", `${bodyHeight}px`)
    }

    const showFinalState = () => {
      updateBodyHeight()
      setVariable("--scan-y", `${bodyHeight}px`)
      setVariable(
        "--scan-band-top",
        `${Math.max(0, bodyHeight - PROCESSING_BAND_HEIGHT)}px`,
      )
      setVariable("--scan-band-height", "0px")
      setVariable("--scan-band-offset", "0px")
      setVariable("--scan-band-opacity", "0")
      setVariable("--scan-line-opacity", "0")
      setVariable("--parsed-opacity", "1")
      setVariable("--completion-opacity", "1")
      setVariable("--completion-scale", "1")
      setVariable("--completion-shift", "0px")
    }

    const stopScrambleAnimations = () => {
      scrambleAnimations.forEach((animation) => animation.cancel())
      scrambleAnimations = []
    }

    const resetProcessingText = () => {
      processingLineRefs.current.forEach((line, index) => {
        if (line) line.textContent = content.parsedLines[index] || " "
      })
    }

    const startScrambleCycle = () => {
      stopScrambleAnimations()
      resetProcessingText()
      scrambledLineIndexes.clear()
    }

    const startScramblingLine = (
      line: HTMLDivElement,
      index: number,
    ) => {
      scrambledLineIndexes.add(index)

      scrambleAnimations.push(
        animate(line, {
          innerHTML: scrambleText({
            from: "auto",
            reversed: false,
            ease: "linear",
            chars: "a-zA-Z0-9!%#_",
            cursor: "░▒▓█",
            override: false,
            perturbation: 0,
            duration: 500,
            delay: 0,
            revealDelay: 0,
            revealRate: 50,
            settleDuration: 250,
            settleRate: 30,
            seed: index + activeFile.charCodeAt(0) * 100,
          }),
        }),
      )
    }

    const updateFrame = (now: number) => {
      const totalElapsed = now - cycleStartedAt
      const cycle = Math.floor(totalElapsed / CYCLE_DURATION)
      const elapsed = totalElapsed % CYCLE_DURATION

      if (cycle !== activeCycle) {
        activeCycle = cycle
        startScrambleCycle()
      }

      const isScanning = elapsed >= SCAN_START && elapsed < SCAN_END
      const isSettling = elapsed >= SCAN_END && elapsed < SETTLE_END
      const isResetting = elapsed >= RESET_START && elapsed < RESET_END

      let scanProgress = 0
      if (isScanning) {
        scanProgress = easeInScan(
          clamp((elapsed - SCAN_START) / (SCAN_END - SCAN_START)),
        )
      } else if (elapsed >= SCAN_END && elapsed < RESET_END) {
        scanProgress = 1
      }

      const scanY = bodyHeight * scanProgress

      if (isScanning) {
        processingLineRefs.current.forEach((line, index) => {
          if (
            line &&
            !scrambledLineIndexes.has(index) &&
            line.offsetTop + line.offsetHeight / 2 <= scanY
          ) {
            startScramblingLine(line, index)
          }
        })
      }

      const bandHeight = isScanning
        ? Math.min(PROCESSING_BAND_HEIGHT, scanY)
        : isSettling
          ? PROCESSING_BAND_HEIGHT
          : 0
      const bandTop = Math.max(0, scanY - bandHeight)
      const settleProgress = isSettling
        ? smoothStep((elapsed - SCAN_END) / (SETTLE_END - SCAN_END))
        : 0
      const resetProgress = isResetting
        ? smoothStep((elapsed - RESET_START) / (RESET_END - RESET_START))
        : elapsed >= RESET_END
          ? 1
          : 0
      const lineEntrance = clamp((elapsed - SCAN_START) / 120)
      const lineExit = clamp((SCAN_END - elapsed) / 100)
      const lineOpacity = isScanning
        ? Math.min(lineEntrance, lineExit)
        : 0
      const completionProgress =
        elapsed >= SETTLE_END && elapsed < RESET_END
          ? smoothStep(
              (elapsed - SETTLE_END) / COMPLETION_DURATION,
            ) * (1 - resetProgress)
          : 0
      const parsedOpacity = isResetting ? 1 - resetProgress : 1

      setVariable("--scan-y", `${scanY}px`)
      setVariable("--scan-band-top", `${bandTop}px`)
      setVariable("--scan-band-height", `${bandHeight}px`)
      setVariable("--scan-band-offset", `${-bandTop}px`)
      setVariable(
        "--scan-band-opacity",
        `${isScanning ? 1 : isSettling ? 1 - settleProgress : 0}`,
      )
      setVariable("--scan-line-opacity", `${lineOpacity}`)
      setVariable("--parsed-opacity", `${parsedOpacity}`)
      setVariable("--completion-opacity", `${completionProgress}`)
      setVariable(
        "--completion-scale",
        `${0.96 + completionProgress * 0.04}`,
      )
      setVariable(
        "--completion-shift",
        `${(1 - completionProgress) * 5}px`,
      )

      animationFrame = window.requestAnimationFrame(updateFrame)
    }

    const startMotion = () => {
      window.cancelAnimationFrame(animationFrame)
      stopScrambleAnimations()
      resetProcessingText()
      cycleStartedAt = performance.now()
      activeCycle = -1
      updateBodyHeight()

      if (reducedMotionQuery.matches) {
        showFinalState()
        return
      }

      animationFrame = window.requestAnimationFrame(updateFrame)
    }

    const resizeObserver = new ResizeObserver(() => {
      updateBodyHeight()
      if (reducedMotionQuery.matches) showFinalState()
    })
    resizeObserver.observe(body)
    reducedMotionQuery.addEventListener("change", startMotion)
    startMotion()

    return () => {
      window.cancelAnimationFrame(animationFrame)
      stopScrambleAnimations()
      resizeObserver.disconnect()
      reducedMotionQuery.removeEventListener("change", startMotion)
    }
  }, [activeFile, content.parsedLines])

  return (
    <div
      ref={rootRef}
      className="ritual-scanner-body relative min-h-0 flex-1 overflow-hidden"
      style={{ backgroundColor: "var(--ritual-surface-canvas, #fefefe)" }}
    >
      <div ref={bodyRef} className="absolute inset-0">
        <div className="absolute inset-0 px-4 pb-3 pt-3">
          <DocumentText lines={content.sourceLines} tone="source" />
        </div>

        <div className="ritual-scanner-parsed absolute inset-0 px-4 pb-3 pt-3">
          <DocumentText lines={content.parsedLines} tone="parsed" />
        </div>

        <div
          className="ritual-scanner-processing pointer-events-none absolute inset-x-0 overflow-hidden"
          aria-hidden="true"
        >
          <div className="ritual-scanner-processing-wash absolute inset-0" />
          <div className="ritual-scanner-processing-content absolute inset-x-0 px-4 pb-3 pt-3">
            <DocumentText
              lines={content.parsedLines}
              tone="processing"
              onLineRef={(index, node) => {
                processingLineRefs.current[index] = node
              }}
            />
          </div>
        </div>

        <div
          className="ritual-scanner-line pointer-events-none absolute inset-x-0 top-0"
          aria-hidden="true"
        >
          <div
            className="h-px w-full"
            style={{
              backgroundColor: "var(--ritual-text-muted, #7a7a7a)",
              opacity: 0.48,
            }}
          />
        </div>

        <div
          aria-hidden="true"
          className="ritual-scanner-completion pointer-events-none absolute right-3 top-1/2 z-20"
        >
          <Badge
            variant="outline"
            className="gap-1.5 border-[var(--ritual-border-default,#dad9d7)] bg-[var(--ritual-surface-raised,#fff)] px-2.5 py-1 text-[9.5px] font-medium text-[var(--ritual-text-primary,#111)] shadow-[var(--shadow-popover)]"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ritual-interactive-primary,#27251e)] text-white">
              <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
            </span>
            {content.completionLabel}
          </Badge>
        </div>
      </div>

      <style jsx>{`
        .ritual-scanner-body {
          --scan-y: 0px;
          --scan-band-top: 0px;
          --scan-band-height: 0px;
          --scan-band-offset: 0px;
          --scan-band-opacity: 0;
          --scan-line-opacity: 0;
          --parsed-opacity: 1;
          --completion-opacity: 0;
          --completion-scale: 0.96;
          --completion-shift: 5px;
        }

        .ritual-scanner-parsed {
          background: var(--ritual-surface-canvas, #fefefe);
          clip-path: inset(
            0 0 calc(100% - var(--scan-y)) 0
          );
          opacity: var(--parsed-opacity);
          will-change: clip-path, opacity;
        }

        .ritual-scanner-processing {
          top: var(--scan-band-top);
          height: var(--scan-band-height);
          opacity: var(--scan-band-opacity);
          will-change: top, height, opacity;
        }

        .ritual-scanner-processing-wash {
          background: linear-gradient(
            to bottom,
            transparent 0%,
            var(--ritual-surface-canvas, #fefefe) 38%,
            var(--ritual-surface-canvas, #fefefe) 100%
          );
        }

        .ritual-scanner-processing-content {
          top: var(--scan-band-offset);
          height: var(--scanner-body-height);
          -webkit-mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            #000 34%,
            #000 100%
          );
          mask-image: linear-gradient(
            to bottom,
            transparent 0%,
            #000 34%,
            #000 100%
          );
          will-change: top;
        }

        .ritual-scanner-line {
          opacity: var(--scan-line-opacity);
          transform: translateY(var(--scan-y));
          will-change: transform, opacity;
        }

        .ritual-scanner-completion {
          opacity: var(--completion-opacity);
          transform: translateY(
              calc(-50% + var(--completion-shift))
            )
            scale(var(--completion-scale));
          transform-origin: right center;
          will-change: transform, opacity;
        }

        @media (prefers-reduced-motion: reduce) {
          .ritual-scanner-parsed,
          .ritual-scanner-processing,
          .ritual-scanner-line,
          .ritual-scanner-completion {
            will-change: auto;
          }
        }
      `}</style>
    </div>
  )
}

export function CompactFileScanner() {
  const [activeFile, setActiveFile] = useState<FileId>("apple")
  const content = FILE_CONTENT[activeFile]

  return (
    <MenuSurface
      aria-label="Ritual file scanner preview"
      className="flex h-full min-h-[328px] w-full flex-col overflow-hidden"
    >
      <div
        className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--ritual-border-default,#dad9d7)] bg-[var(--ritual-surface-raised,#fff)] p-1"
        role="tablist"
        aria-label="Imported files"
      >
        {TABS.map((tab) => {
          const active = activeFile === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveFile(tab.id)}
              className={`relative flex h-6 min-w-0 flex-1 items-center rounded-[8px] border px-2 text-left text-[9px] leading-4 outline-none transition-colors duration-100 hover:bg-[var(--row-hover)] hover:text-[var(--ritual-text-primary,#111)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ritual-focus-ring,#306774)] ${
                active
                  ? "border-[var(--ritual-border-subtle,rgba(15,23,42,0.052))] bg-[var(--row-hover)]"
                  : "border-transparent bg-transparent"
              }`}
            >
              <span
                className={
                  active
                    ? "min-w-0 truncate font-medium text-[var(--ritual-text-primary,#111)]"
                    : "min-w-0 truncate font-normal text-[var(--ritual-text-muted,#7a7a7a)]"
                }
              >
                {tab.label}
              </span>
              {active ? (
                <span className="ml-auto pl-1 text-[11px] leading-none text-[var(--ritual-text-muted,#7a7a7a)]">
                  ×
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <ScannerBody
        key={activeFile}
        activeFile={activeFile}
        content={content}
      />
    </MenuSurface>
  )
}
