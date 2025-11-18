import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, setHours, isSameHour, isToday, min, max, differenceInMinutes } from 'date-fns';
import { useHotkeys } from 'react-hotkeys-hook';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type CalendarEvent = {
  id: string;
  title: string;
  date: Date;
  completed?: boolean;
};

type CalendarProps = {
  events?: CalendarEvent[];
  onDateSelect?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  className?: string;
};

type View = 'month' | 'day';

const TimeTable = () => {
  const now = new Date();

  return (
    <div className="pr-4 w-16">
      {Array.from(Array(24).keys()).map((hour) => {
        const displayHour = hour === 0 ? '12' : 
                          hour > 12 ? (hour - 12).toString() : 
                          hour.toString();
        const meridiem = hour >= 12 ? 'PM' : 'AM';
        
        return (
          <div
            className="text-right relative text-xs text-muted-foreground/50 h-20 last:h-0"
            key={hour}
          >
            {now.getHours() === hour && (
              <div
                className="absolute z-10 left-full translate-x-2 w-full h-[2px] bg-red-500"
                style={{
                  top: `${(now.getMinutes() / 60) * 100}%`,
                }}
              >
                <div className="size-2 rounded-full bg-red-500 absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"></div>
              </div>
            )}
            <p className="top-0 -translate-y-1/2 whitespace-nowrap">
              {displayHour} {meridiem}
            </p>
          </div>
        );
      })}
    </div>
  );
};

const EventGroup = ({
  events,
  hour,
}: {
  events: CalendarEvent[];
  hour: Date;
}) => {
  return (
    <div className="h-20 border-t last:border-b">
      {events
        .filter((event) => isSameHour(event.date, hour))
        .map((event) => {
          const startPosition = event.date.getMinutes() / 60;
          const eventTime = format(event.date, 'h:mm a');

          return (
            <div
              key={event.id}
              className={cn(
                'relative p-2 text-xs bg-blue-100 rounded',
                'hover:bg-blue-200 transition-colors cursor-pointer'
              )}
              style={{
                top: `${startPosition * 100}%`,
              }}
            >
              <div className="font-medium">{event.title}</div>
              <div className="text-gray-500">{eventTime}</div>
            </div>
          );
        })}
    </div>
  );
};

