'use client';

import { memo, isValidElement, type ReactElement, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { cn } from '@ritual/ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

export type IntegrationCardProps = {
  logo: ReactNode;
  title: string;
  description: string;
  /** Kept for callers; marketplace rows always clamp to one supporting line. */
  descriptionLineClamp?: 2 | 3 | 4;
  comingSoon?: boolean;
  isStatusLoading?: boolean;
  isConnected?: boolean;
  isConnecting?: boolean;
  isSyncing?: boolean;
  connectVariant?: 'primary' | 'outline';
  connectLabel?: string;
  syncLabel?: string;
  details?: ReactNode;
  onConnect?: () => void;
  onSync?: () => void;
  onDisconnect?: () => void;
  onDetails?: () => void;
  extraActions?: ReactNode;
};

const connectActionClassName = 'h-7 !rounded-full px-3 font-medium';

const iconWellClassName =
  'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[var(--surface-panel)] [&>*]:max-h-6 [&>*]:max-w-6 [&_img]:max-h-6 [&_img]:max-w-6 [&_img]:object-contain';

export const IntegrationCard = memo(function IntegrationCard({
  logo,
  title,
  description,
  comingSoon,
  isStatusLoading,
  isConnected,
  isConnecting,
  isSyncing,
  connectLabel = 'Connect',
  syncLabel = 'Sync Now',
  details,
  onConnect,
  onSync,
  onDisconnect,
  onDetails,
  extraActions,
}: IntegrationCardProps) {
  const supporting = (
    <div className="line-clamp-1 text-[13px] leading-[1.45] text-[var(--text-muted)] [&>*]:line-clamp-1">
      {details ?? description}
    </div>
  );

  const hasConnectedMenu = Boolean(onDetails || onSync || onDisconnect);

  return (
    <div
      className={cn(
        'flex min-h-[64px] items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-[var(--row-hover)]',
        onDetails ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={onDetails}
    >
      <div className={iconWellClassName}>{logo}</div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[14px] font-medium leading-[1.35] text-[var(--text-primary)]">
          {title}
        </h3>
        <div className="mt-0.5 min-w-0">{supporting}</div>
      </div>

      <div
        className="ml-1 flex shrink-0 items-center gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        {isStatusLoading ? (
          <span className="inline-flex h-7 items-center px-2 text-[13px] text-[var(--text-muted)]">
            Checking...
          </span>
        ) : comingSoon ? (
          <span className="inline-flex h-7 items-center px-2 text-[13px] text-[var(--text-muted)]">
            Coming soon
          </span>
        ) : isConnected ? (
          <>
            {extraActions}
            {hasConnectedMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-compact"
                    aria-label={`${title} actions`}
                    className="text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onDetails ? (
                    <DropdownMenuItem onSelect={() => onDetails()}>Details</DropdownMenuItem>
                  ) : null}
                  {onSync ? (
                    <DropdownMenuItem disabled={isSyncing} onSelect={() => onSync()}>
                      {isSyncing ? (
                        <span className="inline-flex items-center gap-2">
                          <BrailleSpinner className="text-sm" />
                          Syncing...
                        </span>
                      ) : (
                        syncLabel
                      )}
                    </DropdownMenuItem>
                  ) : null}
                  {onDisconnect ? (
                    <>
                      {onDetails || onSync ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem
                        className="text-[var(--ritual-status-danger)]"
                        onSelect={() => onDisconnect()}
                      >
                        Disconnect
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : (
          <Button
            type="button"
            variant="brand"
            size="compact"
            onClick={onConnect}
            disabled={isConnecting}
            className={connectActionClassName}
          >
            {isConnecting ? (
              <span className="inline-flex items-center gap-1.5">
                <BrailleSpinner className="text-sm" />
                Connecting...
              </span>
            ) : (
              connectLabel
            )}
          </Button>
        )}
      </div>
    </div>
  );
});

export function getIntegrationCardProps(node: ReactNode): IntegrationCardProps | null {
  if (!isValidElement(node)) {
    return null;
  }

  const type = node.type as { displayName?: string };
  if (node.type !== IntegrationCard && type.displayName !== 'IntegrationCard') {
    return null;
  }

  return (node as ReactElement<IntegrationCardProps>).props;
}
