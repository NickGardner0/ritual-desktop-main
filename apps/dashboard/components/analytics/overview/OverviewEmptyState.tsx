'use client';

import { ListCollapse, Plug2, Plus, Settings, Upload } from 'lucide-react';
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
    <div className="absolute inset-x-0 top-[40%] flex -translate-y-1/2 justify-center px-6">
      <div className="flex w-full max-w-[468px] flex-col gap-7">
        <div className="flex w-full justify-center">
          <h1 className="ritual-text-shimmer text-[22px] font-medium leading-[1.15] text-transparent">
            Start with Ritual
          </h1>
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
