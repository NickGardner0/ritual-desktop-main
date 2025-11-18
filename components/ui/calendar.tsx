"use client"

import * as React from "react"
import { ChevronLeftSharp, ChevronRightSharp } from "@mui/icons-material"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 hover:bg-[#DCDCDC] rounded-none border-gray-200"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-none [&:has([aria-selected].day-outside)]:bg-[#DCDCDC]/50 [&:has([aria-selected])]:bg-[#DCDCDC] first:[&:has([aria-selected])]:rounded-none last:[&:has([aria-selected])]:rounded-none focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-none hover:bg-[#DCDCDC] hover:text-gray-900"
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-[#DCDCDC] text-gray-900 hover:bg-[#DCDCDC] hover:text-gray-900 focus:bg-[#DCDCDC] focus:text-gray-900 rounded-none",
        day_today: "bg-[#DCDCDC] text-gray-900 rounded-none",
        day_outside:
          "day-outside text-muted-foreground aria-selected:bg-[#DCDCDC]/50 aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-[#DCDCDC] aria-selected:text-gray-900",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ...props }) => <ChevronLeftSharp sx={{ fontSize: 16 }} className="h-4 w-4" />,
        IconRight: ({ ...props }) => <ChevronRightSharp sx={{ fontSize: 16 }} className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
