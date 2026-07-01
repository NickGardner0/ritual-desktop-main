'use client';

import React, { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Brain, Check, ChevronsUpDown, Hash, MapPin, Monitor, PanelLeft, Palette, Settings2, ShieldCheck, Type } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';

import { cn } from '@/lib/utils';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { type DesktopSettingsView } from '@/lib/tauri-utils';
import { useFont, type FontOption } from '@/contexts/FontContext';
import { useSidebarMode, type SidebarMode } from '@/contexts/SidebarModeContext';
import { CHROME_APPEARANCE_OPTIONS, useChromeAppearance } from '@/contexts/ChromeAppearanceContext';
import { contrastRatioAgainstWhite, useUIPreferences } from '@/hooks/use-ui-preferences';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleWatchSettings } from './apple-watch-settings';
import { PlaceTaggingSettings } from './place-tagging-settings';
import { PrivacySettingsPanel } from './privacy-settings-panel';
import {
  SettingsGroup as RitualSettingsGroup,
  SettingsRow as RitualSettingsRow,
} from '@/components/ui/ritual-system';

type SettingsFrameVariant = 'modal' | 'window';

export type SettingsFrameProps = {
  initialView?: DesktopSettingsView;
  variant?: SettingsFrameVariant;
  onClose?: () => void;
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
  'computer-tracking': { label: 'Computer Use', icon: Monitor },
  'place-tagging': { label: 'Place Tagging', icon: MapPin },
  'apple-health': { label: 'Apple Watch', icon: AppleGlyph },
};

const TAB_ORDER: DesktopSettingsView[] = ['account', 'privacy', 'computer-tracking', 'place-tagging', 'apple-health'];

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

export function normalizeSettingsFrameView(value: unknown): DesktopSettingsView {
  return value === 'privacy' || value === 'computer-tracking' || value === 'place-tagging' || value === 'apple-health'
    ? value
    : 'account';
}

export function SettingsFrame({
  initialView = 'account',
  variant = 'window',
  onClose,
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
  const showTrafficLights = variant === 'modal';

  const handleClose = useCallback(() => {
    closePopovers();
    setShowDeleteConfirm(false);
    onClose?.();
  }, [closePopovers, onClose]);

  const handleSignOut = async () => {
    await signOut();
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
    <div
      role={variant === 'modal' ? 'dialog' : undefined}
      aria-modal={variant === 'modal' ? true : undefined}
      aria-label={variant === 'modal' ? 'Settings' : undefined}
      className={cn(
        'settings-frame relative grid overflow-hidden bg-white text-[#1d1d1f]',
        variant === 'modal'
          ? 'settings-frame-modal z-10 h-[min(552px,calc(100vh-48px))] w-[min(780px,calc(100vw-48px))] grid-cols-[180px_minmax(0,520px)] justify-center gap-[16px] rounded-[12px] border border-black/15 p-4 pr-[13px] shadow-[0_18px_50px_rgba(0,0,0,0.22),0_3px_12px_rgba(0,0,0,0.12)]'
          : 'settings-frame-window h-screen w-screen grid-cols-[200px_minmax(0,1fr)]',
      )}
    >
      <aside
        className={cn(
          'settings-frame-sidebar flex h-full shrink-0 flex-col bg-[#faf9f9]',
          variant === 'modal'
            ? 'w-[180px] rounded-[12px] px-[9px] pb-3 pt-4'
            : 'settings-frame-sidebar-window w-[200px] border-r border-black/[0.08] px-[10px] pb-3',
        )}
      >
        {showTrafficLights ? (
          <div className="mb-[22px] ml-[8px] flex h-[12px] items-center gap-2">
            <button
              type="button"
              aria-label="Close settings"
              onClick={handleClose}
              className="h-[12px] w-[12px] rounded-full border border-[#e04447] bg-[#ff5f57] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.34)]"
            />
            <span className="h-[12px] w-[12px] rounded-full border border-[#dea123] bg-[#ffbd2e] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.34)]" />
            <span className="h-[12px] w-[12px] rounded-full border border-[#1ca43f] bg-[#28c840] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.34)]" />
          </div>
        ) : (
          <div data-tauri-drag-region className="h-[52px] w-full shrink-0" aria-hidden="true" />
        )}

        <nav className="flex flex-col gap-[2px] overflow-y-auto" aria-label="Settings sections">
          {TAB_ORDER.map((id) => {
            const { label, icon: Icon } = TABS[id];
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleTabSelect(id)}
                className={cn(
                  'ritual-snappy-row flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-[10px] text-left text-[13px] font-medium leading-none',
                  selected ? 'bg-black/[0.07] text-[#1d1d1f]' : 'text-[#3a3a3a]',
                )}
                style={{
                  '--ritual-snappy-row-hover': selected ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0.04)',
                  '--ritual-snappy-row-active': 'rgba(0,0,0,0.09)',
                } as React.CSSProperties}
                data-active={selected ? 'true' : undefined}
              >
                <Icon
                  className={cn('h-[15px] w-[15px] shrink-0', selected ? 'text-[#1d1d1f]' : 'text-[#6a6a6a]')}
                  strokeWidth={1.9}
                />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="settings-frame-main min-w-0 overflow-y-auto bg-white">
        {variant === 'window' ? (
          <div
            data-tauri-drag-region
            className="sticky top-0 z-[5] h-[52px] w-full border-b border-black/[0.06] bg-white/85 backdrop-blur-md"
            aria-hidden="true"
          />
        ) : null}
        <div className={variant === 'window' ? 'px-[22px]' : ''}>
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
                      <span className={font === 'system-ui' ? 'font-system-ui' : ''}>
                        {fontOptions.find((f) => f.value === font)?.label}
                      </span>
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
      <h1 className="mb-[16px] text-[14px] font-semibold leading-5 text-[#1d1d1f]">{title}</h1>
      <div className="space-y-[18px]">
        {children}
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-[6px] ml-[10px] text-[11px] font-semibold uppercase leading-none tracking-[0.045em] text-[#8a8a8a]">{title}</h2>
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
        'relative inline-flex h-4 w-[28px] flex-shrink-0 items-center rounded-full transition-colors duration-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]',
        checked ? 'bg-[#3c7783]' : 'bg-[#d9d9d7]',
      )}
    >
      <span
        className={cn(
          'inline-block h-3 w-3 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200',
          checked ? 'translate-x-[13px]' : 'translate-x-[2px]',
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
    <div className="inline-flex items-center gap-[2px] rounded-[7px] bg-black/[0.06] p-[2px]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[5px] px-2.5 py-[3px] text-[12px] font-medium leading-none transition-colors',
              active
                ? 'bg-white text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.06)]'
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
