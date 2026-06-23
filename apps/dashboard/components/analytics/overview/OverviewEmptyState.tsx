'use client';

import { Blocks, ListCollapse, Palette, Plug2, Plus, Settings, Upload } from 'lucide-react';
import { StartCommand, StartSectionHeader } from './OverviewStartCommands';

interface OverviewEmptyStateProps {
  onOpenSelectionModal: () => void;
  onOpenImportModal: () => void;
  onOpenIntegrations: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
}

export function OverviewEmptyState({
  onOpenSelectionModal,
  onOpenImportModal,
  onOpenIntegrations,
  onOpenSettings,
  onOpenCommandPalette,
}: OverviewEmptyStateProps) {
  return (
    <div className="flex h-full min-h-0 items-start justify-center overflow-y-auto px-6 pb-[clamp(180px,22vh,260px)] pt-[clamp(72px,8vh,104px)]">
      <div className="flex w-full max-w-[512px] flex-col gap-6">
        <div className="mb-6 flex w-full flex-col items-center text-center">
          <img
            src="/images/eclipse.svg"
            alt=""
            aria-hidden="true"
            className="h-7 w-7 shrink-0"
          />
          <div className="mt-2 text-[21px] font-normal leading-[26px] tracking-normal text-[#2c2f33]">
            Welcome to Ritual
          </div>
          <div className="mt-0.5 text-[13px] leading-[18px] tracking-normal text-[#777b80]">
            Your way to track anything
          </div>
        </div>

        <div className="w-full">
          <StartSectionHeader title="Get Started" />
          <div className="space-y-1">
            <StartCommand icon={Plus} label="New Tracker" onClick={onOpenSelectionModal} />
            <StartCommand icon={Upload} label="Import Data" onClick={onOpenImportModal} />
            <StartCommand icon={Plug2} label="Connect Devices" onClick={onOpenIntegrations} />
            <StartCommand
              icon={ListCollapse}
              label="Open Command Palette"
              shortcut="⌘K"
              onClick={onOpenCommandPalette}
            />
          </div>
        </div>

        <div className="w-full">
          <StartSectionHeader title="Configure" />
          <div className="space-y-1">
            <StartCommand icon={Settings} label="Open Settings" shortcut="⌘," onClick={onOpenSettings} />
            <StartCommand icon={Palette} label="Customize Appearance" onClick={onOpenSettings} />
            <StartCommand icon={Blocks} label="Explore Integrations" onClick={onOpenIntegrations} />
          </div>
        </div>
      </div>
    </div>
  );
}
