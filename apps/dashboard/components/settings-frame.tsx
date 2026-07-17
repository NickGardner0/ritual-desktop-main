'use client';

import React, { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Brain, Check, ChevronsUpDown, Hash, MapPin, Mic, Monitor, PanelLeft, Palette, Settings2, ShieldCheck, Type } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';

import { cn } from '@/lib/utils';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { signOutOfRitual } from '@/lib/desktop-auth-session';
import { type DesktopSettingsView } from '@/lib/tauri-utils';
import { useFont, type FontOption } from '@/contexts/FontContext';
import { useSidebarMode, type SidebarMode } from '@/contexts/SidebarModeContext';
import { CHROME_APPEARANCE_OPTIONS, useChromeAppearance } from '@/contexts/ChromeAppearanceContext';
import { contrastRatioAgainstWhite, useUIPreferences } from '@/hooks/use-ui-preferences';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleWatchSettings } from './apple-watch-settings';
import { PlaceTaggingSettings } from './place-tagging-settings';
import { PrivacySettingsPanel } from './privacy-settings-panel';
import { VoiceSettings } from './voice-settings';
import {
  SettingsGroup as RitualSettingsGroup,
  SettingsRow as RitualSettingsRow,
} from '@/components/ui/ritual-system';

export type SettingsFrameProps = {
  initialView?: DesktopSettingsView;
  listenForDesktopShow?: boolean;
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
  account: { label: 'General', icon: Settings2 },
  privacy: { label: 'Privacy', icon: ShieldCheck },
  voice: { label: 'Voice', icon: Mic },
  'computer-tracking': { label: 'Computer Use', icon: Monitor },
  'place-tagging': { label: 'Place Tagging', icon: MapPin },
  'apple-health': { label: 'Apple Watch', icon: AppleGlyph },
};

const TAB_ORDER: DesktopSettingsView[] = ['account', 'privacy', 'voice', 'computer-tracking', 'place-tagging', 'apple-health'];

const fontOptions: { value: FontOption; label: string }[] = [
  { value: 'fk-grotesk', label: 'FK Grotesk Neue' },
  { value: 'gt-standard', label: 'GT Standard' },
  { value: 'gt-america', label: 'GT America' },
  { value: 'geist-sans', label: 'Geist Sans' },
];

const sidebarModeOptions: { value: SidebarMode; label: string }[] = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'compact', label: 'Compact' },
  { value: 'hover', label: 'Expand on Hover' },
  { value: 'expanded', label: 'Always Expanded' },
];

export function normalizeSettingsFrameView(value: unknown): DesktopSettingsView {
  return value === 'privacy' || value === 'voice' || value === 'computer-tracking' || value === 'place-tagging' || value === 'apple-health'
    ? value
    : 'account';
}

