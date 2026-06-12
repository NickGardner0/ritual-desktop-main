'use client';

import React, { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { ChevronDown, MapPin, Monitor, User2 } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';

import { cn } from '@/lib/utils';
import { isTauri, type DesktopSettingsView } from '@/lib/tauri-utils';
import { useFont, type FontOption } from '@/contexts/FontContext';
import { useSidebarMode, type SidebarMode } from '@/contexts/SidebarModeContext';
import { contrastRatioAgainstWhite, useUIPreferences } from '@/hooks/use-ui-preferences';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleWatchSettings } from './apple-watch-settings';
import { PlaceTaggingSettings } from './place-tagging-settings';

type SettingsWindowContentProps = {
  initialView?: DesktopSettingsView;
};

type TabConfig = {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

function AppleGlyph({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

const TABS: Record<DesktopSettingsView, TabConfig> = {
  account: { label: 'General', icon: User2 },
  'computer-tracking': { label: 'Computer Use', icon: Monitor },
  'place-tagging': { label: 'Place Tagging', icon: MapPin },
  'apple-health': { label: 'Apple Watch', icon: AppleGlyph },
};

const TAB_ORDER: DesktopSettingsView[] = ['account', 'computer-tracking', 'place-tagging', 'apple-health'];

const fontOptions: { value: FontOption; label: string }[] = [
  { value: 'fk-grotesk', label: 'FK Grotesk Neue' },
  { value: 'gt-standard', label: 'GT Standard' },
  { value: 'geist-sans', label: 'Geist Sans' },
  { value: 'system-ui', label: 'System UI' },
];

const sidebarModeOptions: { value: SidebarMode; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'hover', label: 'Expand on Hover' },
  { value: 'expanded', label: 'Always Expanded' },
];

function normalizeSettingsView(value: unknown): DesktopSettingsView {
  return value === 'computer-tracking' || value === 'place-tagging' || value === 'apple-health'
    ? value
    : 'account';
}

export function SettingsWindowContent({ initialView = 'account' }: SettingsWindowContentProps) {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const router = useRouter();
  const { font, setFont } = useFont();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebarMode();
  const { habitTextColor, setHabitTextColor } = useUIPreferences();
  const [activeTab, setActiveTab] = useState<DesktopSettingsView>(() => normalizeSettingsView(initialView));
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showSidebarDropdown, setShowSidebarDropdown] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAttributionHealth, setShowAttributionHealth] = useState(false);
  const unlistenRef = useRef<null | (() => void)>(null);

  const handleTabSelect = useCallback((id: DesktopSettingsView) => {
    setShowFontDropdown(false);
    setShowSidebarDropdown(false);
    setShowColorPicker(false);
    setActiveTab(id);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const email = user?.primaryEmailAddress?.emailAddress || '';
    const enabled =
      email.includes('nickgardner') ||
      window.localStorage.getItem('ritual-show-attribution-health') === '1';
    startTransition(() => setShowAttributionHealth(enabled));
  }, [user?.primaryEmailAddress?.emailAddress]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const unlisten = await listen<{ initialView?: string }>('settings:show', (event) => {
        handleTabSelect(normalizeSettingsView(event.payload?.initialView));
      });
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenRef.current = unlisten;
    });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [handleTabSelect]);

  const userEmail = user?.primaryEmailAddress?.emailAddress || '';
  const userName = user?.username || user?.firstName || userEmail.split('@')[0] || 'Account';
  const userInitial = (userName || userEmail || 'R').charAt(0).toUpperCase();
  const activeTabConfig = TABS[activeTab];
  const habitTextLowContrast = contrastRatioAgainstWhite(habitTextColor) < 4.5;

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <div className="settings-native-window flex h-screen w-screen overflow-hidden bg-[#fbfbfa] text-[#262626]">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-black/[0.07] bg-[#f8f8f7] px-[18px] pb-5 pt-[54px]">
        <nav className="flex flex-col gap-1" aria-label="Settings sections">
          {TAB_ORDER.map((id) => {
            const { label, icon: Icon } = TABS[id];
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleTabSelect(id)}
                className={cn(
                  'flex h-9 items-center gap-3 rounded-[9px] px-3 text-left text-[14px] font-medium leading-none transition-colors',
                  selected ? 'bg-[#0f7f86] text-white' : 'text-[#171717] hover:bg-black/[0.045]',
                )}
              >
                <Icon className="h-[16px] w-[16px] shrink-0" strokeWidth={2.2} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[650px] px-8 pb-8 pt-[50px]">
          <h1 className="mb-7 text-[18px] font-semibold leading-none text-[#454545]">
            {activeTabConfig.label}
          </h1>

          {activeTab === 'account' ? (
            <div className="space-y-7">
              <SettingsGroup>
                <div className="flex min-h-[58px] items-center gap-3 px-4 py-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#665ef1] text-[16px] font-semibold text-white">
                    {userInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold leading-tight text-[#252525]">{userName}</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (user) openUserProfile();
                      }}
                      className="mt-1 text-[12px] font-medium text-[#7a7a7a] transition-colors hover:text-[#252525]"
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
                  control={<NativeToggle checked={aiDataRetention} onClick={() => setAiDataRetention(!aiDataRetention)} />}
                />

                <SettingsRow
                  title="App font"
                  control={(
                    <PopupRoot>
                      <button
                        type="button"
                        onClick={() => {
                          setShowFontDropdown(!showFontDropdown);
                          setShowSidebarDropdown(false);
                          setShowColorPicker(false);
                        }}
                        className="settings-native-value-button"
                      >
                        <span className={font === 'system-ui' ? 'font-system-ui' : ''}>
                          {fontOptions.find((f) => f.value === font)?.label}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-[#6f6f6f]" />
                      </button>
                      {showFontDropdown ? (
                        <Dropdown onClose={() => setShowFontDropdown(false)}>
                          {fontOptions.map((option) => (
                            <DropdownItem
                              key={option.value}
                              selected={font === option.value}
                              onClick={() => {
                                setFont(option.value);
                                setShowFontDropdown(false);
                              }}
                            >
                              {option.label}
                            </DropdownItem>
                          ))}
                        </Dropdown>
                      ) : null}
                    </PopupRoot>
                  )}
                />

                <SettingsRow
                  title="Sidebar"
                  control={(
                    <PopupRoot>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSidebarDropdown(!showSidebarDropdown);
                          setShowFontDropdown(false);
                          setShowColorPicker(false);
                        }}
                        className="settings-native-value-button"
                      >
                        <span>{sidebarModeOptions.find((option) => option.value === sidebarMode)?.label}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-[#6f6f6f]" />
                      </button>
                      {showSidebarDropdown ? (
                        <Dropdown onClose={() => setShowSidebarDropdown(false)}>
                          {sidebarModeOptions.map((option) => (
                            <DropdownItem
                              key={option.value}
                              selected={sidebarMode === option.value}
                              onClick={() => {
                                setSidebarMode(option.value);
                                setShowSidebarDropdown(false);
                              }}
                            >
                              {option.label}
                            </DropdownItem>
                          ))}
                        </Dropdown>
                      ) : null}
                    </PopupRoot>
                  )}
                />

                <SettingsRow
                  title="Metric number color"
                  description={(
                    <>
                      Applies to the number portion of each metric on the Overview page.
                      {habitTextLowContrast ? (
                        <span className="mt-1 block text-[12px] text-amber-600">
                          Low contrast - this color may be hard to read on a light background.
                        </span>
                      ) : null}
                    </>
                  )}
                  control={(
                    <PopupRoot>
                      <button
                        type="button"
                        onClick={() => {
                          setShowColorPicker(!showColorPicker);
                          setShowFontDropdown(false);
                          setShowSidebarDropdown(false);
                        }}
                        className="settings-native-value-button"
                      >
                        <span
                          className="h-4 w-4 rounded-[4px] border border-black/15"
                          style={{ backgroundColor: habitTextColor }}
                        />
                        <span className="tabular-nums">{habitTextColor.toUpperCase()}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-[#6f6f6f]" />
                      </button>
                      {showColorPicker ? (
                        <Dropdown onClose={() => setShowColorPicker(false)} className="w-auto p-3">
                          <HexColorPicker color={habitTextColor} onChange={(next) => void setHabitTextColor(next)} />
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-[12px] text-[#616161] tabular-nums">
                              {habitTextColor.toUpperCase()}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                void setHabitTextColor(null);
                                setShowColorPicker(false);
                              }}
                              className="text-[12px] text-[#616161] transition-colors hover:text-gray-900"
                            >
                              Reset
                            </button>
                          </div>
                        </Dropdown>
                      ) : null}
                    </PopupRoot>
                  )}
                />
              </SettingsSection>

              <SettingsSection title="Account">
                <button type="button" className="settings-native-action-row">
                  Clear history
                </button>
                <button type="button" onClick={handleSignOut} className="settings-native-action-row">
                  Sign out
                </button>
                <button type="button" className="settings-native-action-row text-red-500 hover:text-red-600">
                  Delete account
                </button>
              </SettingsSection>
            </div>
          ) : null}

          {activeTab === 'computer-tracking' ? (
            <div className="settings-native-embedded">
              <ComputerTrackingSettings
                userId={user?.id || ''}
                showAttributionHealth={showAttributionHealth}
                onClose={() => handleTabSelect('account')}
              />
            </div>
          ) : null}

          {activeTab === 'place-tagging' ? (
            <div className="settings-native-embedded">
              <PlaceTaggingSettings />
            </div>
          ) : null}

          {activeTab === 'apple-health' ? (
            <div className="settings-native-embedded">
              <AppleWatchSettings />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[14px] font-semibold leading-none text-[#2b2b2b]">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-black/[0.07] overflow-visible rounded-[12px] bg-[#f4f4f3]">
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
    <div className="grid min-h-[50px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-tight text-[#252525]">{title}</p>
        {description ? (
          <p className="mt-1 max-w-[390px] text-[12px] leading-snug text-[#7a7a7a]">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end">{control}</div>
    </div>
  );
}

function NativeToggle({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={cn(
        'relative inline-flex h-[20px] w-[38px] flex-shrink-0 items-center rounded-full transition-colors duration-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]',
        checked ? 'bg-[#0f7f86]' : 'bg-[#d9d9d7]',
      )}
    >
      <span
        className={cn(
          'inline-block h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition-transform duration-200',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function PopupRoot({ children }: { children: React.ReactNode }) {
  return <div className="relative">{children}</div>;
}

function Dropdown({
  children,
  onClose,
  className,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        className={cn(
          'absolute right-0 top-full z-20 mt-1.5 min-w-[178px] overflow-hidden rounded-[11px] border border-black/10 bg-white py-1 shadow-[0_14px_34px_rgba(0,0,0,0.14)]',
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

function DropdownItem({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors hover:bg-black/[0.04]',
        selected ? 'font-semibold text-[#252525]' : 'text-[#5f5f5f]',
      )}
    >
      <span>{children}</span>
      {selected ? <span>✓</span> : null}
    </button>
  );
}
