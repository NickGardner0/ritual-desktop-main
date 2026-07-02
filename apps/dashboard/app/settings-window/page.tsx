import { SettingsWindowContent } from '@/components/settings-window-content';
import { FontProvider } from '@/contexts/FontContext';
import { SidebarModeProvider } from '@/contexts/SidebarModeContext';
import type { DesktopSettingsView } from '@/lib/tauri-utils';

type SettingsWindowPageProps = {
  searchParams: Promise<{
    view?: string;
  }>;
};

function normalizeView(value: string | undefined): DesktopSettingsView {
  return value === 'privacy' || value === 'computer-tracking' || value === 'place-tagging' || value === 'apple-health'
    ? value
    : 'account';
}

export default async function SettingsWindowPage({ searchParams }: SettingsWindowPageProps) {
  const params = await searchParams;
  return (
    <FontProvider>
      <SidebarModeProvider>
        <SettingsWindowContent initialView={normalizeView(params.view)} />
      </SidebarModeProvider>
    </FontProvider>
  );
}
