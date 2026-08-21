'use client';

import { SettingsFrame } from '@/components/settings-frame';
import { type DesktopSettingsView } from '@/lib/native-gateway';

type SettingsWindowContentProps = {
  initialView?: DesktopSettingsView;
};

export function SettingsWindowContent({ initialView = 'account' }: SettingsWindowContentProps) {
  return (
    <SettingsFrame
      initialView={initialView}
      listenForDesktopShow
    />
  );
}
