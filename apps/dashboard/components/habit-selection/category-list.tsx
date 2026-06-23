'use client';

import React from 'react';
import {
  ChevronDown, ChartLine, Brain, Heart, FlaskConical, Plus, Monitor,
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
  return (
            <div className="pb-2">
                {/* Custom - Manual */}
                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <Plus className="h-5 w-5 text-gray-900" strokeWidth={1.75} />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Custom</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('custom')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                {/* Computer Use - Only show on desktop (Tauri) */}
                {isDesktop && (
                  <div className={categoryRowClass}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                        <Monitor className="h-5 w-5 text-gray-900" strokeWidth={1.75} />
                      </div>
                      <p className="text-sm font-medium leading-none text-[#1f1e1a]">Computer Use</p>
                    </div>
                    {computerTrackingConnected ? (
                      <button 
                        type="button"
                        onClick={() => void openComputerUseSettings()}
                        className={connectRowActionConnectedClass}
                      >
                        Connected
                      </button>
                    ) : (
                      <button 
                        type="button"
                        onClick={() => void handleComputerUseConnect()}
                        disabled={isAddingComputerHabit}
                        className={`${connectRowActionClass} disabled:opacity-50`}
                      >
                        {isAddingComputerHabit ? 'Adding…' : 'Connect'}
                      </button>
                    )}
                  </div>
                )}

                {/* Wearables & Devices - Connect */}
                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <img src="/images/Screen_Time.svg" alt="Screen Time" className="h-5 w-5 object-contain" onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextSibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextSibling) nextSibling.style.display = 'block';
                      }} />
                      <svg className="h-5 w-5 text-gray-700" style={{display: 'none'}} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Screen Time</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('screentime')}
                    className={connectRowActionClass}
                  >
                    Connect
                  </button>
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <svg className="h-5 w-5" viewBox="0 0 814 1000" fill="currentColor">
                        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
                      </svg>
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Apple Watch</p>
                  </div>
                  {appleWatchConnected ? (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('applewatch')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => {
                        alert(
                          '📱 To connect your Apple Watch:\n\n' +
                          '1. Download the Ritual Companion app on your iPhone\n' +
                          '2. Sign in with your Ritual account\n' +
                          '3. Tap "Connect" to register your device\n' +
                          '4. Grant HealthKit permissions\n\n' +
                          'Your Apple Watch data syncs through your iPhone.'
                        );
                      }}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <img src="/images/oura.svg" alt="Oura Ring" className="h-6 w-6 object-contain" />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Oura Ring</p>
                  </div>
                  {ouraConnected ? (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('oura')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('oura')}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <img src="/images/whoop.svg" alt="Whoop" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Whoop</p>
                  </div>
                  {whoopConnected ? (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('whoop')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button 
                      type="button"
                      onClick={() => handleCategorySelect('whoop')}
                      disabled={whoopConnecting}
                      className={`${connectRowActionClass} disabled:opacity-50`}
                    >
                      <span className="truncate">{whoopConnecting ? 'Connecting...' : 'Connect'}</span>
                    </button>
                  )}
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <img src="/images/fitbit.svg" alt="Fitbit" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Fitbit</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('fitbit')}
                    className={connectRowActionClass}
                  >
                    Connect
                  </button>
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <img src="/images/garmin.svg" alt="Garmin" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Garmin</p>
                  </div>
                  {garminConnected ? (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('garmin')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('garmin')}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <img src="/images/plaid-mark.svg" alt="Plaid" className="h-5 object-contain" />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Plaid</p>
                  </div>
                  {plaidConnected ? (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('plaid')}
                      className={connectRowActionConnectedClass}
                    >
                      Connected
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('plaid')}
                      className={connectRowActionClass}
                    >
                      Connect
                    </button>
                  )}
                </div>

                {/* Manual Tracking Categories */}
                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <ChartLine className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Productivity</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('productivity')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <Brain className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Learning</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('education')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <Heart className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Health</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('fitness')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>

                <div className={categoryRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                      <FlaskConical className="h-5 w-5 text-gray-900" strokeWidth={2} />
                    </div>
                    <p className="text-sm font-medium leading-none text-[#1f1e1a]">Experiments</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCategorySelect('experiments')}
                    className={connectRowActionClass}
                  >
                    Manual
                  </button>
                </div>
            </div>

  );
}
