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
    <div className="flex h-full min-h-0 items-center justify-center overflow-hidden px-6 pb-[clamp(110px,14vh,156px)] pt-8">
      <div className="flex w-full max-w-[512px] flex-col gap-6">
        <div className="mb-4 flex w-full items-center justify-center gap-4">
          <img
            src="/images/eclipse.svg"
            alt=""
            aria-hidden="true"
            className="h-[45px] w-[45px] shrink-0"
          />
          <div className="flex flex-col items-start">
            <div className="text-[21px] font-medium leading-[26px] tracking-normal text-[#2c2f33]">
              Welcome to Ritual
            </div>
            <div className="text-[13px] italic leading-[18px] tracking-normal text-[#777b80]">
              Your way to track anything
            </div>
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
