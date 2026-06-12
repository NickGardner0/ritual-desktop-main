import { SettingsWindowContent } from '@/components/settings-window-content';
import type { DesktopSettingsView } from '@/lib/tauri-utils';

type SettingsWindowPageProps = {
  searchParams: Promise<{
    view?: string;
  }>;
};

function normalizeView(value: string | undefined): DesktopSettingsView {
  return value === 'computer-tracking' || value === 'place-tagging' || value === 'apple-health'
    ? value
    : 'account';
}

export default async function SettingsWindowPage({ searchParams }: SettingsWindowPageProps) {
  const params = await searchParams;
  return <SettingsWindowContent initialView={normalizeView(params.view)} />;
}
