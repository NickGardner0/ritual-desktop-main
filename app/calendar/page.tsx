'use client';

import { useState } from 'react';
import { MonthCalendar } from "@/components/ui/month-calendar";
import { Dialog, DialogContent, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from 'date-fns';
import { Users2, Video, MapPin, AlignLeft, Bell } from 'lucide-react';
// import CompactTimer from '@/components/timer/CompactTimer';

// Sample events
const initialEvents = [
  {
    id: '1',
    title: 'Meeting with John',
    date: new Date('2024-08-26T09:30:00Z'),
    completed: false,
  },
  {
    id: '2',
    title: 'Project Review',
    date: new Date('2024-08-26T10:00:00Z'),
    completed: false,
  },
];

export default function CalendarPage() {
  const [events, setEvents] = useState(initialEvents);
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false);
  const [newEventDate, setNewEventDate] = useState<Date | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [eventType, setEventType] = useState('event');

  const handleCreateEvent = (date: Date) => {
    setNewEventDate(date);
    setIsCreateEventOpen(true);
  };

  const handleSaveEvent = () => {
    if (newEventDate && newEventTitle) {
      const newEvent = {
        id: Math.random().toString(36).substr(2, 9),
        title: newEventTitle,
        date: newEventDate,
        completed: false,
      };
      setEvents([...events, newEvent]);
      setIsCreateEventOpen(false);
      setNewEventTitle('');
      setNewEventDate(null);
    }
  };

  return (
    <>
      {/* Calendar */}
      <div className="p-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <MonthCalendar 
            events={events}
            onDateSelect={handleCreateEvent}
            onEventClick={(event) => {
              console.log('Event clicked:', event);
            }}
            // compactTimer={<CompactTimer onSessionComplete={handleTimerSessionComplete} />}
          />
        </div>
      </div>

      {/* Create Event Dialog */}
      <Dialog open={isCreateEventOpen} onOpenChange={setIsCreateEventOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <Input
              placeholder="Add title"
              value={newEventTitle}
              onChange={(e) => setNewEventTitle(e.target.value)}
              className="text-lg font-semibold border-b-2 border-blue-500 focus:outline-none px-0"
            />
            <Tabs value={eventType} onValueChange={setEventType} className="w-full mt-4">
              <TabsList className="w-full justify-start gap-2 h-auto bg-transparent">
                <TabsTrigger 
                  value="event"
                  className="data-[state=active]:bg-blue-100 rounded-full px-4"
                >
                  Event
                </TabsTrigger>
                <TabsTrigger 
                  value="focus"
                  className="data-[state=active]:bg-blue-100 rounded-full px-4"
                >
                  Focus time
                </TabsTrigger>
                <TabsTrigger 
                  value="out"
                  className="data-[state=active]:bg-blue-100 rounded-full px-4"
                >
                  Out of office
                </TabsTrigger>
                <TabsTrigger 
                  value="task"
                  className="data-[state=active]:bg-blue-100 rounded-full px-4"
                >
                  Task
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-4 text-sm">
              <div className="w-5">
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm-1-13h2v5.2l4.5 2.7-.8 1.3L11 13V7z"/>
                </svg>
              </div>
              {newEventDate && (
                <span>{format(newEventDate, 'EEEE, MMMM d')} • Does not repeat</span>
              )}
            </div>

            <div className="flex items-center gap-4 text-sm">
              <Users2 className="w-5 h-5" />
              <span className="text-gray-600">Add guests</span>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <Video className="w-5 h-5" />
              <span className="text-gray-600">Add Google Meet video conferencing</span>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <MapPin className="w-5 h-5" />
              <span className="text-gray-600">Add location</span>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <AlignLeft className="w-5 h-5" />
              <span className="text-gray-600">Add description or attachment</span>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <Bell className="w-5 h-5" />
              <span>Notification • 10 minutes before</span>
            </div>
          </div>

          <DialogFooter className="flex justify-between items-center">
            <Button variant="ghost" onClick={() => setIsCreateEventOpen(false)}>
              More options
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsCreateEventOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEvent}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
} 