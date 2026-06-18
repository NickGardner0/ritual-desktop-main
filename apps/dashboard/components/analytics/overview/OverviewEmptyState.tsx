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
    <div className="flex h-full min-h-0 items-start justify-center overflow-hidden px-6 pt-[clamp(64px,10vh,104px)]">
      <div className="flex w-full max-w-[520px] flex-col gap-6">
        <div className="mb-4 flex w-full items-center justify-center gap-3">
          <img
            src="/images/eclipse.svg"
            alt=""
            aria-hidden="true"
            className="h-9 w-9 shrink-0"
          />
          <div className="min-w-0">
            <div className="text-[20px] font-medium leading-none tracking-normal text-black">
              Welcome to Ritual
            </div>
            <div className="mt-1 text-[13px] font-medium leading-none tracking-normal text-[#6f7278]">
              Your way to track anything
            </div>
          </div>
        </div>

        <div className="w-full">
          <StartSectionHeader title="Get Started" />
          <div className="space-y-0">
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
