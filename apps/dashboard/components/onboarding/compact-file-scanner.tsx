"use client"

import { useEffect, useMemo, useRef, useState } from "react"

const TEXT_COLOR = "#242321"
const WINDOW_BACKGROUND = "#fefefe"
const SCAN_ACCENT = "#275c56"
const SCRAMBLE_COLOR = "#9a8d80"
const SCRAMBLE_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_#"

type FileId = "apple" | "whoop" | "oura"

type FileContent = {
  initialLines: string[]
  finalLines: string[]
}

const TABS: Array<{ id: FileId; label: string }> = [
  { id: "apple", label: "apple_health_export.xml" },
  { id: "whoop", label: "whoop_import.csv" },
  { id: "oura", label: "oura_ring_import.csv" },
]

const APPLE_HEALTH_RAW_LINES = [
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
  '  <Workout workoutActivityType="HKWorkoutActivityTypeRunning">',
  '    <MetadataEntry key="HKElevationAscended" value="42"/>',
  '    <MetadataEntry key="HKIndoorWorkout" value="0"/>',
  "  </Workout>",
  '  <CorrelationMetric type="steps_to_hrv" coefficient="0.41"/>',
  "</HealthData>",
]

const APPLE_HEALTH_PARSED_LINES = [
  "Apple Health Export",
  "",
  "Parsed daily summary",
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
  "Normalized records",
  "",
  "- Activity window: 2026-05-14 08:00-09:00 EDT",
  "- Sleep window: 2026-05-13 23:18-2026-05-14 06:52 EDT",
  "- Workout type: walking",
  "- Export rows parsed: 2,418",
]

const WHOOP_LINES = [
  "whoop_import = pl.DataFrame(",
  "shape: (16, 8)",
  "",
  "   date        recovery  strain  hrv_ms  rhr  sleep_h  calories  source",
  "0  2026-05-03        74    10.8      58   51     7.42      2380  whoop",
  "1  2026-05-04        81     8.7      64   49     7.88      2294  whoop",
  "2  2026-05-05        62    14.1      49   56     6.21      2718  whoop",
  "3  2026-05-06        88     6.3      71   47     8.16      2206  whoop",
  "4  2026-05-07        69    12.4      55   53     6.92      2540  whoop",
  "5  2026-05-08        77    11.2      61   50     7.35      2467  whoop",
  "6  2026-05-09        90     5.9      74   46     8.44      2188  whoop",
  "7  2026-05-10        58    15.8      43   59     5.88      2891  whoop",
  "8  2026-05-11        73     9.6      57   52     7.10      2345  whoop",
  "9  2026-05-12        85     7.4      68   48     8.02      2240  whoop",
  "10 2026-05-13        71    12.9      54   54     6.74      2612  whoop",
  "11 2026-05-14        79     9.1      63   50     7.61      2377  whoop",
  "12 2026-05-15        83     8.5      66   49     7.94      2316  whoop",
  "13 2026-05-16        67    13.7      52   55     6.48      2669  whoop",
  "14 2026-05-17        92     5.4      76   45     8.63      2142  whoop",
  "15 2026-05-18        76    10.2      60   51     7.27      2431  whoop",
  "",
  "dtypes: [date, i64, f64, i64, i64, f64, i64, str]",
  "scan_status='parsed'  rows=16  nulls=0",
]

