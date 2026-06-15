'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
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
    logoWidth: 48,
    logoHeight: 48,
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
    logo: '/images/apple-logo.svg',
    logoWidth: 24,
    logoHeight: 24,
    description: 'Sync workouts, steps, and heart rate.',
    category: 'wearable',
  },
  {
    id: 'tesla',
    name: 'Tesla',
    logo: '/images/Tesla_T_symbol.svg',
    logoWidth: 24,
    logoHeight: 24,
    description: 'Track miles driven.',
    category: 'productivity',
    comingSoon: true,
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

// Icons shown in the trigger bar
const BAR_ICON_IDS = ['oura', 'plaid', 'apple-watch'];
const BAR_ICONS = DEVICES.filter((d) => BAR_ICON_IDS.includes(d.id));

// ── Trigger bar (shown below chat) ────────────────────────

export function ConnectedDevicesBar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="fixed bottom-[18px] right-0 flex justify-center px-4 sm:px-6 lg:px-8 pointer-events-none"
        style={{ left: 'var(--ritual-sidebar-current-width, 76px)' }}
      >
        <div className="flex w-full max-w-2xl justify-end pr-[6px] pointer-events-auto">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            <span>Connect devices</span>
            <ChevronRight className="h-3 w-3" />
            <span className="inline-flex items-center gap-[1px] overflow-visible">
              {BAR_ICONS.map((d) => (
                <span
                  key={d.id}
                  className={cn(
                    'flex items-center justify-center overflow-visible',
                    d.id === 'oura'
                      ? 'h-[20px] w-[20px]'
                      : d.id === 'plaid'
                        ? 'h-[13px] w-[13px]'
                        : 'h-[14px] w-[14px]'
                  )}
                >
                  <img
                    src={d.logo}
                    alt={d.name}
                    className={cn(
                      'object-contain',
                      d.id === 'oura'
                        ? 'h-[20px] w-[20px]'
                        : d.id === 'plaid'
                          ? 'h-[12px] w-[12px]'
                          : 'h-[14px] w-[14px]'
                    )}
                  />
                </span>
              ))}
            </span>
          </button>
        </div>
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
      <DialogContent className="max-w-[560px] p-0 gap-0 rounded-sm overflow-hidden">
        <div className="flex flex-col h-[500px]">
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <DialogHeader>
              <DialogTitle className="text-lg font-medium text-neutral-900">
                Connected devices
              </DialogTitle>
              <DialogDescription className="text-sm text-neutral-500 mt-1">
                Connect your devices and data sources to Ritual. Discover the full
                potential of your behavioral data.
              </DialogDescription>
            </DialogHeader>

            {/* Search */}
            <div className="relative mt-4">
              <input
                type="text"
                placeholder={`Search ${DEVICES.length} devices...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-white px-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-auto px-5 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        'flex items-start justify-between w-full p-3 border border-border rounded-sm text-left transition-colors',
        device.comingSoon
          ? 'cursor-default'
          : 'hover:bg-neutral-50 cursor-pointer',
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
          <img
            src={device.logo}
            alt={device.name}
            className={cn(
              'object-contain',
              device.id === 'oura' ? 'max-h-10 max-w-10' : device.id === 'plaid' ? 'max-h-7 max-w-7' : 'max-h-6 max-w-6',
            )}
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

    </button>
  );
}
