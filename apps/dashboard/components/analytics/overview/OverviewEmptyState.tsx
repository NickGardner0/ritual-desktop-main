'use client';

import { Blocks, ListCollapse, Palette, Plus, Settings, Upload } from 'lucide-react';
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
    <div className="flex h-full min-h-0 items-start justify-center overflow-hidden px-6 pt-[clamp(18px,2.8vh,30px)]">
      <div className="flex w-full max-w-[316px] flex-col gap-2">
        <div className="mb-1 flex w-full flex-col items-center justify-center text-center">
          <img
            src="/images/eclipse.svg"
            alt=""
            aria-hidden="true"
            className="mb-1 h-[15px] w-[15px] shrink-0"
          />
          <div className="text-[18px] font-medium leading-none tracking-normal text-black">
            Welcome to Ritual
          </div>
          <div className="mt-0.5 text-[11px] font-normal leading-none tracking-normal text-[#6f7278]">
            Your way to track anything
          </div>
        </div>

        <div className="w-full">
          <StartSectionHeader title="Get Started" />
          <div className="space-y-0">
            <StartCommand icon={Plus} label="New Tracker" onClick={onOpenSelectionModal} />
            <StartCommand icon={Upload} label="Import Data" onClick={onOpenImportModal} />
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
          <div className="space-y-0">
            <StartCommand icon={Settings} label="Open Settings" shortcut="⌘," onClick={onOpenSettings} />
            <StartCommand icon={Palette} label="Customize Appearance" onClick={onOpenSettings} />
            <StartCommand icon={Blocks} label="Explore Integrations" onClick={onOpenIntegrations} />
          </div>
        </div>
      </div>
    </div>
  );
}
