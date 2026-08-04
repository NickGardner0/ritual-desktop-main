"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import styles from "@/components/onboarding/analytics-preview.module.css"

const MUTED_WINDOW_DOT = "#CFCFCD"
const FEATURE_WINDOW_SHADOW =
  "0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 12px 40px -12px rgba(40, 30, 20, 0.12), 0 2px 8px -2px rgba(40, 30, 20, 0.06)"
const ANALYTICS_CANVAS_WIDTH = 720
const ANALYTICS_CANVAS_HEIGHT = 520
const DEFAULT_ANALYTICS_SCALE = 0.67

const sparkCards = [
  {
    title: "Sleep Duration",
    value: "6.4",
    unit: "Hours",
    absolute: "-0.9",
    trend: "down" as const,
    baseline: 13.81,
    path: "M 0,13.81 L 2.63,11.91 L 4.73,12.54 L 7.36,17.29 L 9.46,21.4 L 12.09,21.71 L 14.19,20.13 L 16.82,22.03 L 18.93,20.13 L 21.55,20.77 L 23.66,17.29 L 26.29,13.81 L 28.39,14.44 L 31.02,12.54 L 33.12,15.7 L 35.75,11.28 L 37.85,13.81 L 40.48,20.13 L 42.58,22.98 L 45.21,28.67 L 47.31,30.57 L 49.94,35 L 52.04,34.37 L 54.67,29.31 L 56.78,25.19 L 59.4,20.45 L 61.51,15.39 L 64.14,9.06 L 66.24,9.38 L 68.87,9.38 L 70.97,6.85 L 73.6,4.32 L 75.7,6.85 L 78.33,13.17 L 80.43,15.07 L 83.06,15.7 L 85.16,18.23 L 87.79,23.93 L 89.89,24.56 L 92.52,17.6 L 94.63,14.12 L 97.25,12.54 L 99.36,11.28 L 101.99,7.16 L 104.09,4 L 106.72,9.69 L 108.82,10.33 L 111.45,14.12 L 113.55,15.39 L 116.18,14.76 L 118.28,16.65 L 120.91,13.17 L 123.01,16.02 L 125.64,12.86 L 127.75,11.59 L 130.37,14.12 L 132.48,18.87 L 135.11,23.61 L 137.21,17.6 L 139.84,17.92 L 141.94,19.5 L 144.57,16.97 L 146.67,11.28 L 149.3,10.64 L 151.4,11.28 L 154.03,14.76 L 156.13,14.76 L 158.76,16.34 L 160.86,21.08 L 163.49,16.34 L 165.6,15.7 L 168.22,13.81 L 170.33,16.02 L 172.96,17.29 L 175.06,15.7 L 177.69,19.5 L 179.79,23.3 L 182.42,23.3 L 184.52,20.13 L 187.15,18.55 L 189.25,21.08 L 191.88,23.3 L 193.98,22.35 L 196.61,20.13 L 198.71,19.82 L 201.34,16.02 L 203.45,12.54 L 206.07,13.81 L 208.18,15.7 L 210.81,16.34 L 212.91,18.87 L 215.54,26.14 L 217.64,28.99 L 220.27,28.99 L 222.37,28.99 L 225,32.79",
  },
  {
    title: "Spending",
    value: "102.7",
    unit: "Dollars",
    absolute: "+8.6",
    trend: "up" as const,
    baseline: 23.15,
    path: "M 0,23.15 L 2.11,25.88 L 4.74,27.1 L 6.85,25.88 L 9.48,24.97 L 11.59,25.27 L 14.23,23.45 L 16.33,22.54 L 18.97,26.19 L 21.08,24.06 L 23.71,20.72 L 25.82,17.68 L 28.45,16.76 L 30.56,14.33 L 33.2,13.42 L 35.3,9.77 L 37.94,8.56 L 40.05,6.43 L 42.68,8.56 L 44.79,12.21 L 47.42,15.55 L 49.53,18.89 L 52.17,19.8 L 54.27,16.76 L 56.91,14.33 L 59.02,13.12 L 61.65,11.9 L 63.76,14.33 L 66.39,11.9 L 68.5,12.21 L 71.14,11.29 L 73.24,8.25 L 75.88,8.86 L 77.99,14.64 L 80.62,14.94 L 82.73,11.9 L 85.36,10.69 L 87.47,7.34 L 90.11,4 L 92.21,8.25 L 94.85,16.46 L 96.96,20.41 L 99.59,18.89 L 101.7,17.37 L 104.33,15.85 L 106.44,12.21 L 109.07,10.99 L 111.18,13.42 L 113.82,11.9 L 115.93,15.25 L 118.56,19.2 L 120.67,18.28 L 123.3,22.54 L 125.41,24.06 L 128.04,21.02 L 130.15,18.59 L 132.79,22.54 L 134.89,21.32 L 137.53,18.59 L 139.64,21.63 L 142.27,21.63 L 144.38,17.07 L 147.01,14.94 L 149.12,14.64 L 151.76,13.42 L 153.86,16.16 L 156.5,22.24 L 158.61,24.97 L 161.24,23.15 L 163.35,25.58 L 165.98,20.72 L 168.09,19.8 L 170.73,17.37 L 172.83,17.68 L 175.47,14.33 L 177.58,12.81 L 180.21,9.47 L 182.32,9.47 L 184.95,9.47 L 187.06,9.77 L 189.7,8.25 L 191.8,7.04 L 194.44,9.77 L 196.55,13.73 L 199.18,16.76 L 201.29,23.75 L 203.92,29.53 L 206.03,29.83 L 208.67,30.75 L 210.77,33.78 L 213.41,35 L 215.52,33.48 L 218.15,28.62 L 220.26,27.71 L 222.89,26.79 L 225,24.06",
  },
  {
    title: "iPhone Time",
    value: "13.3",
    unit: "Hours",
    absolute: "-3.3",
    trend: "down" as const,
    baseline: 27.1,
    path: "M 0,27.1 L 2.63,25.27 L 4.73,24.06 L 7.36,21.93 L 9.46,18.89 L 12.09,15.85 L 14.19,13.12 L 16.82,9.77 L 18.93,7.34 L 21.55,4.61 L 23.66,4 L 26.29,4 L 28.39,5.52 L 31.02,7.04 L 33.12,8.25 L 35.75,10.38 L 37.85,14.03 L 40.48,16.76 L 42.58,17.37 L 45.21,16.76 L 47.31,17.98 L 49.94,18.59 L 52.04,18.59 L 54.67,13.42 L 56.78,8.86 L 59.4,6.43 L 61.51,7.04 L 64.14,8.56 L 66.24,11.29 L 68.87,16.46 L 70.97,22.24 L 73.6,29.23 L 75.7,31.96 L 78.33,32.57 L 80.43,31.35 L 83.06,29.23 L 85.16,27.71 L 87.79,25.88 L 89.89,24.67 L 92.52,23.75 L 94.63,23.45 L 97.25,22.84 L 99.36,21.93 L 101.99,20.41 L 104.09,19.5 L 106.72,20.41 L 108.82,21.93 L 111.45,24.67 L 113.55,26.49 L 116.18,29.53 L 118.28,32.26 L 120.91,35 L 123.01,34.7 L 125.64,33.78 L 127.75,32.57 L 130.37,31.35 L 132.48,30.14 L 135.11,28.01 L 137.21,26.49 L 139.84,26.49 L 141.94,27.1 L 144.57,28.92 L 146.67,30.14 L 149.3,31.66 L 151.4,31.66 L 154.03,30.75 L 156.13,28.92 L 158.76,27.1 L 160.86,25.88 L 163.49,24.06 L 165.6,23.15 L 168.22,23.15 L 170.33,24.06 L 172.96,25.27 L 175.06,25.27 L 177.69,25.27 L 179.79,24.97 L 182.42,23.45 L 184.52,22.24 L 187.15,20.72 L 189.25,19.5 L 191.88,19.5 L 193.98,20.11 L 196.61,22.54 L 198.71,24.97 L 201.34,27.71 L 203.45,29.53 L 206.07,29.83 L 208.18,29.23 L 210.81,28.62 L 212.91,28.31 L 215.54,28.62 L 217.64,28.92 L 220.27,30.14 L 222.37,31.66 L 225,34.39",
  },
  {
    title: "Heart Rate",
    value: "110.7",
    unit: "BPM",
    absolute: "+2.1",
    trend: "up" as const,
    baseline: 30.96,
    path: "M 0,30.96 L 2.11,28.26 L 4.74,25.57 L 6.85,22.87 L 9.48,23.21 L 11.59,21.86 L 14.23,20.85 L 16.33,20.17 L 18.97,25.57 L 21.08,30.96 L 23.71,33.32 L 25.82,35 L 28.45,34.33 L 30.56,32.98 L 33.2,25.9 L 35.3,21.52 L 37.94,17.48 L 40.05,18.83 L 42.68,12.76 L 44.79,6.7 L 47.42,4 L 49.53,5.35 L 52.17,12.09 L 54.27,12.76 L 56.91,12.42 L 59.02,16.8 L 61.65,15.79 L 63.76,17.82 L 66.39,19.84 L 68.5,17.48 L 71.14,16.47 L 73.24,14.11 L 75.88,15.79 L 77.99,15.46 L 80.62,15.12 L 82.73,14.78 L 85.36,14.78 L 87.47,15.79 L 90.11,16.47 L 92.21,19.5 L 94.85,19.84 L 96.96,18.83 L 99.59,14.78 L 101.7,14.78 L 104.33,16.13 L 106.44,17.82 L 109.07,16.8 L 111.18,16.8 L 113.82,18.49 L 115.93,19.5 L 118.56,19.5 L 120.67,18.15 L 123.3,15.12 L 125.41,15.46 L 128.04,15.79 L 130.15,18.83 L 132.79,18.83 L 134.89,19.5 L 137.53,15.46 L 139.64,14.78 L 142.27,14.11 L 144.38,13.43 L 147.01,10.74 L 149.12,12.76 L 151.76,21.18 L 153.86,28.93 L 156.5,35 L 158.61,34.66 L 161.24,33.99 L 163.35,35 L 165.98,34.66 L 168.09,32.64 L 170.73,27.59 L 172.83,24.22 L 175.47,25.57 L 177.58,27.25 L 180.21,32.3 L 182.32,32.3 L 184.95,31.97 L 187.06,31.63 L 189.7,30.96 L 191.8,29.61 L 194.44,29.61 L 196.55,29.95 L 199.18,32.3 L 201.29,32.98 L 203.92,32.3 L 206.03,30.28 L 208.67,28.93 L 210.77,28.6 L 213.41,29.27 L 215.52,29.95 L 218.15,30.28 L 220.26,29.95 L 222.89,28.6 L 225,27.92",
  },
] as const

