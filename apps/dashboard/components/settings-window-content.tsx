'use client';

import { SettingsFrame } from '@/components/settings-frame';
import { type DesktopSettingsView } from '@/lib/tauri-utils';

type SettingsWindowContentProps = {
  initialView?: DesktopSettingsView;
};

export function SettingsWindowContent({ initialView = 'general' }: SettingsWindowContentProps) {
  return (
    <SettingsFrame
      initialView={initialView}
      listenForDesktopShow
    />
  );
}
