'use client';

import React, { startTransition, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  User2,
  Monitor,
  X,
  ChevronDown,
  AlertTriangle,
  LogOut,
} from 'lucide-react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { HexColorPicker } from 'react-colorful';
import { useFont, FontOption } from '@/contexts/FontContext';
import { useSidebarMode, type SidebarMode } from '@/contexts/SidebarModeContext';
import {
  useUIPreferences,
  DEFAULT_HABIT_TEXT_COLOR,
  contrastRatioAgainstWhite,
} from '@/hooks/use-ui-preferences';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleWatchSettings } from './apple-watch-settings';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type SettingsTabId = 'account' | 'computer-tracking' | 'apple-health';

type SettingsView = SettingsTabId;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  initialView?: SettingsView;
}

interface TabConfig {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

const TABS: Record<SettingsTabId, TabConfig> = {
  account: { label: 'General', icon: User2 },
  'computer-tracking': { label: 'Computer Use', icon: Monitor },
  'apple-health': { label: 'Apple Watch', icon: AppleGlyph },
};

const TAB_ORDER: SettingsTabId[] = ['account', 'computer-tracking', 'apple-health'];

const fontOptions: { value: FontOption; label: string }[] = [
  { value: 'fk-grotesk', label: 'FK Grotesk Neue' },
  { value: 'geist-sans', label: 'Geist Sans' },
  { value: 'system-ui', label: 'System UI' },
];

const sidebarModeOptions: { value: SidebarMode; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'hover', label: 'Expand on Hover' },
  { value: 'expanded', label: 'Always Expanded' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsModal({ isOpen, onClose, onOpen, initialView }: SettingsModalProps) {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const router = useRouter();
  const { font, setFont } = useFont();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebarMode();
  const { habitTextColor, setHabitTextColor } = useUIPreferences();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialView ?? 'account');
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showSidebarDropdown, setShowSidebarDropdown] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAttributionHealth, setShowAttributionHealth] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && initialView) {
      startTransition(() => setActiveTab(initialView));
    }
  }, [isOpen, initialView]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current && onOpen) onOpen();
    wasOpenRef.current = isOpen;
  }, [isOpen, onOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const email = user?.primaryEmailAddress?.emailAddress || '';
    const enabled =
      email.includes('nickgardner') ||
      window.localStorage.getItem('ritual-show-attribution-health') === '1';
    setShowAttributionHealth(enabled);
  }, [user]);

  useEffect(() => {
    setShowFontDropdown(false);
    setShowSidebarDropdown(false);
    setShowColorPicker(false);
  }, [activeTab]);

  const habitTextLowContrast = contrastRatioAgainstWhite(habitTextColor) < 4.5;

  const handleClose = () => {
    setActiveTab('account');
    setShowDeleteConfirm(false);
    onClose();
  };

  if (!isOpen) return null;

  const userEmail = user?.primaryEmailAddress?.emailAddress || '';
  const userName = user?.username || user?.firstName || userEmail.split('@')[0];
  const userInitial = (userName || userEmail).charAt(0).toUpperCase();

  const handleManageAccount = () => {
    if (user) openUserProfile();
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const handleDeleteAccount = () => setShowDeleteConfirm(true);

  const confirmDeleteAccount = async () => {
    console.log('Account deletion confirmed');
    setShowDeleteConfirm(false);
  };

  const handleClearHistory = () => {
    console.log('Clear history clicked');
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative flex h-[min(540px,calc(100vh-3rem))] w-full max-w-[720px] flex-col overflow-hidden rounded-sm border border-gray-200/80 bg-[#FCFCFB] shadow-[0_24px_64px_rgba(0,0,0,0.08)] z-10">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200/60 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-gray-900">Settings</h2>
          <button onClick={handleClose} className="rounded-sm p-1.5 transition-colors hover:bg-gray-100">
            <X className="h-4 w-4 text-[#616161]" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar nav */}
          <nav className="w-44 flex-shrink-0 border-r border-gray-200/60 bg-[#F8F8F7] px-2.5 py-3 overflow-y-auto">
            <div className="flex flex-col gap-0.5">
              {TAB_ORDER.map((id) => {
                const { label, icon: Icon } = TABS[id];
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] text-left transition-colors',
                      'hover:bg-gray-200/50',
                      activeTab === id
                        ? 'bg-gray-200/60 text-gray-900 font-medium'
                        : 'text-[#616161]',
                    )}
                  >
                    <Icon className="h-[15px] w-[15px] flex-shrink-0" />
                    {label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto">
            {/* ============================================================ */}
            {/* General tab                                                   */}
            {/* ============================================================ */}
            {activeTab === 'account' && (
              <div className="p-5 space-y-5">
                {/* Profile */}
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#6366F1] text-[13px] font-medium text-white flex-shrink-0">
                    {userInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{userName}</p>
                    <button
                      onClick={handleManageAccount}
                      className="text-[13px] text-[#616161] hover:text-gray-900 transition-colors"
                    >
                      Manage account
                    </button>
                  </div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Preferences */}
                <div className="space-y-1">
                  {/* AI Data Retention */}
                  <div className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-[13px] font-medium text-gray-900">AI data retention</p>
                      <p className="text-[13px] text-[#616161]">Let Ritual save and use memories when answering.</p>
                    </div>
                    <Toggle checked={aiDataRetention} onChange={() => setAiDataRetention(!aiDataRetention)} />
                  </div>

                  {/* App Font */}
                  <div className="flex items-center justify-between py-2.5">
                    <p className="text-[13px] font-medium text-gray-900">App font</p>
                    <div className="relative">
                      <button
                        onClick={() => { setShowFontDropdown(!showFontDropdown); setShowSidebarDropdown(false); }}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <span className={font === 'system-ui' ? 'font-system-ui' : ''}>
                          {fontOptions.find((f) => f.value === font)?.label}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-[#616161]" />
                      </button>
                      {showFontDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowFontDropdown(false)} />
                          <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                            {fontOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => { setFont(option.value); setShowFontDropdown(false); }}
                                className={cn(
                                  'flex w-full items-center justify-between px-3 py-2 text-[13px] text-left transition-colors hover:bg-gray-50',
                                  font === option.value ? 'text-gray-900 font-medium' : 'text-[#616161]',
                                  option.value === 'system-ui' && 'font-system-ui',
                                )}
                              >
                                {option.label}
                                {font === option.value && <span className="text-[13px] text-gray-900">✓</span>}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Sidebar Mode */}
                  <div className="flex items-center justify-between py-2.5">
                    <p className="text-[13px] font-medium text-gray-900">Sidebar</p>
                    <div className="relative">
                      <button
                        onClick={() => { setShowSidebarDropdown(!showSidebarDropdown); setShowFontDropdown(false); }}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <span>{sidebarModeOptions.find((o) => o.value === sidebarMode)?.label}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-[#616161]" />
                      </button>
                      {showSidebarDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowSidebarDropdown(false)} />
                          <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                            {sidebarModeOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => { setSidebarMode(option.value); setShowSidebarDropdown(false); }}
                                className={cn(
                                  'flex w-full items-center justify-between px-3 py-2 text-[13px] text-left transition-colors hover:bg-gray-50',
                                  sidebarMode === option.value ? 'text-gray-900 font-medium' : 'text-[#616161]',
                                )}
                              >
                                {option.label}
                                {sidebarMode === option.value && <span className="text-[13px] text-gray-900">✓</span>}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Habit text color — Overview page only */}
                  <div className="flex items-start justify-between py-2.5">
                    <div className="pr-4">
                      <p className="text-[13px] font-medium text-gray-900">Metric number color</p>
                      <p className="text-[13px] text-[#616161]">
                        Applies to the number portion of each metric on the Overview page.
                      </p>
                      {habitTextLowContrast && (
                        <p className="mt-1 text-[12px] text-amber-600">
                          Low contrast — this color may be hard to read on a light background.
                        </p>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowColorPicker((open) => !open);
                          setShowFontDropdown(false);
                          setShowSidebarDropdown(false);
                        }}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <span
                          className="h-4 w-4 rounded-sm border border-gray-200"
                          style={{ backgroundColor: habitTextColor }}
                        />
                        <span className="tabular-nums">{habitTextColor.toUpperCase()}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-[#616161]" />
                      </button>
                      {showColorPicker && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowColorPicker(false)}
                          />
                          <div className="absolute right-0 top-full z-20 mt-1.5 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                            <HexColorPicker
                              color={habitTextColor}
                              onChange={(next) => {
                                void setHabitTextColor(next);
                              }}
                            />
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className="text-[12px] text-[#616161] tabular-nums">
                                {habitTextColor.toUpperCase()}
                              </span>
                              <button
                                onClick={() => {
                                  void setHabitTextColor(null);
                                  setShowColorPicker(false);
                                }}
                                className="text-[12px] text-[#616161] transition-colors hover:text-gray-900"
                              >
                                Reset to default
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Account actions */}
                <div className="space-y-1">
                  <button
                    onClick={handleClearHistory}
                    className="flex w-full items-center py-2.5 text-[13px] text-gray-700 transition-colors hover:text-gray-900"
                  >
                    Clear history
                  </button>

                  <button
                    onClick={handleSignOut}
                    className="flex w-full items-center py-2.5 text-[13px] text-gray-700 transition-colors hover:text-gray-900"
                  >
                    Sign out
                  </button>

                  <button
                    onClick={handleDeleteAccount}
                    className="flex w-full items-center py-2.5 text-[13px] text-red-500 transition-colors hover:text-red-600"
                  >
                    Delete account
                  </button>
                </div>
              </div>
            )}

            {/* Computer Use tab */}
            {activeTab === 'computer-tracking' && (
              <div className="p-5">
                <ComputerTrackingSettings
                  userId={user?.id || ''}
                  showAttributionHealth={showAttributionHealth}
                  onClose={() => setActiveTab('account')}
                />
              </div>
            )}

            {/* Apple Watch tab */}
            {activeTab === 'apple-health' && (
              <div className="p-5">
                <AppleWatchSettings />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/10 backdrop-blur-[1px]" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative mx-4 max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-gray-900">Delete account?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[#616161]">
              This action cannot be undone. All your data will be permanently deleted.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAccount}
                className="flex-1 rounded-lg bg-red-500 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}

// ---------------------------------------------------------------------------
// Shared toggle component
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-gray-900' : 'bg-gray-200',
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
