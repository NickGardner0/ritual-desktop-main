'use client';

import React from 'react';
import {
  Brain, ChartLine, FlaskConical, Heart, Monitor, Plus,
} from 'lucide-react';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { categoryRowClass, connectRowActionClass, connectRowActionConnectedClass } from './constants';

export type CategoryListProps = {
  computerTrackingConnected: boolean;
  isAddingComputerHabit: boolean;
  appleWatchConnected: boolean;
  ouraConnected: boolean;
  whoopConnected: boolean;
  whoopConnecting: boolean;
  garminConnected: boolean;
  plaidConnected: boolean;
  handleCategorySelect: (category: string) => void;
  handleComputerUseConnect: () => void;
  openComputerUseSettings: () => void;
};

type CategoryRowProps = {
  icon: React.ReactNode;
  label: string;
  action: string;
  onSelect: () => void;
  connected?: boolean;
  disabled?: boolean;
};

function CategoryRow({ icon, label, action, onSelect, connected = false, disabled = false }: CategoryRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`${categoryRowClass} w-full cursor-pointer text-left disabled:cursor-wait disabled:opacity-50`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
          {icon}
        </span>
        <span className="truncate text-[13px] font-normal leading-none tracking-normal text-[#2c2b28]">
          {label}
        </span>
      </span>
      <span className={connected ? connectRowActionConnectedClass : connectRowActionClass}>
        {action}
      </span>
    </button>
  );
}

export function CategoryList({
  computerTrackingConnected,
  isAddingComputerHabit,
  appleWatchConnected,
  ouraConnected,
  whoopConnected,
  whoopConnecting,
  garminConnected,
  plaidConnected,
  handleCategorySelect,
  handleComputerUseConnect,
  openComputerUseSettings,
}: CategoryListProps) {
  const { isDesktop } = useDesktopCapabilities();

  const selectAppleWatch = () => {
    if (appleWatchConnected) {
      handleCategorySelect('applewatch');
      return;
    }

    alert(
      '📱 To connect your Apple Watch:\n\n' +
      '1. Download the Ritual Companion app on your iPhone\n' +
      '2. Sign in with your Ritual account\n' +
      '3. Tap "Connect" to register your device\n' +
      '4. Grant HealthKit permissions\n\n' +
      'Your Apple Watch data syncs through your iPhone.'
    );
  };

  return (
    <div className="space-y-0.5 pb-1">
      <CategoryRow
        icon={<Plus className="h-5 w-5" strokeWidth={1.75} />}
        label="Custom"
        action="Manual"
        onSelect={() => handleCategorySelect('custom')}
      />

      {isDesktop && (
        <CategoryRow
          icon={<Monitor className="h-5 w-5" strokeWidth={1.75} />}
          label="Computer Use"
          action={computerTrackingConnected ? 'Connected' : isAddingComputerHabit ? 'Adding…' : 'Connect'}
          connected={computerTrackingConnected}
          disabled={isAddingComputerHabit}
          onSelect={() => {
            if (computerTrackingConnected) {
              void openComputerUseSettings();
            } else {
              void handleComputerUseConnect();
            }
          }}
        />
      )}

      <CategoryRow
        icon={(
          <>
            <img
              src="/images/Screen_Time.svg"
              alt=""
              className="h-5 w-5 object-contain"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
                const fallback = event.currentTarget.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = 'block';
              }}
            />
            <svg className="hidden h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </>
        )}
        label="Screen Time"
        action="Connect"
        onSelect={() => handleCategorySelect('screentime')}
      />
      <CategoryRow
        icon={(
          <svg className="h-5 w-5" viewBox="0 0 814 1000" fill="currentColor">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
          </svg>
        )}
        label="Apple Watch"
        action={appleWatchConnected ? 'Connected' : 'Connect'}
        connected={appleWatchConnected}
        onSelect={selectAppleWatch}
      />
      <CategoryRow
        icon={<img src="/images/oura.svg" alt="" className="h-6 w-6 object-contain" />}
        label="Oura Ring"
        action={ouraConnected ? 'Connected' : 'Connect'}
        connected={ouraConnected}
        onSelect={() => handleCategorySelect('oura')}
      />
      <CategoryRow
        icon={<img src="/images/whoop.svg" alt="" className="h-5 object-contain" />}
        label="Whoop"
        action={whoopConnecting ? 'Connecting…' : whoopConnected ? 'Connected' : 'Connect'}
        connected={whoopConnected}
        disabled={whoopConnecting}
        onSelect={() => handleCategorySelect('whoop')}
      />
      <CategoryRow
        icon={<img src="/images/fitbit.svg" alt="" className="h-5 object-contain" />}
        label="Fitbit"
        action="Connect"
        onSelect={() => handleCategorySelect('fitbit')}
      />
      <CategoryRow
        icon={<img src="/images/garmin.svg" alt="" className="h-5 object-contain" />}
        label="Garmin"
        action={garminConnected ? 'Connected' : 'Connect'}
        connected={garminConnected}
        onSelect={() => handleCategorySelect('garmin')}
      />
      <CategoryRow
        icon={<img src="/images/plaid-mark.svg" alt="" className="h-5 object-contain" />}
        label="Plaid"
        action={plaidConnected ? 'Connected' : 'Connect'}
        connected={plaidConnected}
        onSelect={() => handleCategorySelect('plaid')}
      />
      <CategoryRow
        icon={<ChartLine className="h-5 w-5" strokeWidth={2} />}
        label="Productivity"
        action="Manual"
        onSelect={() => handleCategorySelect('productivity')}
      />
      <CategoryRow
        icon={<Brain className="h-5 w-5" strokeWidth={2} />}
        label="Learning"
        action="Manual"
        onSelect={() => handleCategorySelect('education')}
      />
      <CategoryRow
        icon={<Heart className="h-5 w-5" strokeWidth={2} />}
        label="Health"
        action="Manual"
        onSelect={() => handleCategorySelect('fitness')}
      />
      <CategoryRow
        icon={<FlaskConical className="h-5 w-5" strokeWidth={2} />}
        label="Experiments"
        action="Manual"
        onSelect={() => handleCategorySelect('experiments')}
      />
    </div>
  );
}
