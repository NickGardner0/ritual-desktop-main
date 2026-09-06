'use client';

import type { CSSProperties } from 'react';
import { AlertCircle, ChevronUp, Download } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { cn } from '@/lib/utils';
import { openInBrowser } from '@/lib/native-gateway';
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
} from '@ritual/ui/dropdown-menu';
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
                ? 'Required'
                : 'Failed'
              : 'Update';
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
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5',
        isExpanded ? 'h-[var(--sidebar-row-height)]' : 'mt-1 h-[30px] w-[40px] justify-center',
      )}
    >
      <Button
        aria-label={tooltip}
        className={cn(
          'h-6 min-w-0 border-0 px-2.5 text-[12px] font-medium text-white shadow-none hover:text-white',
          '!rounded-full',
          update.phase === 'error'
            ? 'bg-[var(--ritual-status-danger)] hover:bg-[color-mix(in_srgb,var(--ritual-status-danger)_88%,black)]'
            : 'bg-[#2f6e45] hover:bg-[#275c3a]',
          busy && 'cursor-wait',
          !isExpanded && 'h-6 w-6 px-0',
        )}
        data-desktop-update-pill=""
        disabled={busy}
        onClick={handlePrimaryAction}
        size="compact"
        title={tooltip}
        type="button"
      >
        {busy ? (
          <UpdateLoadingIndicator label={label} />
        ) : !isExpanded ? (
          update.phase === 'error' ? (
            <AlertCircle aria-hidden="true" className="!h-3.5 !w-3.5" strokeWidth={2.2} />
          ) : (
            <Download aria-hidden="true" className="!h-3.5 !w-3.5" strokeWidth={2.2} />
          )
        ) : null}
        {isExpanded ? <span className="tabular-nums">{label}</span> : null}
      </Button>

      {isExpanded && update.manifest ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Update options"
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] disabled:cursor-wait disabled:opacity-50"
              disabled={busy}
              title="Update options"
              type="button"
            >
              <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
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
