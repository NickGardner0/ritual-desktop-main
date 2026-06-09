"use client"

import * as React from "react"
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { format, subDays, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay, isBefore } from "date-fns"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface DateRangePickerProps {
  className?: string
  onDateRangeChange?: (dateRange: DateRange | undefined) => void
  initialDateRange?: DateRange
  variant?: "default" | "titlebar"
}

interface PresetRange {
  label: string
  value: string
  getRange: () => DateRange | undefined
}

const presetRanges: PresetRange[] = [
  {
    label: "Today",
    value: "today",
    getRange: () => {
      const today = new Date()
      return { from: startOfDay(today), to: endOfDay(today) }
    }
  },
  {
    label: "Yesterday",
    value: "yesterday",
    getRange: () => {
      const yesterday = subDays(new Date(), 1)
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) }
    }
  },
  {
    label: "Last 7 days",
    value: "last7days",
    getRange: () => ({
      from: startOfDay(subDays(new Date(), 6)),
      to: endOfDay(new Date())
    })
  },
  {
    label: "Last 14 days",
    value: "last14days",
    getRange: () => ({
      from: startOfDay(subDays(new Date(), 13)),
      to: endOfDay(new Date())
    })
  },
  {
    label: "Last 30 days",
    value: "last30days",
    getRange: () => ({
      from: startOfDay(subDays(new Date(), 29)),
      to: endOfDay(new Date())
    })
  },
  {
    label: "This week",
    value: "thisweek",
    getRange: () => ({
      from: startOfDay(startOfWeek(new Date())),
      to: endOfDay(endOfWeek(new Date()))
    })
  },
  {
    label: "This month",
    value: "thismonth",
    getRange: () => ({
      from: startOfDay(startOfMonth(new Date())),
      to: endOfDay(endOfMonth(new Date()))
    })
  },
  {
    label: "Last 3 months",
    value: "last3months",
    getRange: () => ({
      from: startOfDay(subMonths(new Date(), 3)),
      to: endOfDay(new Date())
    })
  },
  {
    label: "Last 12 months",
    value: "last12months",
    getRange: () => ({
      from: startOfDay(subMonths(new Date(), 12)),
      to: endOfDay(new Date())
    })
  },
  {
    label: "All time",
    value: "alltime",
    getRange: () => undefined // No date filter
  }
]