const OURA_LINES = [
  "oura_ring_import = pd.DataFrame.from_records([...])",
  "",
  "          day  readiness  sleep_score  rem_h  deep_h  temp_dev  latency_m  source",
  "0  2026-05-03         82           86   1.44    1.31     -0.10         11    oura",
  "1  2026-05-04         88           91   1.62    1.48     -0.06          9    oura",
  "2  2026-05-05         70           74   1.05    0.92      0.14         18    oura",
  "3  2026-05-06         91           93   1.73    1.55     -0.12          8    oura",
  "4  2026-05-07         76           80   1.22    1.08      0.03         15    oura",
  "5  2026-05-08         84           87   1.51    1.34     -0.04         10    oura",
  "6  2026-05-09         93           95   1.81    1.66     -0.16          7    oura",
  "7  2026-05-10         64           68   0.88    0.71      0.21         24    oura",
  "8  2026-05-11         79           82   1.36    1.19      0.02         14    oura",
  "9  2026-05-12         89           90   1.69    1.50     -0.09          9    oura",
  "10 2026-05-13         75           78   1.18    1.02      0.07         17    oura",
  "11 2026-05-14         86           88   1.57    1.43     -0.05         10    oura",
  "12 2026-05-15         90           92   1.74    1.52     -0.11          8    oura",
  "13 2026-05-16         72           76   1.13    0.98      0.10         19    oura",
  "14 2026-05-17         94           96   1.86    1.70     -0.18          6    oura",
  "15 2026-05-18         83           85   1.47    1.28     -0.02         12    oura",
  "",
  "[16 rows x 8 columns]",
  "scan_status='parsed'  rows=16  duplicate_days=0",
]

const FILE_CONTENT: Record<FileId, FileContent> = {
  apple: {
    initialLines: APPLE_HEALTH_RAW_LINES,
    finalLines: APPLE_HEALTH_PARSED_LINES,
  },
  whoop: {
    initialLines: WHOOP_LINES,
    finalLines: WHOOP_LINES,
  },
  oura: {
    initialLines: OURA_LINES,
    finalLines: OURA_LINES,
  },
}

function scrambleText(
  initialText: string,
  finalText: string,
  progress: number,
  lineIndex: number,
) {
  if (progress >= 1) return finalText || " "

  const revealCount = Math.floor(finalText.length * progress)
  const frame = Math.floor(progress * 18)

  return Array.from(finalText, (character, characterIndex) => {
    if (characterIndex < revealCount || character === " ") return character

    const initialCharacter = initialText[characterIndex]
    if (progress < 0.08 && initialCharacter) return initialCharacter

    const characterIndexInSet =
      (characterIndex * 13 + lineIndex * 7 + frame * 5) %
      SCRAMBLE_CHARACTERS.length
    return SCRAMBLE_CHARACTERS[characterIndexInSet]
  }).join("")
}

function applyLineContent(
  node: HTMLDivElement,
  text: string,
  color = TEXT_COLOR,
  opacity = "1",
) {
  node.textContent = text || " "
  node.style.color = color
  node.style.opacity = opacity
}

