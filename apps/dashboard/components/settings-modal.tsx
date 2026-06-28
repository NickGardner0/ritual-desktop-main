'use client';

import React, { startTransition, useCallback, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  User2,
  Monitor,
  MapPin,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { HexColorPicker } from 'react-colorful';
import { useFont, FontOption } from '@/contexts/FontContext';
import { useSidebarMode, type SidebarMode } from '@/contexts/SidebarModeContext';
import { CHROME_APPEARANCE_OPTIONS, useChromeAppearance } from '@/contexts/ChromeAppearanceContext';
import {
  useUIPreferences,
  contrastRatioAgainstWhite,
} from '@/hooks/use-ui-preferences';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleWatchSettings } from './apple-watch-settings';
import { PlaceTaggingSettings } from './place-tagging-settings';
import { PrivacySettingsPanel } from './privacy-settings-panel';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type SettingsTabId = 'account' | 'privacy' | 'computer-tracking' | 'place-tagging' | 'apple-health';

type SettingsView = SettingsTabId;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  initialView?: SettingsView;
}

interface TabConfig {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

function AppleGlyph({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

const TABS: Record<SettingsTabId, TabConfig> = {
  account: { label: 'General', icon: User2 },
  privacy: { label: 'Privacy', icon: ShieldCheck },
  'computer-tracking': { label: 'Computer Use', icon: Monitor },
  'place-tagging': { label: 'Place Tagging', icon: MapPin },
  'apple-health': { label: 'Apple Watch', icon: AppleGlyph },
};

const TAB_ORDER: SettingsTabId[] = ['account', 'privacy', 'computer-tracking', 'place-tagging', 'apple-health'];

const fontOptions: { value: FontOption; label: string }[] = [
  { value: 'fk-grotesk', label: 'FK Grotesk Neue' },
  { value: 'gt-standard', label: 'GT Standard' },
  { value: 'geist-sans', label: 'Geist Sans' },
  { value: 'system-ui', label: 'System UI' },
];

const sidebarModeOptions: { value: SidebarMode; label: string }[] = [
  { value: 'hidden', label: 'Hidden' },
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
  const { appearance: chromeAppearance, setAppearance: setChromeAppearance, selectedOption: selectedChromeOption } = useChromeAppearance();
  const { habitTextColor, setHabitTextColor } = useUIPreferences();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialView ?? 'account');
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showSidebarDropdown, setShowSidebarDropdown] = useState(false);
  const [showChromeDropdown, setShowChromeDropdown] = useState(false);
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
    startTransition(() => setShowAttributionHealth(enabled));
  }, [user]);

  const handleTabSelect = useCallback((id: SettingsTabId) => {
    setShowFontDropdown(false);
    setShowSidebarDropdown(false);
    setShowChromeDropdown(false);
    setShowColorPicker(false);
    setActiveTab(id);
  }, []);

  const habitTextLowContrast = contrastRatioAgainstWhite(habitTextColor) < 4.5;

  const handleClose = useCallback(() => {
    setActiveTab('account');
    setShowDeleteConfirm(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen]);

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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 text-[#2c2c2c]">
      <div
        className="absolute inset-0 bg-[#f1f0ec]/70 backdrop-blur-[3px]"
        onClick={handleClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="ritual-settings-window relative z-10 flex h-[min(690px,calc(100vh-48px))] w-[min(1080px,calc(100vw-48px))] overflow-hidden rounded-[28px] border border-black/15 bg-[#fbfbfa] shadow-[0_34px_90px_rgba(0,0,0,0.22),0_8px_28px_rgba(0,0,0,0.12)] ring-1 ring-white/80"
      >
        <aside className="flex w-[268px] shrink-0 flex-col border-r border-black/[0.06] bg-[#f8f8f7]/88 px-5 py-5 shadow-[inset_-1px_0_0_rgba(255,255,255,0.65)]">
          <div className="mb-8 flex h-4 items-center gap-2">
            <button
              type="button"
              aria-label="Close settings"
              onClick={handleClose}
              className="h-[14px] w-[14px] rounded-full border border-[#e04447] bg-[#ff5f57] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]"
            />
            <span className="h-[14px] w-[14px] rounded-full border border-[#dea123] bg-[#ffbd2e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]" />
            <span className="h-[14px] w-[14px] rounded-full border border-[#1ca43f] bg-[#28c840] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]" />
          </div>

          <nav className="flex flex-col gap-1 overflow-y-auto" aria-label="Settings sections">
            {TAB_ORDER.map((id) => {
              const { label, icon: Icon } = TABS[id];
              const selected = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => handleTabSelect(id)}
                  className={cn(
                    'ritual-snappy-row flex h-11 w-full items-center gap-3 rounded-[11px] px-3 text-left text-[15px] font-medium leading-none',
                    selected
                      ? 'bg-[#0f7f86] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                      : 'text-[#171717]',
                  )}
                  style={{
                    '--ritual-snappy-row-hover': 'rgba(0,0,0,0.045)',
                    '--ritual-snappy-row-active': '#0f7f86',
                  } as React.CSSProperties}
                  data-active={selected ? 'true' : undefined}
                >
                  <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={2.35} />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-[#fbfbfa]">
          {/* ============================================================ */}
          {/* General tab                                                   */}
          {/* ============================================================ */}
          {activeTab === 'account' && (
            <div className="mx-auto w-full max-w-[760px] px-10 py-8">
                <h1 className="mb-8 text-[20px] font-semibold leading-none text-[#4a4a4a]">General</h1>

                <SettingsGroup>
                  <div className="flex min-h-[70px] items-center gap-4 px-5 py-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#665ef1] text-[18px] font-semibold text-white">
                      {userInitial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold leading-tight text-[#252525]">{userName}</p>
                      <button
                        onClick={handleManageAccount}
                        className="mt-1 text-[13px] font-medium text-[#7a7a7a] transition-colors hover:text-[#252525]"
                      >
                        Manage account
                      </button>
                    </div>
                  </div>
                </SettingsGroup>

                <SettingsSection title="Preferences">
                  <SettingsRow
                    title="AI data retention"
                    description="Let Ritual save and use memories when answering."
                    control={<Toggle checked={aiDataRetention} onChange={() => setAiDataRetention(!aiDataRetention)} />}
                  />

                  <SettingsRow
                    title="App font"
                    control={(
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowFontDropdown(!showFontDropdown);
                            setShowSidebarDropdown(false);
                            setShowChromeDropdown(false);
                            setShowColorPicker(false);
                          }}
                          className="settings-value-button"
                        >
                          <span className={font === 'system-ui' ? 'font-system-ui' : ''}>
                            {fontOptions.find((f) => f.value === font)?.label}
                          </span>
                          <ChevronDown className="h-4 w-4 text-[#6f6f6f]" />
                        </button>
                        {showFontDropdown && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowFontDropdown(false)} />
                            <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[190px] overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-[0_16px_38px_rgba(0,0,0,0.16)]">
                              {fontOptions.map((option) => (
                                <button
                                  key={option.value}
                                  onClick={() => { setFont(option.value); setShowFontDropdown(false); }}
                                  className={cn(
                                    'flex w-full items-center justify-between px-3 py-2 text-[13px] text-left ritual-snappy-row ritual-snappy-row-muted-menu',
                                    font === option.value ? 'font-semibold text-[#252525]' : 'text-[#5f5f5f]',
                                    option.value === 'system-ui' && 'font-system-ui',
                                  )}
                                >
                                  {option.label}
                                  {font === option.value && <span className="text-[13px] text-[#252525]">✓</span>}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  />

                  <SettingsRow
                    title="Sidebar"
                    control={(
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowSidebarDropdown(!showSidebarDropdown);
                            setShowFontDropdown(false);
                            setShowChromeDropdown(false);
                            setShowColorPicker(false);
                          }}
                          className="settings-value-button"
                        >
                          <span>{sidebarModeOptions.find((o) => o.value === sidebarMode)?.label}</span>
                          <ChevronDown className="h-4 w-4 text-[#6f6f6f]" />
                        </button>
                        {showSidebarDropdown && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowSidebarDropdown(false)} />
                            <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[190px] overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-[0_16px_38px_rgba(0,0,0,0.16)]">
                              {sidebarModeOptions.map((option) => (
                                <button
                                  key={option.value}
                                  onClick={() => { setSidebarMode(option.value); setShowSidebarDropdown(false); }}
                                  className={cn(
                                    'flex w-full items-center justify-between px-3 py-2 text-[13px] text-left ritual-snappy-row ritual-snappy-row-muted-menu',
                                    sidebarMode === option.value ? 'font-semibold text-[#252525]' : 'text-[#5f5f5f]',
                                  )}
                                >
                                  {option.label}
                                  {sidebarMode === option.value && <span className="text-[13px] text-[#252525]">✓</span>}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  />

                  <SettingsRow
                    title="Chrome appearance"
                    control={(
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowChromeDropdown(!showChromeDropdown);
                            setShowFontDropdown(false);
                            setShowSidebarDropdown(false);
                            setShowColorPicker(false);
                          }}
                          className="settings-value-button"
                        >
                          <span>{selectedChromeOption.label}</span>
                          <ChevronDown className="h-4 w-4 text-[#6f6f6f]" />
                        </button>
                        {showChromeDropdown && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowChromeDropdown(false)} />
                            <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[220px] overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-[0_16px_38px_rgba(0,0,0,0.16)]">
                              {CHROME_APPEARANCE_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  onClick={() => {
                                    setChromeAppearance(option.value);
                                    setShowChromeDropdown(false);
                                  }}
                                  className={cn(
                                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] ritual-snappy-row ritual-snappy-row-muted-menu',
                                    chromeAppearance === option.value ? 'font-semibold text-[#252525]' : 'text-[#5f5f5f]',
                                  )}
                                >
                                  <span className="flex min-w-0 flex-col gap-0.5">
                                    <span>{option.label}</span>
                                    <span className="text-[11px] font-normal text-[#888]">{option.description}</span>
                                  </span>
                                  {chromeAppearance === option.value && <span className="text-[13px] text-[#252525]">✓</span>}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  />

                  <SettingsRow
                    title="Metric number color"
                    description={(
                      <>
                        Applies to the number portion of each metric on the Overview page.
                        {habitTextLowContrast && (
                          <span className="mt-1 block text-[12px] text-amber-600">
                            Low contrast - this color may be hard to read on a light background.
                          </span>
                        )}
                      </>
                    )}
                    control={(
                      <div className="relative">
                        <button
                          onClick={() => {
                            setShowColorPicker((open) => !open);
                            setShowFontDropdown(false);
                            setShowSidebarDropdown(false);
                            setShowChromeDropdown(false);
                          }}
                          className="settings-value-button"
                        >
                          <span
                            className="h-[18px] w-[18px] rounded-[5px] border border-black/15"
                            style={{ backgroundColor: habitTextColor }}
                          />
                          <span className="tabular-nums">{habitTextColor.toUpperCase()}</span>
                          <ChevronDown className="h-4 w-4 text-[#6f6f6f]" />
                        </button>
                        {showColorPicker && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setShowColorPicker(false)}
                            />
                            <div className="absolute right-0 top-full z-20 mt-1.5 rounded-xl border border-black/10 bg-white p-3 shadow-[0_16px_38px_rgba(0,0,0,0.16)]">
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
                    )}
                  />
                </SettingsSection>

                <SettingsSection title="Account">
                  <button
                    onClick={handleClearHistory}
                    className="settings-action-row"
                  >
                    Clear history
                  </button>

                  <button
                    onClick={handleSignOut}
                    className="settings-action-row"
                  >
                    Sign out
                  </button>

                  <button
                    onClick={handleDeleteAccount}
                    className="settings-action-row text-red-500 hover:text-red-600"
                  >
                    Delete account
                  </button>
                </SettingsSection>
            </div>
          )}

          {/* Privacy tab */}
          {activeTab === 'privacy' && (
            <div className="settings-embedded-pane mx-auto w-full max-w-[760px] px-10 py-8">
                <h1 className="mb-8 text-[20px] font-semibold leading-none text-[#4a4a4a]">Privacy</h1>
                <PrivacySettingsPanel />
            </div>
          )}

          {/* Computer Use tab */}
          {activeTab === 'computer-tracking' && (
            <div className="settings-embedded-pane mx-auto w-full max-w-[760px] px-10 py-8">
                <h1 className="mb-8 text-[20px] font-semibold leading-none text-[#4a4a4a]">Computer Use</h1>
                <ComputerTrackingSettings
                  userId={user?.id || ''}
                  showAttributionHealth={showAttributionHealth}
                  onClose={() => setActiveTab('account')}
                />
            </div>
          )}

          {/* Apple Watch tab */}
          {activeTab === 'apple-health' && (
            <div className="settings-embedded-pane mx-auto w-full max-w-[760px] px-10 py-8">
                <h1 className="mb-8 text-[20px] font-semibold leading-none text-[#4a4a4a]">Apple Watch</h1>
                <AppleWatchSettings />
            </div>
          )}

          {/* Place Tagging tab */}
          {activeTab === 'place-tagging' && (
            <div className="settings-embedded-pane mx-auto w-full max-w-[760px] px-10 py-8">
                <h1 className="mb-8 text-[20px] font-semibold leading-none text-[#4a4a4a]">Place Tagging</h1>
                <PlaceTaggingSettings />
            </div>
          )}
        </main>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="absolute inset-0 bg-white/25 backdrop-blur-[2px]" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative mx-4 max-w-sm rounded-2xl border border-black/10 bg-white p-6 shadow-[0_18px_54px_rgba(0,0,0,0.18)]">
            <h3 className="text-base font-semibold text-[#252525]">Delete account?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[#6f6f6f]">
              This action cannot be undone. All your data will be permanently deleted.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-lg border border-black/10 bg-[#f5f5f4] py-2.5 text-[13px] font-medium text-[#4a4a4a] transition-colors hover:bg-[#eeeeec]"
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
      aria-pressed={checked}
      className={cn(
        'relative inline-flex h-[22px] w-[42px] flex-shrink-0 items-center rounded-full transition-colors duration-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]',
        checked ? 'bg-[#0f7f86]' : 'bg-[#d9d9d7]',
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[15px] font-semibold leading-none text-[#2b2b2b]">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.07] overflow-visible rounded-[15px] bg-[#f4f4f3] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.018)]">
      {children}
    </div>
  );
}

function SettingsRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-[15px] font-medium leading-tight text-[#252525]">{title}</p>
        {description ? (
          <p className="mt-1 max-w-[460px] text-[13px] leading-snug text-[#7a7a7a]">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end">{control}</div>
    </div>
  );
}
