"use client"

import { cn } from "@/lib/utils"
import styles from "./ritual-glass-mark.module.css"

export function RitualGlassMark({ className }: { className?: string }) {
  return (
    <div className={cn(styles.logo, className)} aria-hidden="true">
      <div className={styles.aura} />
      <div className={styles.float}>
        <svg viewBox="0 0 240 240" role="presentation">
          <defs>
            <linearGradient id="ritual-glass-top" x1="54" y1="30" x2="176" y2="116" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffffff" stopOpacity="0.96" />
              <stop offset="0.46" stopColor="#eef0f4" stopOpacity="0.82" />
              <stop offset="1" stopColor="#b9bec7" stopOpacity="0.62" />
            </linearGradient>
            <linearGradient id="ritual-glass-left" x1="46" y1="70" x2="124" y2="194" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="0.54" stopColor="#d5d9e0" stopOpacity="0.74" />
              <stop offset="1" stopColor="#8e949e" stopOpacity="0.58" />
            </linearGradient>
            <linearGradient id="ritual-glass-right" x1="194" y1="72" x2="118" y2="197" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffffff" stopOpacity="0.94" />
              <stop offset="0.52" stopColor="#e1e4e9" stopOpacity="0.76" />
              <stop offset="1" stopColor="#a1a7b0" stopOpacity="0.58" />
            </linearGradient>
            <linearGradient id="ritual-glass-fold" x1="48" y1="91" x2="126" y2="190" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f8f9fb" stopOpacity="0.92" />
              <stop offset="0.46" stopColor="#aeb4be" stopOpacity="0.78" />
              <stop offset="1" stopColor="#6f7680" stopOpacity="0.54" />
            </linearGradient>
            <linearGradient id="ritual-glass-edge" x1="44" y1="67" x2="197" y2="161" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f0a02d" stopOpacity="0" />
              <stop offset="0.18" stopColor="#e98927" stopOpacity="0.9" />
              <stop offset="0.34" stopColor="#4ba6e8" stopOpacity="0.82" />
              <stop offset="0.52" stopColor="#ffffff" stopOpacity="0.24" />
              <stop offset="0.76" stopColor="#9366e4" stopOpacity="0.66" />
              <stop offset="1" stopColor="#e98927" stopOpacity="0" />
            </linearGradient>
            <filter id="ritual-glass-shadow" x="-30%" y="-30%" width="160%" height="180%">
              <feDropShadow dx="0" dy="15" stdDeviation="14" floodColor="#69717d" floodOpacity="0.22" />
            </filter>
            <filter id="ritual-glyph-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feColorMatrix values="1 0 0 0 0.12 0 1 0 0 0.13 0 0 1 0 0.15 0 0 0 0.72 0" />
              <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#ffffff" floodOpacity="0.42" />
            </filter>
            <radialGradient id="ritual-glass-glint" cx="0" cy="0" r="1" gradientTransform="translate(91 60) rotate(34) scale(82 58)" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffffff" stopOpacity="0.72" />
              <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>

          <ellipse cx="120" cy="207" rx="62" ry="12" fill="#7d838d" opacity="0.12" />
          <g filter="url(#ritual-glass-shadow)">
            <path d="M120 25L198 69L120 113L42 69L120 25Z" fill="url(#ritual-glass-top)" />
            <path d="M42 69L120 113V201L42 157V69Z" fill="url(#ritual-glass-left)" />
            <path d="M198 69L120 113V201L198 157V69Z" fill="url(#ritual-glass-right)" />
            <path
              className={styles.fold}
              d="M43 89C73 92 99 108 120 130V201L42 157L43 89Z"
              fill="url(#ritual-glass-fold)"
            />
            <path d="M120 25L198 69L120 113L42 69L120 25Z" fill="url(#ritual-glass-glint)" />
            <path d="M42 69L120 113L198 69M120 113V201" fill="none" stroke="#ffffff" strokeOpacity="0.62" />
            <path d="M43 89C73 92 99 108 120 130" fill="none" stroke="url(#ritual-glass-edge)" strokeWidth="2.4" />
            <path className={styles.spectrum} d="M43 69L120 113L197 69" fill="none" stroke="url(#ritual-glass-edge)" strokeWidth="2.2" />

            <image
              href="/images/eclipse.svg"
              x="84"
              y="76"
              width="72"
              height="72"
              preserveAspectRatio="xMidYMid meet"
              filter="url(#ritual-glyph-shadow)"
            />
          </g>
          <circle className={styles.glint} cx="69" cy="61" r="3.2" fill="#ffffff" />
        </svg>
      </div>
    </div>
  )
}