const habitRows = [
  ["Caffeine Consumption", "4,820 MG", -3.0],
  ["Sleep Duration", "219 Hours", 2.4],
  ["Nicotine Consumption", "146 MG", -8.1],
  ["Computer Time", "126.4 Hours", 6.5],
  ["Daily Reading", "245 Pages", 12],
  ["Workout", "18.5 Hours", -4.6],
  ["iPhone Time", "96.2 Hours", -9.5],
  ["Car miles", "642 Miles", 6.1],
] as const

const appRows = [
  ["Google Chrome", "45.2h", 8.6],
  ["Codex", "32.4h", 14],
  ["x.com", "12.8h", -11],
  ["Ritual", "8.6h", 5.2],
  ["Paper", "3.2h", 2.1],
  ["Finder", "5.4h", -3.8],
  ["Obsidian", "18.3h", -8.0],
  ["loginwindow", "2.1h", -4.2],
] as const

const analyticsTabs = ["All", "Health", "Digital", "Productivity", "Experiments"] as const
const rangeOptions = ["12H", "1D", "1W", "1M", "3M", "6M", "1Y"] as const

function formatAmount(n: number, decimals: number): string {
  const fixed = n.toFixed(decimals)
  const [intPart, decPart] = fixed.split(".")
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas
}

