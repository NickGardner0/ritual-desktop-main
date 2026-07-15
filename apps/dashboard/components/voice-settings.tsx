'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  getVoiceHotkeySettings,
  setVoiceHotkeySettings,
  type VoiceHotkeySettings as VoiceHotkeySettingsValue,
} from '@/lib/tauri-utils';
import { cn } from '@/lib/utils';

const DEFAULT_SHORTCUT = 'Alt+Space';

function displayShortcut(shortcut: string) {
  return shortcut
    .replace(/\bCommand\b/g, '⌘')
    .replace(/\bControl\b/g, '⌃')
    .replace(/\bAlt\b/g, '⌥')
    .replace(/\bShift\b/g, '⇧')
    .replace(/\+/g, ' ');
}

function codeToShortcutKey(event: KeyboardEvent): string | null {
  if (event.code === 'Space') return 'Space';
  if (event.code === 'Enter') return 'Enter';
  if (event.code === 'Tab') return 'Tab';
  if (/^Key[A-Z]$/.test(event.code)) return event.code.replace('Key', '');
  if (/^Digit[0-9]$/.test(event.code)) return event.code.replace('Digit', '');
  return null;
}

function eventToShortcut(event: KeyboardEvent): string | null {
  const key = codeToShortcutKey(event);
  if (!key) return null;

  const parts: string[] = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (parts.length === 0) return null;

  parts.push(key);
  return parts.join('+');
}

function VoiceToggle({
  checked,
  disabled,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        'relative inline-flex h-5 w-[38px] flex-shrink-0 items-center rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)] transition-colors duration-200 disabled:opacity-45',
        checked ? 'bg-black' : 'bg-[#d9d9d7]',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
export function VoiceSettings() {
  const { isDesktop } = useDesktopCapabilities();
  const [settings, setSettings] = useState<VoiceHotkeySettingsValue>({
    enabled: true,
    shortcut: DEFAULT_SHORTCUT,
    registered: false,
    registrationError: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isDesktop) {
      setIsLoading(false);
      return;
    }
    try {
      const next = await getVoiceHotkeySettings();
      setSettings(next);
    } catch (error) {
      console.error('Failed to load voice hotkey settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSettings = useCallback(
    async (next: VoiceHotkeySettingsValue) => {
      if (!isDesktop) return;
      setIsSaving(true);
      setCaptureError(null);
      try {
        const saved = await setVoiceHotkeySettings(next);
        setSettings(saved);
      } catch (error: any) {
        setCaptureError(error?.message || 'Failed to save voice shortcut.');
      } finally {
        setIsSaving(false);
      }
    },
    [isDesktop],
  );

  useEffect(() => {
    if (!isCapturing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === 'Escape') {
        setIsCapturing(false);
        setCaptureError(null);
        return;
      }

      const shortcut = eventToShortcut(event);
      if (!shortcut) {
        setCaptureError('Use a modifier plus a letter, number, Space, Enter, or Tab.');
        return;
      }

      setIsCapturing(false);
      void saveSettings({
        ...settings,
        enabled: true,
        shortcut,
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isCapturing, saveSettings, settings]);

  const disabled = !isDesktop || isLoading || isSaving;
  const statusText = !isDesktop
    ? 'Desktop only'
    : settings.registrationError
      ? 'Conflict'
      : settings.enabled && settings.registered
        ? 'Registered'
        : settings.enabled
          ? 'Not registered'
          : 'Off';

  return (
    <div className="space-y-[34px]">
      <section>
        <h2 className="mb-3 ml-[9px] text-[15px] font-semibold leading-5 text-[#1d1d1f]">Shortcut</h2>
        <div className="overflow-hidden rounded-[16px] border border-black/[0.06] bg-[#f7f7f5] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
          <div className="flex min-h-[64px] items-center justify-between gap-5 border-b border-black/[0.06] px-[18px] py-3">
            <div className="min-w-0">
              <p className="text-[15px] font-medium leading-5 text-[#1d1d1f]">Global voice shortcut</p>
              <p className="mt-[3px] max-w-[350px] text-[13px] leading-[17px] text-[#777]">{statusText}</p>
            </div>
            <VoiceToggle
              checked={settings.enabled}
              disabled={!isDesktop || isLoading || isSaving}
              onClick={() => void saveSettings({ ...settings, enabled: !settings.enabled })}
            />
          </div>

          <div className="flex min-h-[64px] items-center justify-between gap-5 px-[18px] py-3">
            <div className="min-w-0">
              <p className="text-[15px] font-medium leading-5 text-[#1d1d1f]">Shortcut keys</p>
              <p className="mt-[3px] max-w-[350px] text-[13px] leading-[17px] text-[#777]">
                {settings.registrationError || captureError || 'Default is Option Space.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setCaptureError(null);
                  setIsCapturing(true);
                }}
                className={cn(
                  'settings-value-button min-w-[112px] justify-center tabular-nums',
                  isCapturing && 'bg-[#e7eeee] text-[#1f4f59]',
                )}
              >
                {isCapturing ? 'Press keys' : displayShortcut(settings.shortcut)}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void saveSettings({ ...settings, enabled: true, shortcut: DEFAULT_SHORTCUT })}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#696969] transition-colors hover:bg-black/[0.045] hover:text-[#252525] disabled:opacity-45"
                aria-label="Reset voice shortcut"
                title="Reset voice shortcut"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
