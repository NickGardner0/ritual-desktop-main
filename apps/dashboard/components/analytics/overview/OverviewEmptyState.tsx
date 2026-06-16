'use client';

import { ListCollapse, Plug2, Plus, Upload } from 'lucide-react';
import { StartCommand, StartSectionHeader } from './OverviewStartCommands';

interface OverviewEmptyStateProps {
  onOpenSelectionModal: () => void;
  onOpenImportModal: () => void;
  onOpenIntegrations: () => void;
  onOpenCommandPalette: () => void;
}

export function OverviewEmptyState({
  onOpenSelectionModal,
  onOpenImportModal,
  onOpenIntegrations,
  onOpenCommandPalette,
}: OverviewEmptyStateProps) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-6 pt-8">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center justify-center gap-3">
          <img
            src="/images/eclipse.svg"
            alt=""
            aria-hidden="true"
            className="h-11 w-11 opacity-65 grayscale"
          />
          <div className="min-w-0">
            <div className="text-[21px] font-medium leading-none tracking-normal text-[#5f636a]">
              Welcome to Ritual
            </div>
            <div className="mt-1 text-[13px] font-medium italic leading-none tracking-normal text-[#9699a0]">
              Track what matters
            </div>
          </div>
        </div>

        <StartSectionHeader title="Get started" />
        <div className="space-y-0.5">
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
    </div>
  );
}