export function SettingsFrame({
  initialView = 'account',
  listenForDesktopShow = false,
}: SettingsFrameProps) {
  const { isDesktop } = useDesktopCapabilities();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const router = useRouter();
  const { font, setFont } = useFont();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebarMode();
  const { appearance: chromeAppearance, setAppearance: setChromeAppearance, selectedOption: selectedChromeOption } = useChromeAppearance();
  const { habitTextColor, setHabitTextColor } = useUIPreferences();
  const [activeTab, setActiveTab] = useState<DesktopSettingsView>(() => normalizeSettingsFrameView(initialView));
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showSidebarDropdown, setShowSidebarDropdown] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAttributionHealth, setShowAttributionHealth] = useState(false);
  const unlistenRef = useRef<null | (() => void)>(null);

  const closePopovers = useCallback(() => {
    setShowFontDropdown(false);
    setShowSidebarDropdown(false);
    setShowColorPicker(false);
  }, []);

  const handleTabSelect = useCallback((id: DesktopSettingsView) => {
    closePopovers();
    setShowDeleteConfirm(false);
    setActiveTab(id);
  }, [closePopovers]);

  useEffect(() => {
    startTransition(() => setActiveTab(normalizeSettingsFrameView(initialView)));
  }, [initialView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const email = user?.primaryEmailAddress?.emailAddress || '';
    const enabled =
      email.includes('nickgardner') ||
      window.localStorage.getItem('ritual-show-attribution-health') === '1';
    startTransition(() => setShowAttributionHealth(enabled));
  }, [user?.primaryEmailAddress?.emailAddress]);

  useEffect(() => {
    if (!listenForDesktopShow || !isDesktop) return;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const unlisten = await listen<{ initialView?: string }>('settings:show', (event) => {
        handleTabSelect(normalizeSettingsFrameView(event.payload?.initialView));
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
  }, [handleTabSelect, isDesktop, listenForDesktopShow]);

  const userEmail = user?.primaryEmailAddress?.emailAddress || '';
  const userName = user?.username || user?.firstName || userEmail.split('@')[0] || 'Account';
  const userInitial = (userName || userEmail || 'R').charAt(0).toUpperCase();
  const activeTabConfig = TABS[activeTab];
  const habitTextLowContrast = contrastRatioAgainstWhite(habitTextColor) < 4.5;

  const handleSignOut = async () => {
    await signOutOfRitual(signOut);
    router.push('/');
  };

  const handleManageAccount = () => {
    if (user) openUserProfile();
  };

  const handleClearHistory = () => {
    console.log('Clear history clicked');
  };

  const confirmDeleteAccount = async () => {
    console.log('Account deletion confirmed');
    setShowDeleteConfirm(false);
  };

  return (
    <div className="settings-frame settings-frame-window ritual-settings-window relative flex h-screen w-screen overflow-hidden bg-white text-[#1d1d1f]">
      <div className="settings-frame-body flex min-h-0 min-w-0 flex-1 flex-row">
        <aside className="settings-frame-sidebar settings-frame-sidebar-window flex w-[200px] shrink-0 flex-col overflow-hidden border-r border-black/[0.08] bg-[#f7f7f7] px-[8px] pb-3">
          <div
            className="tauri-drag-region flex h-[52px] shrink-0 items-center px-[4px]"
            data-tauri-drag-region
            aria-hidden="true"
          />

          <nav className="flex flex-col gap-[2px] overflow-y-auto" aria-label="Settings sections">
            {TAB_ORDER.map((id) => {
              const { label, icon: Icon } = TABS[id];
              const selected = activeTab === id;
              const selectedColor = 'rgba(0,0,0,0.06)';
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleTabSelect(id)}
                  className={cn(
                    'ritual-snappy-row flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-[10px] text-left text-[13px] font-medium leading-none transition-colors',
                    selected
                      ? 'bg-black/[0.06] text-[#1d1d1f]'
                      : 'text-[#1d1d1f]',
                  )}
                  style={{
                    '--ritual-snappy-row-hover': selected ? selectedColor : 'rgba(0,0,0,0.04)',
                    '--ritual-snappy-row-active': selected ? selectedColor : 'rgba(0,0,0,0.07)',
                  } as React.CSSProperties}
                  data-active={selected ? 'true' : undefined}
                >
                  <Icon
                    className="h-[15px] w-[15px] shrink-0 text-[#1d1d1f]"
                    strokeWidth={1.75}
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="settings-frame-main relative min-w-0 flex-1 overflow-y-auto bg-white">
        <div
          data-tauri-drag-region
          className="tauri-drag-region sticky top-0 z-[5] h-[52px] w-full shrink-0"
          aria-hidden="true"
        />
        <div className="px-6 -mt-[52px]">
        {activeTab === 'account' ? (
          <SettingsPage title="General">
            <SettingsGroup>
              <div className="flex min-h-[58px] items-center gap-3 px-[14px] py-2.5">
                <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#665ef1] text-[15px] font-semibold text-white">
                  {userInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold leading-tight text-[#252525]">{userName}</p>
                  <button
                    type="button"
                    onClick={handleManageAccount}
                    className="mt-0.5 text-[12px] font-medium text-[#8a8a8a] transition-colors hover:text-[#252525]"
                  >
                    Manage account
                  </button>
                </div>
              </div>
            </SettingsGroup>

            <SettingsSection title="Preferences">
              <SettingsRow
                icon={<Brain className="h-[15px] w-[15px]" strokeWidth={1.9} />}
                title="AI data retention"
                description="Let Ritual save and use memories when answering."
                control={<SettingsToggle checked={aiDataRetention} onClick={() => setAiDataRetention(!aiDataRetention)} />}
              />

              <SettingsRow
                icon={<Type className="h-[15px] w-[15px]" strokeWidth={1.9} />}
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
                      className="settings-value-button"
                    >
                      <span>{fontOptions.find((f) => f.value === font)?.label}</span>
                      <ChevronsUpDown className="h-[13px] w-[13px] text-[#8a8a8a]" />
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
                icon={<PanelLeft className="h-[15px] w-[15px]" strokeWidth={1.9} />}
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
                      className="settings-value-button"
                    >
                      <span>{sidebarModeOptions.find((option) => option.value === sidebarMode)?.label}</span>
                      <ChevronsUpDown className="h-[13px] w-[13px] text-[#8a8a8a]" />
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
                icon={<Palette className="h-[15px] w-[15px]" strokeWidth={1.9} />}
                title="Chrome appearance"
                description={selectedChromeOption.description}
                control={(
                  <SegmentedControl
                    value={chromeAppearance}
                    onChange={(value) => setChromeAppearance(value)}
                    options={CHROME_APPEARANCE_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                )}
              />

              <SettingsRow
                icon={<Hash className="h-[15px] w-[15px]" strokeWidth={1.9} />}
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
                      className="settings-value-button"
                    >
                      <span
                        className="h-[15px] w-[15px] rounded-[4px] border border-black/15"
                        style={{ backgroundColor: habitTextColor }}
                      />
                      <span className="tabular-nums">{habitTextColor.toUpperCase()}</span>
                      <ChevronsUpDown className="h-[13px] w-[13px] text-[#8a8a8a]" />
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
              <button type="button" onClick={handleClearHistory} className="settings-action-row">
                Clear history
              </button>
              <button type="button" onClick={handleSignOut} className="settings-action-row">
                Sign out
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="settings-action-row text-red-500 hover:text-red-600"
              >
                Delete account
              </button>
            </SettingsSection>
          </SettingsPage>
        ) : null}

        {activeTab === 'privacy' ? (
          <SettingsPage title="Privacy" embedded>
            <PrivacySettingsPanel />
          </SettingsPage>
        ) : null}

        {activeTab === 'voice' ? (
          <SettingsPage title="Voice" embedded>
            <VoiceSettings />
          </SettingsPage>
        ) : null}

        {activeTab === 'computer-tracking' ? (
          <SettingsPage title="Computer Use" embedded>
            <ComputerTrackingSettings
              userId={user?.id || ''}
              showAttributionHealth={showAttributionHealth}
              onClose={() => handleTabSelect('account')}
            />
          </SettingsPage>
        ) : null}

        {activeTab === 'place-tagging' ? (
          <SettingsPage title="Place Tagging" embedded>
            <PlaceTaggingSettings />
          </SettingsPage>
        ) : null}

        {activeTab === 'apple-health' ? (
          <SettingsPage title={activeTabConfig.label} embedded>
            <AppleWatchSettings />
          </SettingsPage>
        ) : null}
        </div>
      </main>
      </div>

      {showDeleteConfirm ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="absolute inset-0 bg-white/25 backdrop-blur-[2px]" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative mx-4 max-w-sm rounded-[12px] border border-black/10 bg-white p-6 shadow-[0_18px_54px_rgba(0,0,0,0.18)]">
            <h3 className="text-base font-semibold text-[#252525]">Delete account?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[#6f6f6f]">
              This action cannot be undone. All your data will be permanently deleted.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-lg border border-black/10 bg-[#f5f5f4] py-2.5 text-[13px] font-medium text-[#4a4a4a] transition-colors hover:bg-[#eeeeec]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteAccount}
                className="flex-1 rounded-lg bg-red-500 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsPage({
  title,
  embedded,
  children,
}: {
  title: string;
  embedded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('settings-frame-page w-full pb-6 pt-[14px]', embedded && 'settings-embedded-pane')}>
      <h1 className="mb-[18px] text-[20px] font-semibold leading-[1.2] tracking-[-0.02em] text-[#1d1d1f]">{title}</h1>
      <div className="space-y-[18px]">
        {children}
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-[8px] text-[13px] font-semibold leading-tight text-[#1d1d1f]">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return (
    <RitualSettingsGroup>
      {children}
    </RitualSettingsGroup>
  );
}

function SettingsRow({
  title,
  description,
  control,
  icon,
}: {
  title: string;
  description?: React.ReactNode;
  control: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <RitualSettingsRow>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[#7a7a7a]">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-[16px] text-[#1d1d1f]">{title}</p>
          {description ? (
            <p className="mt-[2px] max-w-[330px] text-[12px] leading-[15px] text-[#8a8a8a]">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end">{control}</div>
    </RitualSettingsRow>
  );
}

function SettingsToggle({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={cn(
        'relative inline-flex h-5 w-[38px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-black' : 'bg-[#d1d1d1]',
      )}
    >
      <span
        className={cn(
          'inline-block h-[17px] w-[17px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.28),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform duration-200',
          checked ? 'translate-x-[19px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-[2px] rounded-[8px] bg-black/[0.06] p-[3px]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[6px] px-3 py-[5px] text-[12px] font-medium leading-none transition-all',
              active
                ? 'bg-white text-[#1d1d1f] shadow-[0_0_0_1px_rgba(26,99,107,0.55),0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-[#5f5f5f] hover:text-[#1d1d1f]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
          'absolute right-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-[8px] border border-black/10 bg-white py-1 shadow-[0_12px_30px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.06)]',
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
        'ritual-snappy-row ritual-snappy-row-muted-menu flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px]',
        selected ? 'font-semibold text-[#252525]' : 'text-[#5f5f5f]',
      )}
    >
      <span>{children}</span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-[#252525]" /> : null}
    </button>
  );
}
