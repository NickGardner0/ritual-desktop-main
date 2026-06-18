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
    <div className="flex h-full min-h-[520px] items-center justify-center overflow-y-auto px-6 pb-[152px] pt-10">
      <div className="flex size-full max-w-[512px] flex-col justify-center gap-6 p-8">
        <div className="mb-4 flex w-full items-center justify-center gap-4">
          <img
            src="/images/logo_fix1.svg"
            alt=""
            aria-hidden="true"
            className="h-[45px] w-[45px] shrink-0 opacity-70 grayscale"
          />
          <div className="min-w-0">
            <div className="text-[20px] font-medium leading-none tracking-normal text-[#5f636a]">
              Welcome to Ritual
            </div>
            <div className="mt-1 text-[13px] font-medium italic leading-none tracking-normal text-[#9699a0]">
              Track what matters
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
