'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Device / Integration catalog ──────────────────────────

interface DeviceEntry {
  id: string;
  name: string;
  logo: string;
  logoWidth?: number;
  logoHeight?: number;
  description: string;
  category: 'wearable' | 'financial' | 'productivity' | 'health';
  comingSoon?: boolean;
}

const DEVICES: DeviceEntry[] = [
  {
    id: 'whoop',
    name: 'WHOOP',
    logo: '/images/whoop.svg',
    logoWidth: 60,
    logoHeight: 24,
    description: 'Track recovery, sleep, and strain data.',
    category: 'wearable',
  },
  {
    id: 'oura',
    name: 'Oura Ring',
    logo: '/images/oura.svg',
    logoWidth: 32,
    logoHeight: 32,
    description: 'Sync sleep, readiness, and HRV trends.',
    category: 'wearable',
  },
  {
    id: 'garmin',
    name: 'Garmin',
    logo: '/images/garmin.svg',
    logoWidth: 48,
    logoHeight: 20,
    description: 'Activity, workout, and sleep tracking.',
    category: 'wearable',
  },
  {
    id: 'plaid',
    name: 'Plaid',
    logo: '/images/plaid-mark.svg',
    logoWidth: 28,
    logoHeight: 28,
    description: 'Connect bank accounts and track spending.',
    category: 'financial',
  },
  {
    id: 'apple-watch',
    name: 'Apple Watch',
    logo: '/images/eclipse.svg',
    logoWidth: 24,
    logoHeight: 24,
    description: 'Sync workouts, steps, and heart rate.',
    category: 'wearable',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    logo: '/images/Google_Calendar_Logo.svg',
    logoWidth: 24,
    logoHeight: 24,
    description: 'Track meeting time and patterns.',
    category: 'productivity',
    comingSoon: true,
  },
  {
    id: 'fitbit',
    name: 'Fitbit',
    logo: '/images/fitbit.svg',
    logoWidth: 48,
    logoHeight: 20,
    description: 'Connect Fitbit for activity and health.',
    category: 'wearable',
    comingSoon: true,
  },
  {
    id: 'cal-ai',
    name: 'Cal AI',
    logo: '/images/cal_ai.svg',
    logoWidth: 60,
    logoHeight: 24,
    description: 'AI-powered nutrition and calorie tracking.',
    category: 'health',
    comingSoon: true,
  },
  {
    id: 'screen-time',
    name: 'Apple Screen Time',
    logo: '/images/Screen_Time.svg',
    logoWidth: 24,
    logoHeight: 24,
    description: 'Import Screen Time data from iOS.',
    category: 'health',
    comingSoon: true,
  },
];

// Small icons shown in the trigger bar
const BAR_ICONS = DEVICES.filter((d) => !d.comingSoon).slice(0, 3);

// ── Trigger bar (shown below chat) ────────────────────────

export function ConnectedDevicesBar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed bottom-0 left-[70px] right-0 flex justify-center pb-2.5 pointer-events-none">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto inline-flex items-center gap-2 text-[13px] text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          <span>Connect devices</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="inline-flex -space-x-1.5">
            {BAR_ICONS.map((d) => (
              <img
                key={d.id}
                src={d.logo}
                alt={d.name}
                className="h-5 w-5 rounded-full border border-white bg-white object-contain"
              />
            ))}
          </span>
        </button>
      </div>

      <ConnectedDevicesModal open={open} onOpenChange={setOpen} />
    </>
  );
}

// ── Modal ─────────────────────────────────────────────────

function ConnectedDevicesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return DEVICES;
    const q = search.toLowerCase();
    return DEVICES.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-0 gap-0 rounded-lg overflow-hidden">
        <div className="flex flex-col h-[500px]">
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold text-neutral-900">
                Connected devices
              </DialogTitle>
              <DialogDescription className="text-sm text-neutral-500 mt-1">
                Connect your devices and services to Ritual. Your AI assistant can
                then access and interact with them.
              </DialogDescription>
            </DialogHeader>

            {/* Search */}
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
              <input
                type="text"
                placeholder={`Search ${DEVICES.length} devices...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-white pl-9 pr-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-auto px-5 pb-5">
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  onConnect={() => {
                    onOpenChange(false);
                    router.push('/integrations');
                  }}
                />
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="flex items-center justify-center h-32 text-sm text-neutral-400">
                No devices found
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Device card ───────────────────────────────────────────

function DeviceCard({
  device,
  onConnect,
}: {
  device: DeviceEntry;
  onConnect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={device.comingSoon ? undefined : onConnect}
      disabled={device.comingSoon}
      className={cn(
        'flex items-start justify-between w-full p-3 border border-border rounded-md text-left transition-colors',
        device.comingSoon
          ? 'opacity-50 cursor-default'
          : 'hover:bg-neutral-50 cursor-pointer',
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100">
          <img
            src={device.logo}
            alt={device.name}
            className="max-h-5 max-w-5 object-contain"
          />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-neutral-900 truncate">
            {device.name}
          </div>
          <div className="text-xs text-neutral-500 line-clamp-2 mt-0.5">
            {device.comingSoon ? 'Coming soon' : device.description}
          </div>
        </div>
      </div>

      {!device.comingSoon && (
        <div className="shrink-0 ml-2 mt-0.5">
          <Plus className="h-4 w-4 text-neutral-400" />
        </div>
      )}
    </button>
  );
}
