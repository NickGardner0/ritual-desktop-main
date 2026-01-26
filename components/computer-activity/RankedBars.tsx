/**
 * RankedBars
 * 
 * Horizontal ranked bar chart for apps/domains.
 * Perplexity Finance-style minimal design: label, bar, duration.
 * Uses native macOS app icons via Tauri commands.
 */

'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Globe } from 'lucide-react'
import { RankedBar } from '@/types/computerActivity'
import { msToHuman } from '@/lib/computerActivity/derive'

// Cache for app icons (base64 data URLs)
const iconCache = new Map<string, string>()

// Check if we're in Tauri environment
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

/**
 * AppIcon component - fetches real macOS app icons via Tauri
 */
function AppIcon({ appName, bundleId, className = '' }: { appName: string; bundleId?: string; className?: string }) {
  const [iconSrc, setIconSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  
  // Fetch icon from Tauri
  const fetchIcon = useCallback(async (bid: string) => {
    // Check cache first
    if (iconCache.has(bid)) {
      setIconSrc(iconCache.get(bid)!)
      return
    }
    
    if (!isTauri) {
      setError(true)
      return
    }
    
    setLoading(true)
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      const result = await invoke<{
        bundle_id: string
        icon_path: string | null
        icon_base64: string | null
      }>('get_app_icon', { bundleId: bid })
      
      if (result.icon_base64) {
        const dataUrl = `data:image/png;base64,${result.icon_base64}`
        iconCache.set(bid, dataUrl)
        setIconSrc(dataUrl)
      } else {
        setError(true)
      }
    } catch (err) {
      console.debug('Failed to fetch app icon:', bid, err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])
  
  useEffect(() => {
    if (bundleId) {
      fetchIcon(bundleId)
    } else {
      setError(true)
    }
  }, [bundleId, fetchIcon])
  
  // Generate initials from app name (fallback)
  const initials = appName
    .split(/[\s-_]+/)
    .filter(word => word.length > 0)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || appName.slice(0, 2).toUpperCase()
  
  // Generate a consistent color from the app name
  const hashCode = appName.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)
  const hue = Math.abs(hashCode) % 360
  const bgColor = `hsl(${hue}, 30%, 90%)`
  const textColor = `hsl(${hue}, 40%, 40%)`
  
  // Show icon if we have it
  if (iconSrc && !error) {
    return (
      <img
        src={iconSrc}
        alt={appName}
        className={`object-contain ${className}`}
        onError={() => setError(true)}
      />
    )
  }
  
  // Loading state - show subtle placeholder
  if (loading) {
    return (
      <div 
        className={`flex items-center justify-center animate-pulse ${className}`}
        style={{ backgroundColor: '#f3f4f6' }}
      />
    )
  }
  
  // Fallback: initials badge
  return (
    <div 
      className={`flex items-center justify-center text-[9px] font-semibold select-none ${className}`}
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {initials}
    </div>
  )
}

interface RankedBarsProps {
  items: RankedBar[]
  maxVisible?: number
  type?: 'apps' | 'domains'
  className?: string
}

export function RankedBars({
  items,
  maxVisible = 5,
  type = 'apps',
  className = '',
}: RankedBarsProps) {
  const [expanded, setExpanded] = useState(false)
  const [hoveredItem, setHoveredItem] = useState<RankedBar | null>(null)
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null)
  
  const visibleItems = expanded ? items : items.slice(0, maxVisible)
  const hasMore = items.length > maxVisible
  const maxValue = items[0]?.valueMs || 1
  
  const handleMouseEnter = (item: RankedBar, e: React.MouseEvent) => {
    setHoveredItem(item)
    // Get the bounding rect of the row element for accurate positioning
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltipRect(rect)
  }
  
  const handleMouseLeave = () => {
    setHoveredItem(null)
    setTooltipRect(null)
  }
  
  if (items.length === 0) {
    return (
      <div className={`py-8 text-center ${className}`}>
        <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
          <Globe className="w-5 h-5 text-gray-300" />
        </div>
        <p className="text-sm text-gray-400">
          {type === 'domains' ? 'No websites tracked' : 'No apps tracked'}
        </p>
      </div>
    )
  }
  
  return (
    <div className={className}>
      <div className="space-y-2.5">
        {visibleItems.map((item) => {
          const percentage = (item.valueMs / maxValue) * 100
          
          return (
            <div
              key={item.key}
              className="group flex items-center gap-2.5 py-0.5 cursor-default hover:bg-[#F3F3F3]/50 -mx-1 px-1 transition-colors"
              onMouseEnter={(e) => handleMouseEnter(item, e)}
              onMouseLeave={handleMouseLeave}
            >
              {/* App/Domain icon */}
              {type === 'domains' ? (
                <img
                  src={`https://www.google.com/s2/favicons?domain=${item.label}&sz=64`}
                  alt=""
                  className="w-5 h-5 flex-shrink-0 rounded"
                  onError={(e) => {
                    e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
                  }}
                />
              ) : (
                <AppIcon 
                  appName={item.label} 
                  bundleId={item.key}
                  className="w-5 h-5 rounded flex-shrink-0"
                />
              )}
              
              {/* Name - fixed width for alignment */}
              <span className="text-[13px] text-gray-700 truncate w-[120px] flex-shrink-0">
                {item.label}
              </span>
              
              {/* Progress bar */}
              <div className="flex-1 h-2.5 relative">
                <div
                  className="absolute inset-y-0 left-0 bg-gray-800 transition-all duration-300 group-hover:bg-gray-600"
                  style={{ width: `${Math.max(percentage, 2)}%` }}
                />
              </div>
              
              {/* Duration */}
              <span className="text-[13px] text-gray-500 tabular-nums text-right min-w-[44px]">
                {msToHuman(item.valueMs, true)}
              </span>
            </div>
          )
        })}
      </div>
      
      {/* Show more link */}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors mt-2"
        >
          {expanded ? (
            <>Show less <ChevronUp className="w-3 h-3" /></>
          ) : (
            <>{items.length - maxVisible} more <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      )}
      
      {/* Total footer */}
      <div className="flex justify-end pt-2 mt-2">
        <span className="text-xs text-gray-400">
          {items.length} {type === 'domains' ? 'site' : 'app'}{items.length !== 1 ? 's' : ''} · {msToHuman(items.reduce((sum, item) => sum + item.valueMs, 0))}
        </span>
      </div>
      
      {/* Compact frosted glass tooltip - rendered in portal to escape CSS transforms */}
      {hoveredItem && tooltipRect && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed z-[9999] pointer-events-none"
          style={{ 
            left: tooltipRect.left + tooltipRect.width / 2,
            top: tooltipRect.top - 6,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div 
            className="px-2 py-1 text-xs border border-gray-200/60 shadow-md whitespace-nowrap"
            style={{
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(12px) saturate(180%)',
              WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            }}
          >
            <span className="font-medium text-gray-900">{hoveredItem.label}</span>
            <span className="text-gray-400 mx-1.5">·</span>
            <span className="text-gray-500 tabular-nums">{msToHuman(hoveredItem.valueMs)} active</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default RankedBars

