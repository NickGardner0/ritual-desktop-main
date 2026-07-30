"use client"

import * as React from "react"
import { Input } from "@ritual/ui/input"
import { MenuSurface } from "@ritual/ui/menu"

import { cn } from "@ritual/ui/cn"

type Source = {
  id: string
  name: string
  label: string
}

const SOURCES: Source[] = [
  { id: "apple-health", name: "Apple Health", label: "Health & activity" },
  { id: "whoop", name: "WHOOP", label: "Recovery & strain" },
  { id: "oura", name: "Oura", label: "Sleep & readiness" },
  { id: "garmin", name: "Garmin", label: "Workouts & activity" },
  { id: "fitbit", name: "Fitbit", label: "Fitness & sleep" },
  { id: "screen-time", name: "Screen Time", label: "iPhone usage" },
  { id: "computer-use", name: "Computer Use", label: "Desktop activity" },
  { id: "imessage", name: "iMessage", label: "Calorie tracking" },
  { id: "plaid", name: "Plaid", label: "Spending tracking" },
  { id: "tesla", name: "Tesla", label: "Miles driven" },
  { id: "gmail", name: "Gmail", label: "Emails sent" },
]

const DEMO_SEQUENCE = [
  { id: "apple-health", delay: 600 },
  { id: "whoop", delay: 1100 },
  { id: "oura", delay: 1600 },
] as const

function SourceToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${checked ? "Disconnect" : "Connect"} ${label}`}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
      className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1"
      style={{
        backgroundColor: checked
          ? "var(--ritual-status-success, #34785c)"
          : "#d4d4d8",
      }}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

export function SourcesPicker() {
  const [search, setSearch] = React.useState("")
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({})
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    if (reducedMotion) {
      const animationFrame = window.requestAnimationFrame(() => {
        setEnabled({
          "apple-health": true,
          whoop: true,
          oura: true,
        })
      })
      return () => window.cancelAnimationFrame(animationFrame)
    }

    const timers = DEMO_SEQUENCE.map(({ id, delay }) =>
      window.setTimeout(() => {
        setEnabled((current) => ({ ...current, [id]: true }))
      }, delay),
    )

    const scrollTimer = window.setTimeout(() => {
      const scrollArea = scrollRef.current
      if (!scrollArea) return
      scrollArea.scrollTo({
        top: scrollArea.scrollHeight - scrollArea.clientHeight,
        behavior: "smooth",
      })
    }, 2300)

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      window.clearTimeout(scrollTimer)
    }
  }, [])

  const filteredSources = SOURCES.filter((source) => {
    const query = search.trim().toLowerCase()
    return (
      source.name.toLowerCase().includes(query) ||
      source.label.toLowerCase().includes(query)
    )
  })

  function toggleSource(id: string) {
    setEnabled((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <MenuSurface className="w-full max-w-[390px]">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search sources"
        aria-label="Search sources"
        density="compact"
        className="h-10 rounded-none border-0 bg-transparent px-3 py-0 text-[13px] shadow-none ring-offset-0 placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      <div className="h-px bg-[var(--divider-subtle)]" />

      <div
        ref={scrollRef}
        className="ritual-sources-scroll max-h-[272px] overflow-y-scroll px-1 py-0.5"
      >
        {filteredSources.length ? (
          filteredSources.map((source) => (
            <div
              key={source.id}
              className="flex h-[34px] items-center justify-between gap-3 rounded-[8px] px-2 text-left transition-colors duration-100 hover:bg-[var(--row-hover)]"
            >
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 text-[13px] font-medium leading-none text-[var(--text-primary)]">
                  {source.name}
                </span>
                <span className="truncate text-[13px] font-normal leading-none text-[var(--text-muted)]">
                  {source.label}
                </span>
              </div>
              <SourceToggle
                checked={Boolean(enabled[source.id])}
                label={source.name}
                onChange={() => toggleSource(source.id)}
              />
            </div>
          ))
        ) : (
          <p className="px-2 py-5 text-center text-[13px] text-[var(--text-muted)]">
            No sources found
          </p>
        )}
      </div>

      <div className="h-px bg-[var(--divider-subtle)]" />

      <button
        type="button"
        className="flex h-[34px] w-full items-center px-3 text-[13px] font-normal text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ritual-focus-ring)]"
      >
        Add Source
      </button>

      <style jsx>{`
        .ritual-sources-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.18) transparent;
        }

        .ritual-sources-scroll::-webkit-scrollbar {
          width: 5px;
        }

        .ritual-sources-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .ritual-sources-scroll::-webkit-scrollbar-thumb {
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.18);
        }

        @media (prefers-reduced-motion: reduce) {
          .ritual-sources-scroll {
            scroll-behavior: auto;
          }
        }
      `}</style>
    </MenuSurface>
  )
}
