import { SettingsWindowContent } from '@/components/settings-window-content';
import { FontProvider } from '@/contexts/FontContext';
import { SidebarModeProvider } from '@/contexts/SidebarModeContext';
import type { DesktopSettingsView } from '@/lib/native-gateway';

export function DesktopSettingsWindow({ initialView }: { initialView: DesktopSettingsView }) {
  return (
    <FontProvider>
      <SidebarModeProvider>
        <SettingsWindowContent initialView={initialView} />
      </SidebarModeProvider>
    </FontProvider>
  );
}
