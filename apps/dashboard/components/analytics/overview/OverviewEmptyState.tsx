'use client';

import { Blocks, ListCollapse, Palette, Plug2, Plus, Settings, Upload } from 'lucide-react';
import { RitualWordmark } from '@/components/ritual-wordmark';
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
    <div className="absolute inset-x-0 top-[clamp(0px,2vh,28px)] flex justify-center px-6">
      <div className="flex w-full max-w-[512px] flex-col gap-5">
        <div className="mb-6 flex w-full justify-center">
          <div className="inline-flex items-center gap-[4px] text-[#111827]">
            <img
              src="/images/eclipse.svg"
              alt=""
              aria-hidden="true"
              className="h-[27px] w-[27px] shrink-0"
            />
            <RitualWordmark className="h-[24px] w-auto shrink-0" />
          </div>
        </div>

        <div className="w-full">
          <StartSectionHeader title="Get Started" />
          <div>
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
          <div>
            <StartCommand icon={Settings} label="Open Settings" shortcut="⌘," onClick={onOpenSettings} />
            <StartCommand icon={Palette} label="Customize Appearance" onClick={onOpenSettings} />
            <StartCommand icon={Blocks} label="Explore Integrations" onClick={onOpenIntegrations} />
          </div>
        </div>
      </div>
    </div>
  );
}