export function MonthCalendar({
  events = [],
  onDateSelect,
  onEventClick,
  className,
}: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [view, setView] = useState<View>('month');
  const [isDayPanelOpen, setIsDayPanelOpen] = useState(false);

  // State for click-and-drag selection
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartTime, setDragStartTime] = useState<Date | null>(null);
  const [dragCurrentHoverTime, setDragCurrentHoverTime] = useState<Date | null>(null);
  const [selectedRange, setSelectedRange] = useState<{ start: Date; end: Date } | null>(null);
  const [displayDuration, setDisplayDuration] = useState<string | null>(null); // State for formatted duration
  // State for side panel inputs
  const [panelHabitSearchQuery, setPanelHabitSearchQuery] = useState("");
  const [panelDescription, setPanelDescription] = useState("");
  const dayPanelRef = useRef<HTMLDivElement>(null); // Ref for the panel to handle global mouseup

  // Navigation handlers
  const nextMonth = useCallback(() => {
    setCurrentDate((date) => addMonths(date, 1));
  }, []);

  const prevMonth = useCallback(() => {
    setCurrentDate((date) => subMonths(date, 1));
  }, []);

  // Keyboard navigation
  useHotkeys('right', nextMonth);
  useHotkeys('left', prevMonth);

  // Calendar calculations
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);

  const days = useMemo(() => {
    return eachDayOfInterval({ start: startDate, end: monthEnd });
  }, [startDate, monthEnd]);

  // Event handlers
  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    onDateSelect?.(date);
    setIsDayPanelOpen(true);
    setSelectedRange(null); // Clear previous selection when new date is clicked
    if (view === 'day') {
        setCurrentDate(date);
    }
  };

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    onEventClick?.(event);
  };

  const handleHourClick = (hour: Date) => {
    onDateSelect?.(hour);
  };

  // Get events for a specific date
  const getEventsForDate = (date: Date) => {
    return events.filter((event) => isSameDay(event.date, date));
  };

  // Day view hours
  const hours = useMemo(() => {
    return [...Array(24)].map((_, i) => setHours(currentDate, i));
  }, [currentDate]);

  // Click-and-drag handlers
  const handleSlotMouseDown = (slotTime: Date) => {
    setIsDragging(true);
    setDragStartTime(slotTime);
    setDragCurrentHoverTime(slotTime);
    setSelectedRange(null); // Clear previous final selection
  };

  const handleSlotMouseEnter = (slotTime: Date) => {
    if (isDragging) {
      setDragCurrentHoverTime(slotTime);
    }
  };

  // Helper to format duration
  const formatDuration = (totalMinutes: number): string => {
    if (totalMinutes < 0) totalMinutes = 0; // Should not happen with min/max logic
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    let durationString = "";
    if (hours > 0) {
      durationString += `${hours}h`;
    }
    if (minutes > 0) {
      if (hours > 0) durationString += " "; // Add space if hours are also present
      durationString += `${minutes}m`;
    }
    if (durationString === "") return "0m"; // Handle case of 0 duration
    return durationString;
  };

  // Effect for global mouseup listener AND duration calculation
  useEffect(() => {
    const handleMouseUpGlobal = () => {
      if (isDragging && dragStartTime && dragCurrentHoverTime) {
        const actualStart = min([dragStartTime, dragCurrentHoverTime]);
        const actualEnd = max([dragStartTime, dragCurrentHoverTime]);
        const durationInMinutes = differenceInMinutes(actualEnd, actualStart) + 15; // Add 15 because selection is inclusive of the end slot
        setSelectedRange({ start: actualStart, end: actualEnd });
        setDisplayDuration(formatDuration(durationInMinutes));
        console.log('Selected Range:', format(actualStart, 'p'), '-', format(actualEnd, 'p'), '(Duration:', formatDuration(durationInMinutes), ')');
      }
      setIsDragging(false);
    };

    if (isDayPanelOpen) {
      if (typeof window !== 'undefined') {
        window.addEventListener('mouseup', handleMouseUpGlobal);
      }
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('mouseup', handleMouseUpGlobal);
        }
      };
    } else {
      // Clear duration when panel closes
      setDisplayDuration(null);
      // Clear panel inputs when panel closes or date changes
      setPanelHabitSearchQuery("");
      setPanelDescription("");
    }
  }, [isDragging, dragStartTime, dragCurrentHoverTime, isDayPanelOpen]);

  // Effect to update duration while dragging
  useEffect(() => {
    if (isDragging && dragStartTime && dragCurrentHoverTime) {
      const actualStart = min([dragStartTime, dragCurrentHoverTime]);
      const actualEnd = max([dragStartTime, dragCurrentHoverTime]);
      const durationInMinutes = differenceInMinutes(actualEnd, actualStart) + 15;
      setDisplayDuration(formatDuration(durationInMinutes));
    } else if (!isDragging && !selectedRange) {
      setDisplayDuration(null);
      // Don't clear text inputs here, user might want to keep them if they re-select time
    }
  }, [isDragging, dragStartTime, dragCurrentHoverTime, selectedRange]);

  // Helper to check if a slot is in the current dragging selection or final selected range
  const isSlotSelected = (slotTime: Date): boolean => {
    if (isDragging && dragStartTime && dragCurrentHoverTime) {
      const rangeStart = min([dragStartTime, dragCurrentHoverTime]);
      const rangeEnd = max([dragStartTime, dragCurrentHoverTime]);
      return slotTime >= rangeStart && slotTime <= rangeEnd;
    }
    if (!isDragging && selectedRange) {
      return slotTime >= selectedRange.start && slotTime <= selectedRange.end;
    }
    return false;
  };

  // Function to handle adding the event from the panel
  const handleAddEventInPanel = () => {
    if (!selectedRange) {
      alert("Please select a time range first.");
      return;
    }
    if (!panelHabitSearchQuery) {
      alert("Please enter a habit name or search term.");
      return;
    }
    console.log("Adding Event:");
    console.log("Time Range:", selectedRange.start, "-", selectedRange.end);
    console.log("Duration:", displayDuration);
    console.log("Habit/Search:", panelHabitSearchQuery);
    console.log("Description:", panelDescription);

    // Clear inputs and selection after adding
    setSelectedRange(null);
    setDisplayDuration(null);
    setPanelHabitSearchQuery("");
    setPanelDescription("");
    // setIsDayPanelOpen(false); // Optionally close panel
  };

  return (
    <div className={cn("w-full max-w-6xl mx-auto relative", className)}>
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-4 border-b pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-semibold">
            {format(currentDate, view === 'day' ? 'MMMM d, yyyy' : 'MMMM yyyy')}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView(view === 'month' ? 'day' : 'month')}
            className="ml-4 rounded-none"
          >
            <CalendarIcon className="h-4 w-4 mr-2" />
            {view === 'month' ? 'Day View' : 'Month View'}
          </Button>
        </div>
        

        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={prevMonth}
            className="p-2 rounded-none"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={nextMonth}
            className="p-2 rounded-none"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {view === 'month' ? (
        /* Month View */
        <div className="grid grid-cols-7 gap-2">
          {/* Weekday headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div
              key={day}
              className="text-center py-2 text-base font-medium text-gray-500"
            >
              {day}
            </div>
          ))}

          {/* Calendar days */}
          {days.map((day) => {
            const dayEvents = getEventsForDate(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isSelected = selectedDate && isSameDay(day, selectedDate);
            const isTodayDate = isToday(day);

            return (
              <div
                key={day.toString()}
                onClick={() => handleDateClick(day)}
                className={cn(
                  "min-h-[110px] p-2 border border-gray-300 cursor-pointer",
                  "hover:bg-[#F5F5F5] transition-colors",
                  {
                    "bg-gray-50": !isCurrentMonth && !isTodayDate,
                    "border-black": isSelected,
                    "bg-gray-200": isTodayDate,
                  }
                )}
              >
                <div className="text-right">
                  <span
                    className={cn("text-base", {
                      "text-gray-400": !isCurrentMonth,
                      "font-bold": isSelected,
                    })}
                  >
                    {format(day, 'd')}
                  </span>
                </div>

                {/* Events */}
                <div className="mt-2">
                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      onClick={(e) => handleEventClick(event, e)}
                      className={cn(
                        "text-xs p-1 mb-1 rounded",
                        "bg-blue-100 hover:bg-blue-200 transition-colors",
                        "cursor-pointer truncate",
                        {
                          "line-through opacity-50": event.completed,
                        }
                      )}
                    >
                      {event.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Day View */
        <div className="flex relative pt-2 overflow-auto h-[600px]">
          <TimeTable />
          <div className="flex-1">
            {hours.map((hour) => (
              <div
                key={hour.toString()}
                onClick={() => handleHourClick(hour)}
                className="h-20 border-t last:border-b hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <EventGroup hour={hour} events={events} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Day View Side Panel */}
      {isDayPanelOpen && selectedDate && (
        <div 
          ref={dayPanelRef} 
          className="fixed top-0 right-0 h-full w-80 bg-white border-l border-gray-300 shadow-xl z-50 p-6 overflow-y-auto flex flex-col"
        >
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xl font-semibold text-gray-800">
              {format(selectedDate, 'MMMM d, yyyy')}
            </h3>
            <Button variant="ghost" size="icon" onClick={() => setIsDayPanelOpen(false)} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </Button>
          </div>
          {/* Display Duration */}
          {displayDuration && (
            <div className="mb-3 text-sm text-gray-600 bg-gray-50 p-2 rounded-md text-center">
              Selected: <span className="font-medium text-gray-800">{displayDuration} ({format(selectedRange!.start, 'p')} - {format(selectedRange!.end, 'p')})</span>
            </div>
          )}

          {/* Habit Search and Description Inputs (only if a range is selected) */}
          {selectedRange && (
            <div className="mb-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input 
                  type="text"
                  placeholder="Search or create habit..."
                  className="pl-9 text-sm h-9"
                  value={panelHabitSearchQuery}
                  onChange={(e) => setPanelHabitSearchQuery(e.target.value)}
                />
              </div>
              <Input 
                type="text"
                placeholder="Description (optional)"
                className="text-sm h-9"
                value={panelDescription}
                onChange={(e) => setPanelDescription(e.target.value)}
              />
              <Button onClick={handleAddEventInPanel} className="w-full h-9 text-sm">
                Add
              </Button>
            </div>
          )}

          <div className="flex-grow space-y-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            {Array.from({ length: 24 }).map((_, hourIndex) => {
              const hourStartTime = setHours(selectedDate, hourIndex);
              return (
                <div key={hourIndex} className="relative">
                  <div className="sticky top-0 z-10 bg-white px-0.5">
                    <span className="text-xs text-gray-500 font-medium">{format(hourStartTime, 'h:00 a')}</span>
                  </div>
                  <div className="relative">
                    {[0, 15, 30, 45].map((minuteOffset) => {
                      const slotTime = new Date(hourStartTime.getTime() + minuteOffset * 60000);
                      const isSelected = isSlotSelected(slotTime);
                      return (
                        <button
                          key={`${hourIndex}-${minuteOffset}`}
                          className={cn(
                            "w-full text-left h-4 border-b border-gray-100 hover:bg-gray-100 focus:outline-none transition-colors duration-100 ease-in-out pl-2 flex items-center",
                            { "bg-blue-200 hover:bg-blue-300": isSelected }
                          )}
                          onMouseDown={() => handleSlotMouseDown(slotTime)}
                          onMouseEnter={() => handleSlotMouseEnter(slotTime)}
                        >
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
} 