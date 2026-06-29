'use client';

import { ListCollapse, Plug2, Plus, Settings, Upload } from 'lucide-react';
import { RitualWordmark } from '@/components/ritual-wordmark';
import { StartCommand } from './OverviewStartCommands';

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
      <div className="flex w-full max-w-[468px] flex-col gap-5">
        <div className="mb-6 flex w-full justify-center">
          <div className="inline-flex items-center gap-[3px] text-[#111827]">
            <img
              src="/images/eclipse.svg"
              alt=""
              aria-hidden="true"
              className="h-[20px] w-[20px] shrink-0 object-contain"
            />
            <RitualWordmark className="h-[15px] w-auto shrink-0" />
          </div>
        </div>

        <div className="w-full space-y-1.5">
          <StartCommand icon={Plus} label="New Tracker" onClick={onOpenSelectionModal} />
          <StartCommand icon={Upload} label="Import Data" onClick={onOpenImportModal} />
          <StartCommand icon={Plug2} label="Connect Devices" onClick={onOpenIntegrations} />
          <StartCommand
            icon={ListCollapse}
            label="Open Command Palette"
            shortcut="⌘K"
            onClick={onOpenCommandPalette}
          />
          <StartCommand icon={Settings} label="Open Settings" shortcut="⌘," onClick={onOpenSettings} />
        </div>
      </div>
    </div>
  );
}
