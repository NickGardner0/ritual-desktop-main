"use client"

import * as React from "react"
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { format, subDays, subWeeks, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay } from "date-fns"
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
  initialDateRange
}: DateRangePickerProps) {
  const [date, setDate] = React.useState<DateRange | undefined>(initialDateRange)
  const [selectedPreset, setSelectedPreset] = React.useState<string>("alltime")
  const [isOpen, setIsOpen] = React.useState(false)

  const handlePresetClick = (preset: PresetRange) => {
    setSelectedPreset(preset.value)
    const range = preset.getRange()
    setDate(range)
    onDateRangeChange?.(range)
  }

  const handleDateSelect = (selectedDate: DateRange | undefined) => {
    // Ensure custom date selections use proper day boundaries
    let adjustedDate = selectedDate;
    if (selectedDate?.from) {
      adjustedDate = {
        from: startOfDay(selectedDate.from),
        to: selectedDate.to ? endOfDay(selectedDate.to) : endOfDay(selectedDate.from)
      };
    }

    setDate(adjustedDate)
    setSelectedPreset("custom")
    onDateRangeChange?.(adjustedDate)
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

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[120px] justify-between text-left font-normal text-sm px-3 py-2 h-9 border-gray-300 bg-white text-black hover:bg-[#F3F3F3] hover:border-gray-300 rounded-none",
              !date && "text-black",
              className
            )}
          >
            <CalendarIcon className="w-4 h-4 mr-2" />
            {formatDateRange()}
            <ChevronDown className="w-4 h-4 ml-auto" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[580px] p-0 border-gray-300 shadow-lg rounded-none"
          align="end"
          side="bottom"
          sideOffset={8}
          avoidCollisions={true}
        >
          <div className="flex flex-col">
            <div className="px-4 py-3 border-b border-gray-300">
              <Select value={selectedPreset} onValueChange={(value) => {
                const preset = presetRanges.find(p => p.value === value)
                if (preset) {
                  handlePresetClick(preset)
                }
              }}>
                <SelectTrigger className="w-[200px] h-9 text-sm border-gray-300 hover:border-gray-300 hover:bg-[#F3F3F3] rounded-none focus:ring-0 focus:ring-offset-0 focus:border-gray-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-300 rounded-none">
                  {presetRanges.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value} className="text-sm hover:bg-[#F3F3F3] focus:bg-[#F3F3F3]">
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[580px]">
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
                  day: "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-none hover:bg-[#F3F3F3] hover:text-gray-900",
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