function RollingDigit({ digit, delay }: { digit: number; delay: number }) {
  return (
    <span
      className="inline-block shrink-0 overflow-hidden tabular-nums"
      style={{ height: "1em", width: "0.6em", lineHeight: "1em" }}
    >
      <span
        className="block"
        style={{
          transform: `translateY(${-digit}em)`,
          transition: `transform 600ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
          willChange: "transform",
        }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="block text-center" style={{ height: "1em", lineHeight: "1em" }}>
            {i}
          </span>
        ))}
      </span>
    </span>
  )
}

function AnimatedAmount({ value }: { value: string }) {
  const parts = value.split(/([,.])/g).filter(Boolean)
  let digitCount = 0

  return (
    <span className="inline-flex items-center tabular-nums" style={{ height: "1em", lineHeight: "1em" }}>
      {parts.map((part, i) => {
        if (part === "," || part === ".") {
          return (
            <span
              key={`sep-${i}`}
              className="shrink-0 tabular-nums"
              style={{ width: part === "," ? "0.32em" : "0.26em", textAlign: "center" }}
            >
              {part}
            </span>
          )
        }
        return (
          <span key={`grp-${i}`} className="inline-flex shrink-0 overflow-hidden" style={{ height: "1em" }}>
            {part.split("").map((d, j) => (
              <RollingDigit key={j} digit={parseInt(d, 10)} delay={digitCount++ * 18} />
            ))}
          </span>
        )
      })}
    </span>
  )
}

function parseMetricValue(raw: string): { num: number; decimals: number; suffix: string } {
  const match = raw.match(/^([\d,]+(?:\.\d+)?)(.*)$/)
  if (!match) return { num: 0, decimals: 0, suffix: raw }
  const numStr = match[1].replace(/,/g, "")
  const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0
  return { num: parseFloat(numStr), decimals, suffix: match[2] }
}

function driftValues(values: number[], bases: number[]): number[] {
  const next = [...values]
  const updateCount = Math.floor(next.length * 0.7) + Math.floor(Math.random() * 3)
  const indices = new Set<number>()
  while (indices.size < updateCount && indices.size < next.length) {
    indices.add(Math.floor(Math.random() * next.length))
  }
  indices.forEach((idx) => {
    const base = bases[idx]
    const band = 0.08
    const change = base * (0.003 + Math.random() * 0.022)
    const sign = Math.random() > 0.5 ? 1 : -1
    next[idx] = Math.max(base * (1 - band), Math.min(base * (1 + band), next[idx] + sign * change))
  })
  return next
}

function parseRows(rows: readonly (readonly [string, string, number])[]) {
  return rows.map(([name, value, change]) => {
    const parsed = parseMetricValue(value)
    const baseline = parsed.num / (1 + change / 100)
    return { name, change, baseline, ...parsed }
  })
}

const habitMetrics = parseRows(habitRows)
const appMetrics = parseRows(appRows)
const sparkBases = sparkCards.map((card) => parseFloat(card.value))
const sparkBaselines = sparkCards.map((card) => parseFloat(card.value) - parseFloat(card.absolute))

function WindowTrafficLights() {
  return (
    <div className="flex items-center gap-[6px]">
      {Array.from({ length: 3 }).map((_, index) => (
        <span
          key={index}
          className="block h-[10px] w-[10px] shrink-0 rounded-full"
          style={{
            backgroundColor: MUTED_WINDOW_DOT,
            boxShadow: "inset 0 0 0 0.5px rgba(0, 0, 0, 0.08)",
          }}
          aria-hidden
        />
      ))}
    </div>
  )
}

function TrendArrow({ trend }: { trend: "up" | "down" }) {
  const isUp = trend === "up"
  return (
    <svg width="12" height="12" viewBox="0 0 16.8 16.8" fill="none" aria-hidden="true">
      <path
        d={isUp ? "M3.2 12.2L12 3.4M12 3.4H6.2M12 3.4V9.2" : "M3.2 4.6L12 13.4M12 13.4H6.2M12 13.4V7.6"}
        stroke={isUp ? "#136A22" : "#A23544"}
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Sparkline({ card, index }: { card: (typeof sparkCards)[number]; index: number }) {
  const color = card.trend === "up" ? "#136A22" : "#A23544"
  const gradientId = `onboarding-analytics-spark-${index}`
  const areaPath = `${card.path} L 225,${card.baseline} L 0,${card.baseline} Z`

  return (
    <svg
      width="100%"
      height="41"
      viewBox="0 0 225 41"
      preserveAspectRatio="none"
      className="h-[30px] shrink-0 overflow-hidden"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="60%" stopColor={color} stopOpacity="0.08" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <line x1="0" y1={card.baseline} x2="225" y2={card.baseline} stroke="#27251E47" strokeDasharray="3.5 3" />
      <path d={card.path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SparkMetricCard({
  card,
  index,
  value,
}: {
  card: (typeof sparkCards)[number]
  index: number
  value: number
}) {
  const trendColor = card.trend === "up" ? "text-[#136A22]" : "text-[#A23544]"
  const decimals = card.value.includes(".") ? card.value.split(".")[1].length : 0
  const live = value ?? parseFloat(card.value)
  const baseline = parseFloat(card.value) - parseFloat(card.absolute)
  const liveAbsolute = live - baseline
  const livePctAbs = baseline !== 0 ? Math.abs((liveAbsolute / baseline) * 100) : 0
  const pctDisplay = livePctAbs >= 10 ? Math.round(livePctAbs) : livePctAbs.toFixed(1)
  const absoluteDisplay = `${liveAbsolute >= 0 ? "+" : "-"}${Math.abs(liveAbsolute).toFixed(1)}`

  return (
    <div
      className={cn(
        styles.sparkCard,
        "flex h-[84px] min-w-0 flex-col gap-1 overflow-hidden rounded-md border border-[rgba(39,37,30,0.10)] bg-[#FEFEFE] px-0 py-[2px]",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_60px] items-start gap-x-2 px-3 pb-[2px] pt-[2px]">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-[16px] text-[#27251E]">{card.title}</div>
          <div className="mt-px flex min-w-0 items-baseline gap-1 text-[11px] font-medium leading-[14px] text-[rgba(39,37,30,0.62)]">
            <AnimatedAmount value={formatAmount(live, decimals)} />
            <span className="truncate">{card.unit}</span>
          </div>
        </div>
        <div className="flex min-w-[60px] shrink-0 flex-col items-end text-right">
          <div className={cn("flex items-center justify-end gap-px text-[12px] font-medium leading-[16px] tabular-nums", trendColor)}>
            <TrendArrow trend={card.trend} />
            <span>{pctDisplay}%</span>
          </div>
          <div className="mt-px min-h-[14px] text-[10.75px] font-medium leading-[14px] text-[rgba(39,37,30,0.62)] tabular-nums">
            {absoluteDisplay}
          </div>
        </div>
      </div>
      <div className="min-h-0 w-full flex-1 pb-0 pt-0">
        <Sparkline card={card} index={index} />
      </div>
    </div>
  )
}

function AnalyticsChangeBadge({ change }: { change: number }) {
  if (Math.abs(change) < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium leading-[14px] tabular-nums bg-[rgba(39,37,30,0.06)] text-[rgba(39,37,30,0.45)]">
        — 0.0%
      </span>
    )
  }

  const isUp = change > 0
  const abs = Math.abs(change)
  const display = abs >= 100 ? Math.round(abs) : abs >= 10 ? Math.round(abs) : abs.toFixed(1)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium leading-[14px] tabular-nums",
        isUp ? "bg-[rgba(19,106,34,0.08)] text-[#136A22]" : "bg-[rgba(162,53,68,0.08)] text-[#A23544]",
      )}
    >
      {isUp ? "↗" : "↘"} {display}%
    </span>
  )
}

function AnalyticsBarListCard({
  title,
  inactiveTitle,
  rows,
  values,
}: {
  title: string
  inactiveTitle: string
  rows: { name: string; change: number; baseline: number; num: number; decimals: number; suffix: string }[]
  values: number[]
}) {
  return (
    <div
      className={cn(
        styles.listCard,
        "flex h-full flex-col overflow-hidden rounded-md border border-[rgba(39,37,30,0.08)] bg-[#FEFEFE] shadow-[0_1px_2px_rgba(0,0,0,0.02)]",
      )}
    >
      <div className="px-4 pb-1.5 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0">
            <span className="pr-3 py-1 text-[13px] font-medium text-[#27251E]">{title}</span>
            <span className="pr-3 py-1 text-[13px] font-normal text-[rgba(39,37,30,0.40)]">{inactiveTitle}</span>
          </div>
          <div className="flex items-center gap-0">
            {rangeOptions.map((range) => (
              <span
                key={range}
                className={cn(
                  "px-1.5 py-0.5 text-[11px] transition-colors",
                  range === "1M" ? "font-medium text-[#27251E]" : "font-normal text-[rgba(39,37,30,0.35)]",
                )}
              >
                {range}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col overflow-hidden">
        {rows.map((row, idx) => {
          const live = values[idx] ?? row.num
          const liveChange = ((live - row.baseline) / row.baseline) * 100
          return (
            <div
              key={row.name}
              className={cn(styles.listRow, "flex cursor-default select-none items-center px-4 py-[3px]")}
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-normal text-[#27251E]">{row.name}</span>
              <span className="flex min-w-[90px] shrink-0 items-baseline justify-end text-[12.5px] font-normal tabular-nums text-[#27251E]">
                <AnimatedAmount value={formatAmount(live, row.decimals)} />
                <span style={{ whiteSpace: "pre" }}>{row.suffix}</span>
              </span>
              <span className="ml-1.5 min-w-[56px] shrink-0 text-right">
                <AnalyticsChangeBadge change={liveChange} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AnalyticsPreview() {
  const frameRef = useRef<HTMLDivElement>(null)
  const [previewScale, setPreviewScale] = useState(DEFAULT_ANALYTICS_SCALE)
  const [sparkValues, setSparkValues] = useState(() => [...sparkBases])
  const [habitValues, setHabitValues] = useState(() => habitMetrics.map((m) => m.num))
  const [appValues, setAppValues] = useState(() => appMetrics.map((m) => m.num))

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const fitPreview = () => {
      const { width, height } = frame.getBoundingClientRect()
      const nextScale = Math.min(
        1,
        width / ANALYTICS_CANVAS_WIDTH,
        height / ANALYTICS_CANVAS_HEIGHT,
      )

      if (!Number.isFinite(nextScale) || nextScale <= 0) return

      setPreviewScale((currentScale) =>
        Math.abs(currentScale - nextScale) < 0.001
          ? currentScale
          : nextScale,
      )
    }

    fitPreview()
    const resizeObserver = new ResizeObserver(fitPreview)
    resizeObserver.observe(frame)

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) return

    const interval = window.setInterval(() => {
      setSparkValues((prev) =>
        driftValues(prev, sparkBases).map((v, i) =>
          sparkCards[i].trend === "up"
            ? Math.max(v, sparkBaselines[i] * 1.003)
            : Math.min(v, sparkBaselines[i] * 0.997),
        ),
      )
      setHabitValues((prev) => driftValues(prev, habitMetrics.map((m) => m.num)))
      setAppValues((prev) => driftValues(prev, appMetrics.map((m) => m.num)))
    }, 900)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <div
      ref={frameRef}
      className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
      data-testid="analytics-preview-frame"
    >
      <div
        className="relative shrink-0"
        style={{
          width: ANALYTICS_CANVAS_WIDTH * previewScale,
          height: ANALYTICS_CANVAS_HEIGHT * previewScale,
        }}
      >
        <div
          aria-label="Analytics preview"
          className="absolute left-0 top-0 flex h-[520px] w-[720px] flex-col overflow-hidden rounded-md border border-[#E4E4E7] bg-[#FEFEFE] text-[#27251E]"
          style={{
            boxShadow: FEATURE_WINDOW_SHADOW,
            transform: `scale(${previewScale})`,
            transformOrigin: "top left",
          }}
        >
          <div className="relative flex h-8 shrink-0 items-center border-b border-[#E4E4E7] bg-[#FBFBFA] px-3">
            <WindowTrafficLights />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-[12px] font-medium text-[#A8A4A0]">Ritual</span>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-4">
            <div className="shrink-0 border-b border-[rgba(39,37,30,0.08)]">
              <div className="flex h-[42px] items-end gap-8">
                {analyticsTabs.map((tab) => {
                  const active = tab === "All"
                  return (
                    <span
                      key={tab}
                      className={cn(
                        "relative pb-2 text-[13.5px] leading-none",
                        active ? "font-medium text-[#27251E]" : "font-normal text-[rgba(39,37,30,0.42)]",
                      )}
                    >
                      {tab}
                      {active ? (
                        <span
                          className="absolute bottom-0 left-0 h-[2px] w-[17px] rounded-full bg-[#27251E]"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-4 gap-[6px] pt-[18px]">
              {sparkCards.map((card, index) => (
                <SparkMetricCard key={card.title} card={card} index={index} value={sparkValues[index]} />
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden pt-6">
              <div className="grid h-full grid-cols-2 gap-[6px]">
                <AnalyticsBarListCard
                  title="Habits"
                  inactiveTitle="Streaks"
                  rows={habitMetrics}
                  values={habitValues}
                />
                <AnalyticsBarListCard
                  title="Apps"
                  inactiveTitle="Websites"
                  rows={appMetrics}
                  values={appValues}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