function ScannerBody({ activeFile }: { activeFile: FileId }) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scanLineRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<Array<HTMLDivElement | null>>([])
  const animationFrames = useRef<number[]>([])
  const timers = useRef<number[]>([])
  const content = useMemo(() => FILE_CONTENT[activeFile], [activeFile])
  const displayLines = useMemo(() => {
    const lineCount = Math.max(
      content.initialLines.length,
      content.finalLines.length,
    )
    return Array.from({ length: lineCount }, (_, index) => ({
      initialText: content.initialLines[index] ?? "",
      finalText: content.finalLines[index] ?? "",
    }))
  }, [content])

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    const clearCycle = () => {
      animationFrames.current.forEach((frame) =>
        window.cancelAnimationFrame(frame),
      )
      animationFrames.current = []
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current = []
    }

    const setLines = (key: "initialText" | "finalText") => {
      lineRefs.current.forEach((node, index) => {
        if (!node) return
        applyLineContent(node, displayLines[index]?.[key] ?? "")
      })
    }

    if (reducedMotion) {
      setLines("finalText")
      return clearCycle
    }

    const animateLine = (
      node: HTMLDivElement,
      initialText: string,
      finalText: string,
      lineIndex: number,
    ) => {
      const startedAt = performance.now()

      const tick = (now: number) => {
        const progress = Math.min((now - startedAt) / 620, 1)
        applyLineContent(
          node,
          scrambleText(initialText, finalText, progress, lineIndex),
          progress === 1 ? TEXT_COLOR : SCRAMBLE_COLOR,
          progress === 1 ? "1" : "0.58",
        )

        if (progress < 1) {
          const frame = window.requestAnimationFrame(tick)
          animationFrames.current.push(frame)
        }
      }

      const frame = window.requestAnimationFrame(tick)
      animationFrames.current.push(frame)
    }

    const runCycle = () => {
      clearCycle()
      setLines("initialText")

      if (scanLineRef.current && bodyRef.current) {
        scanLineRef.current.style.animation = "none"
        scanLineRef.current.style.opacity = "1"
        scanLineRef.current.style.setProperty(
          "--scan-distance",
          `${bodyRef.current.clientHeight}px`,
        )
        void scanLineRef.current.offsetWidth
        scanLineRef.current.style.animation =
          "ritual-compact-file-scan 2600ms cubic-bezier(0.65, 0, 0.35, 1) forwards"
      }

      displayLines.forEach((line, index) => {
        const node = lineRefs.current[index]
        if (!node || (!line.initialText && !line.finalText)) return

        const timer = window.setTimeout(() => {
          animateLine(node, line.initialText, line.finalText, index)
        }, 180 + index * 54)
        timers.current.push(timer)
      })
    }

    runCycle()
    const loopTimer = window.setInterval(runCycle, 4400)

    return () => {
      window.clearInterval(loopTimer)
      clearCycle()
    }
  }, [activeFile, displayLines])

  return (
    <div
      ref={bodyRef}
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ backgroundColor: WINDOW_BACKGROUND }}
    >
      <div className="h-full overflow-hidden px-5 pb-3 pt-4">
        <code
          className="block text-[9px] font-normal leading-[13px] [font-variant-ligatures:none]"
          style={{
            color: TEXT_COLOR,
            fontFamily:
              '"Server Mono", "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
            WebkitFontSmoothing: "antialiased",
          }}
        >
          {displayLines.map((line, index) => (
            <div
              key={`${activeFile}-${index}`}
              ref={(node) => {
                lineRefs.current[index] = node
              }}
              className="h-[13px] truncate whitespace-pre"
            >
              {line.initialText || " "}
            </div>
          ))}
        </code>
      </div>

      <div
        ref={scanLineRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 opacity-0"
      >
        <div className="h-px w-full" style={{ backgroundColor: SCAN_ACCENT }} />
      </div>

      <style jsx>{`
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
            transform: translateY(var(--scan-distance));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          div[aria-hidden="true"] {
            animation: none !important;
            opacity: 0 !important;
          }
        }
      `}</style>
    </div>
  )
}

export function CompactFileScanner() {
  const [activeFile, setActiveFile] = useState<FileId>("apple")

  return (
    <div
      aria-label="Ritual file scanner preview"
      className="flex h-full min-h-[318px] w-full flex-col overflow-hidden rounded-[10px] border border-[#e4e4e7] bg-[#fefefe] shadow-[0_12px_28px_rgba(24,24,27,0.07)]"
    >
      <div className="relative flex h-8 shrink-0 items-center border-b border-[#e4e4e7] bg-[#fbfbfa] px-3">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full border border-black/10 bg-[#d2d2d1]" />
          <span className="h-2.5 w-2.5 rounded-full border border-black/10 bg-[#d2d2d1]" />
          <span className="h-2.5 w-2.5 rounded-full border border-black/10 bg-[#d2d2d1]" />
        </div>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-medium text-[#a8a4a0]">
          Ritual
        </span>
      </div>

      <div
        className="flex h-[30px] shrink-0 overflow-hidden border-b border-[#e4e4e7] bg-[#fefefe]"
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
              className="flex min-w-0 flex-1 items-center border-r border-[#e4e4e7] px-2.5 text-left text-[10.5px] leading-4 outline-none transition-colors last:border-r-0 hover:text-[#242321] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7a746d]/30"
            >
              <span
                className={
                  active
                    ? "min-w-0 truncate text-[#242321]"
                    : "min-w-0 truncate text-[#77736d]"
                }
              >
                {tab.label}
              </span>
              {active ? (
                <span className="ml-auto pl-1.5 text-[14px] leading-none text-[#8d8983]">
                  ×
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <ScannerBody activeFile={activeFile} />
    </div>
  )
}