export function DateRangePicker({
  className,
  onDateRangeChange,
  initialDateRange,
  variant = "default"
}: DateRangePickerProps) {
  const [date, setDate] = React.useState<DateRange | undefined>(initialDateRange)
  const [selectedPreset, setSelectedPreset] = React.useState<string>(initialDateRange ? "custom" : "alltime")
  const [isOpen, setIsOpen] = React.useState(false)
  
  // Drag-to-select state
  const [isDragging, setIsDragging] = React.useState(false)
  const [dragStart, setDragStart] = React.useState<Date | null>(null)
  
  // Track if we're in the middle of selecting (first click done, waiting for second)
  const [isSelectingRange, setIsSelectingRange] = React.useState(false)

  const handlePresetClick = (preset: PresetRange) => {
    setSelectedPreset(preset.value)
    const range = preset.getRange()
    setDate(range)
    onDateRangeChange?.(range)
  }

  const handleDateSelect = (selectedDate: DateRange | undefined) => {
    // If we're dragging, let the drag handlers manage the selection
    if (isDragging) return;
    
    // Ensure custom date selections use proper day boundaries
    let adjustedDate = selectedDate;
    if (selectedDate?.from) {
      adjustedDate = {
        from: startOfDay(selectedDate.from),
        to: selectedDate.to ? endOfDay(selectedDate.to) : endOfDay(selectedDate.from)
      };
      
      // Track if this is the first click (starting a range) or completing it
      if (!selectedDate.to) {
        setIsSelectingRange(true)
      } else {
        setIsSelectingRange(false)
      }
    }

    setDate(adjustedDate)
    setSelectedPreset("custom")
    onDateRangeChange?.(adjustedDate)
  }
  
  // Handle drag start (mouse down on a day)
  const handleDayMouseDown = (day: Date) => {
    setIsDragging(true)
    setDragStart(day)
    const newRange = { from: startOfDay(day), to: endOfDay(day) }
    setDate(newRange)
    setSelectedPreset("custom")
  }
  
  // Handle drag over (mouse enter on a day while dragging)
  const handleDayMouseEnter = (day: Date) => {
    if (!isDragging || !dragStart) return
    
    // Determine the correct from/to based on drag direction
    let newRange: DateRange
    if (isBefore(day, dragStart)) {
      newRange = { from: startOfDay(day), to: endOfDay(dragStart) }
    } else {
      newRange = { from: startOfDay(dragStart), to: endOfDay(day) }
    }
    
    setDate(newRange)
  }
  
  // Handle drag end (mouse up)
  const handleMouseUp = React.useCallback(() => {
    if (isDragging && date) {
      // Completed a drag - finalize the range
      onDateRangeChange?.(date)
    }
    // Always reset drag state
    setIsDragging(false)
    setDragStart(null)
  }, [isDragging, date, onDateRangeChange])
  
  // Add global mouse up listener for drag end
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('pointerup', handleMouseUp)
      return () => {
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('pointerup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseUp])
  
  // Get the displayed months from the calendar caption elements
  const getDisplayedMonths = (element: HTMLElement): Date[] => {
    const months: Date[] = []
    const calendar = element.closest('.rdp') || element.closest('[class*="p-4"]')?.parentElement
    if (!calendar) return months
    
    const captions = calendar.querySelectorAll('.rdp-caption_label, [class*="caption_label"]')
    captions.forEach((caption) => {
      const text = caption.textContent?.trim() // e.g., "December 2025"
      if (text) {
        const parsed = new Date(text + ' 1') // Add day to make it parseable
        if (!isNaN(parsed.getTime())) {
          months.push(parsed)
        }
      }
    })
    return months
  }
  
  // Parse date from button by getting day number and determining which month it belongs to
  const parseDateFromButton = (button: HTMLElement): Date | null => {
    // Get the day number from button text
    const dayText = button.textContent?.trim()
    if (!dayText) return null
    
    const dayNum = parseInt(dayText, 10)
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return null
    
    // Find which month container this button is in
    // Try multiple selectors as react-day-picker structure varies
    let monthContainer: Element | null = button.closest('.rdp-month')
    if (!monthContainer) {
      // Try finding by going up to table and then to its parent
      const table = button.closest('table')
      monthContainer = table?.parentElement ?? null
    }
    
    // Get the caption - try multiple ways
    let monthText: string | null = null
    
    if (monthContainer) {
      // Try finding caption within the month container
      const caption = monthContainer.querySelector('.rdp-caption_label') ||
                     monthContainer.querySelector('[class*="caption_label"]') ||
                     monthContainer.querySelector('.rdp-caption span') ||
                     monthContainer.querySelector('[class*="caption"] span') ||
                     monthContainer.querySelector('div[class*="caption"]')
      
      if (caption) {
        monthText = caption.textContent?.trim() || null
      }
      
      // If still not found, look for any element containing month name
      if (!monthText) {
        const walker = document.createTreeWalker(
          monthContainer,
          NodeFilter.SHOW_TEXT,
          null
        )
        let node
        while (node = walker.nextNode()) {
          const text = node.textContent?.trim()
          if (text && /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(text)) {
            monthText = text
            break
          }
        }
      }
    }
    
    // If still not found, try finding all captions in the calendar
    if (!monthText) {
      const calendar = button.closest('.rdp') || button.closest('[class*="p-4"]')?.parentElement
      if (calendar) {
        // Find the table this button is in
        const buttonTable = button.closest('table')
        const allMonthContainers = calendar.querySelectorAll('[class*="rdp-caption_start"], [class*="rdp-month"]')
        
        allMonthContainers.forEach((container) => {
          const table = container.querySelector('table')
          if (table === buttonTable) {
            // This is our month - find the caption
            const captionEl = container.querySelector('.rdp-caption_label') || 
                             container.querySelector('[class*="caption"] div') ||
                             container.querySelector('div > div')
            if (captionEl?.textContent?.match(/\d{4}/)) {
              monthText = captionEl.textContent.trim()
            }
          }
        })
      }
    }
    
    if (!monthText) return null
    
    // Parse month and year from text like "December 2025"
    const match = monthText.match(/(\w+)\s+(\d{4})/)
    if (!match) return null
    
    const [, monthName, yearStr] = match
    const year = parseInt(yearStr, 10)
    
    // Convert month name to month index
    const monthDate = new Date(`${monthName} 1, ${year}`)
    if (isNaN(monthDate.getTime())) return null
    
    const month = monthDate.getMonth()
    
    // Check if this is an "outside" day (from previous/next month)
    const cell = button.closest('td')
    const isOutside = cell?.classList.contains('day-outside') || 
                      button.classList.contains('day-outside') ||
                      cell?.querySelector('.day-outside') !== null ||
                      button.closest('.day-outside') !== null
    
    let finalMonth = month
    let finalYear = year
    
    if (isOutside) {
      // Determine if it's from previous or next month based on day number
      if (dayNum > 20) {
        // High day number in "outside" = previous month
        finalMonth = month - 1
        if (finalMonth < 0) {
          finalMonth = 11
          finalYear = year - 1
        }
      } else {
        // Low day number in "outside" = next month
        finalMonth = month + 1
        if (finalMonth > 11) {
          finalMonth = 0
          finalYear = year + 1
        }
      }
    }
    
    return new Date(finalYear, finalMonth, dayNum)
  }
  
  // Find the day button from an event target
  const findDayButton = (target: HTMLElement): HTMLElement | null => {
    if (target.tagName === 'BUTTON' && target.getAttribute('name') === 'day') {
      return target
    }
    const button = target.closest('button[name="day"]') as HTMLElement
    return button
  }
  
  // Handle pointer down on calendar - only used for starting drag selection
  const handleCalendarMouseDown = (e: React.PointerEvent | React.MouseEvent) => {
    // Don't interfere with normal clicks - let Calendar handle them
    // We only track for potential drag operations
    const target = e.target as HTMLElement
    const dayButton = findDayButton(target)
    
    if (dayButton) {
      const dayDate = parseDateFromButton(dayButton)
      if (dayDate && !isNaN(dayDate.getTime())) {
        // Store potential drag start, but don't prevent default yet
        setDragStart(dayDate)
      }
    }
  }
  
  // Handle pointer move over calendar (event delegation) - for drag selection
  const handleCalendarMouseMove = (e: React.PointerEvent | React.MouseEvent) => {
    // Only process if we have a potential drag start and mouse is down
    if (!dragStart) return
    
    // Check if mouse button is still pressed
    if (!('buttons' in e) || (e as React.MouseEvent).buttons !== 1) {
      setDragStart(null)
      return
    }
    
    const target = e.target as HTMLElement
    const dayButton = findDayButton(target)
    
    if (dayButton) {
      const dayDate = parseDateFromButton(dayButton)
      if (dayDate && !isNaN(dayDate.getTime())) {
        // Check if we've moved to a different date
        if (dayDate.getTime() !== dragStart.getTime()) {
          // Start dragging if not already
          if (!isDragging) {
            setIsDragging(true)
          }
          // Update selection while dragging
          handleDayMouseEnter(dayDate)
        }
      }
    }
  }

  const formatDateRange = () => {
    if (!date?.from) {
      return "All time"
    }
    if (date.from && !date.to) {
      return format(date.from, "MMM dd")
    }
    if (date.from && date.to) {
      if (format(date.from, "yyyy-MM-dd") === format(date.to, "yyyy-MM-dd")) {
        return format(date.from, "MMM dd")
      }
      return `${format(date.from, "MMM dd")} - ${format(date.to, "MMM dd")}`
    }
    return "All time"
  }

  const isTitlebar = variant === "titlebar"

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            aria-label={`Date range: ${formatDateRange()}`}
            className={cn(
              isTitlebar
                ? "h-7 w-[128px] justify-between rounded-sm border border-gray-300 bg-white px-2.5 py-1 text-left text-[12.5px] font-normal text-black shadow-sm hover:border-gray-300 hover:bg-[#F3F3F3] focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
                : "w-[116px] justify-between text-left font-normal text-[13px] px-2.5 py-1 h-7 border border-black/[0.07] bg-white/60 text-black shadow-[0_1px_2px_rgba(15,23,42,0.07)] hover:bg-white/75 hover:border-black/[0.09] rounded-[8px] backdrop-blur-md",
              !date && (isTitlebar ? "text-[rgba(17,24,39,0.82)]" : "text-black"),
              className
            )}
          >
            <CalendarIcon className={cn("mr-1.5 h-3.5 w-3.5", isTitlebar && "text-black")} />
            <span className="min-w-0 truncate">{formatDateRange()}</span>
            <ChevronDown className={cn("ml-auto h-3.5 w-3.5", isTitlebar && "text-black")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[580px] p-0 border-gray-300 shadow-lg rounded-sm"
          align="end"
          side="bottom"
          sideOffset={8}
          avoidCollisions={false}
        >
          <div className="flex flex-col">
            <div className="px-4 py-3 border-b border-gray-300">
              <Select value={selectedPreset} onValueChange={(value) => {
                const preset = presetRanges.find(p => p.value === value)
                if (preset) {
                  handlePresetClick(preset)
                }
              }}>
                <SelectTrigger className="w-[200px] h-9 text-sm border-gray-300 hover:border-gray-300 hover:bg-[#F3F3F3] rounded-sm focus:ring-0 focus:ring-offset-0 focus:border-gray-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-300 rounded-sm">
                  {presetRanges.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value} className="text-sm hover:bg-[#F3F3F3] focus:bg-[#F3F3F3]">
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div 
              className={cn("w-[580px] select-none", isDragging && "cursor-crosshair")}
              onPointerDownCapture={handleCalendarMouseDown}
              onPointerMoveCapture={handleCalendarMouseMove}
              onPointerUpCapture={handleMouseUp}
              style={{ touchAction: 'none' }}
            >
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={handleDateSelect}
                numberOfMonths={2}
                fixedWeeks={true}
                className="p-4"
                classNames={{
                  day: cn(
                    "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-none hover:bg-[#F3F3F3] hover:text-gray-900",
                    isDragging && "cursor-crosshair"
                  ),
                  day_selected: "bg-[#F3F3F3] text-gray-900 hover:bg-[#F3F3F3] hover:text-gray-900 focus:bg-[#F3F3F3] focus:text-gray-900 rounded-none",
                  day_today: "bg-[#F3F3F3] text-gray-900 rounded-none",
                  day_range_middle: "aria-selected:bg-[#F3F3F3] aria-selected:text-gray-900",
                  day_outside: "day-outside text-muted-foreground aria-selected:bg-[#F3F3F3]/50 aria-selected:text-muted-foreground",
                  cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-none [&:has([aria-selected].day-outside)]:bg-[#F3F3F3]/50 [&:has([aria-selected])]:bg-[#F3F3F3] first:[&:has([aria-selected])]:rounded-none last:[&:has([aria-selected])]:rounded-none focus-within:relative focus-within:z-20",
                  nav_button: "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 hover:bg-[#F3F3F3] rounded-none border-gray-300"
                }}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
