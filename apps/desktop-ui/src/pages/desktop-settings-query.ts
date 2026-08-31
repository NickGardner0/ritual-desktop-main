import type { DesktopSettingsView } from '@/lib/native-gateway';

export function readDesktopSettingsWindowView(): DesktopSettingsView | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('ritual_settings_window') !== '1') return null;
  const view = params.get('view');
  return view === 'sounds'
    || view === 'privacy'
    || view === 'voice'
    || view === 'computer-tracking'
    || view === 'place-tagging'
    || view === 'apple-health'
    ? view
    : 'account';
}
