'use client';

import type { CSSProperties } from 'react';
import { AlertCircle, ChevronUp, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openInBrowser } from '@/lib/tauri-utils';
import {
  dismissDesktopUpdate,
  remindAboutCurrentDesktopUpdate,
  requestDesktopUpdateCheck,
  requestDesktopUpdateInstall,
  skipCurrentDesktopUpdate,
  useDesktopUpdaterSnapshot,
} from '@/components/desktop-updater';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import styles from './desktop-update-control.module.css';

const LOADING_GRID_CELLS = Array.from({ length: 15 }, (_, index) => index);

function UpdateLoadingIndicator({ label }: { label: string }) {
  return (
    <span aria-label={label} className={styles.grid} role="status">
      {LOADING_GRID_CELLS.map((index) => (
        <span
          aria-hidden="true"
          className={styles.cell}
          key={index}
          style={{ '--desktop-update-loading-delay': `${index * 42}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}
function releasePageForVersion(version: string) {
  const tag = version.startsWith('v') ? version : `v${version}`;
  return `https://github.com/NickGardner0/ritual-desktop-releases/releases/tag/${encodeURIComponent(tag)}`;
}

export function DesktopUpdateControl({ isExpanded }: { isExpanded: boolean }) {
  const update = useDesktopUpdaterSnapshot();
  const busy = ['checking', 'downloading', 'installing', 'relaunching'].includes(update.phase);
  const visible = update.enabled && Boolean(update.manifest || update.error || busy);

  if (!visible) return null;

  const label =
    update.phase === 'downloading'
      ? `Updating ${update.percentage}%`
      : update.phase === 'installing'
        ? 'Installing'
        : update.phase === 'relaunching'
          ? 'Relaunching'
          : update.phase === 'checking'
            ? 'Checking'
            : update.phase === 'error'
              ? update.error?.startsWith('Desktop update required')
                ? 'Desktop update required'
                : 'Update failed'
              : 'Update available';
  const tooltip =
    update.phase === 'error'
      ? update.error || 'Update failed'
      : update.phase === 'downloading'
        ? `Updating Ritual ${update.percentage}%`
        : update.phase === 'installing'
          ? 'Installing update…'
          : update.phase === 'relaunching'
            ? 'Relaunching Ritual…'
            : update.manifest?.version
              ? `Update available: ${update.manifest.version}`
              : label;
  const handlePrimaryAction = () => {
    if (busy) return;
    if (update.manifest) {
      void requestDesktopUpdateInstall();
    } else {
      void requestDesktopUpdateCheck();
    }
  };

  return (
    <div className={cn('mt-1 flex h-[30px] items-center gap-0.5', isExpanded ? 'w-full' : 'w-[40px]')}>
      <button
        aria-label={tooltip}
        className={cn(
          'relative flex h-[30px] min-w-0 items-center rounded-[var(--radius-row)] text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]',
          'text-[var(--ritual-status-info)] hover:bg-[var(--row-hover)]',
          busy && 'cursor-wait bg-[color-mix(in_srgb,var(--ritual-focus-ring)_10%,transparent)]',
          update.phase === 'error' && 'text-[var(--ritual-status-danger)]',
          isExpanded ? 'flex-1' : 'w-[40px]',
        )}
        disabled={busy}
        onClick={handlePrimaryAction}
        title={tooltip}
        type="button"
      >
        <span className="flex h-[30px] w-[40px] shrink-0 items-center justify-center">
          {busy ? (
            <UpdateLoadingIndicator label={label} />
          ) : update.phase === 'error' ? (
            <AlertCircle aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2} />
          ) : (
            <Download aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </span>
        {isExpanded ? <span className="min-w-0 truncate pr-1 tabular-nums">{label}</span> : null}
      </button>

      {isExpanded && update.manifest ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Update options"
              className="flex h-[26px] w-[24px] shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--ritual-status-info)] transition-colors hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] disabled:cursor-wait disabled:opacity-50"
              disabled={busy}
              title="Update options"
              type="button"
            >
              <ChevronUp aria-hidden="true" className="h-[14px] w-[14px]" strokeWidth={2.2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[190px] rounded-[8px] border-[var(--border-subtle)] bg-[var(--surface-window)] text-[var(--text-primary)]"
            side="top"
            sideOffset={6}
          >
            <DropdownMenuItem
              onSelect={() => {
                if (update.manifest?.version) {
                  void openInBrowser(releasePageForVersion(update.manifest.version));
                }
              }}
            >
              View Release Notes
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={dismissDesktopUpdate}>Download Later</DropdownMenuItem>
            <DropdownMenuItem onSelect={remindAboutCurrentDesktopUpdate}>
              Remind Me Tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={skipCurrentDesktopUpdate}>
              Skip {update.manifest.version}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
