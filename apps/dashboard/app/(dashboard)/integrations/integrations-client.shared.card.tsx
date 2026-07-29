'use client';

import { memo } from 'react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { cn } from '@/lib/utils';

export const IntegrationCard = memo(({
  logo,
  title,
  description,
  comingSoon,
  isStatusLoading,
  isConnected,
  isConnecting,
  isSyncing,
  connectVariant = 'primary',
  connectLabel = 'Connect',
  syncLabel = 'Sync Now',
  details,
  onConnect,
  onSync,
  onDisconnect,
  onDetails,
  extraActions,
  descriptionLineClamp = 2
}: {
  logo: React.ReactNode
  title: string
  description: string
  /** Card copy uses line-clamp; higher values avoid ellipsis on longer Plaid descriptions. */
  descriptionLineClamp?: 2 | 3 | 4
  comingSoon?: boolean
  isStatusLoading?: boolean
  isConnected?: boolean
  isConnecting?: boolean
  isSyncing?: boolean
  connectVariant?: 'primary' | 'outline'
  connectLabel?: string
  syncLabel?: string
  details?: React.ReactNode
  onConnect?: () => void
  onSync?: () => void
  onDisconnect?: () => void
  onDetails?: () => void
  extraActions?: React.ReactNode
}) => (
  <div className="flex h-[188px] flex-col rounded-md border border-gray-300 bg-white px-3 py-2.5">
    <div className="mb-1 flex h-7 items-center [&>*]:max-h-6 [&>*]:w-auto [&_img]:max-h-6 [&_img]:w-auto">
      {logo}
    </div>
    <div className="flex items-center mb-0.5">
      <h3 className="text-[14px] leading-5 font-medium">{title}</h3>
      {comingSoon && (
        <span className="ml-2 text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Coming soon</span>
      )}
    </div>
    <p
      className={cn(
        'text-[12px] leading-[1.35] text-gray-500 mb-2 flex-grow',
        descriptionLineClamp === 4 && 'line-clamp-4',
        descriptionLineClamp === 3 && 'line-clamp-3',
        descriptionLineClamp === 2 && 'line-clamp-2'
      )}
    >
      {description}
    </p>

    {details ? (
      <div className="mb-2.5">
        {details}
      </div>
    ) : null}

    <div className="mt-auto flex items-center gap-1.5">
      {isStatusLoading ? (
        <>
          <button
            type="button"
            disabled
            className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm text-gray-500 bg-[#F8F8F8] cursor-default"
          >
            Checking...
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
            >
              Details
            </button>
          )}
        </>
      ) : isConnected ? (
        <>
          <button
            onClick={onDisconnect}
            className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full bg-[#73bf1d] transition-colors focus:outline-none focus:ring-2 focus:ring-[#73bf1d] focus:ring-offset-2"
            role="switch"
            aria-checked="true"
          >
            <span className="pointer-events-none inline-block h-4 w-4 translate-x-4 transform rounded-full bg-white shadow-sm transition-transform" />
          </button>
          {onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="px-2.5 py-1.5 text-[13px] whitespace-nowrap border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50"
            >
              {isSyncing ? (
                <>
                  <BrailleSpinner className="mr-1.5 inline-block text-sm" />
                  Syncing...
                </>
              ) : (
                syncLabel
              )}
            </button>
          )}
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900"
            >
              Details
            </button>
          )}
          {extraActions}
        </>
      ) : comingSoon ? (
        <>
          <button
            type="button"
            className="px-2.5 py-1.5 text-[13px] bg-black text-white rounded-sm"
          >
            Connect
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
            >
              Details
            </button>
          )}
        </>
      ) : (
        <>
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className={
              connectVariant === 'outline'
                ? "px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8] disabled:opacity-50 text-gray-900"
                : "px-2.5 py-1.5 text-[13px] bg-black text-white rounded-sm disabled:opacity-50"
            }
          >
            {isConnecting ? (
              <>
                <BrailleSpinner className="mr-1.5 inline-block text-sm" />
                Connecting...
              </>
            ) : (
              connectLabel
            )}
          </button>
          {onDetails && (
            <button
              onClick={onDetails}
              className="px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-sm hover:bg-[#EBEAE8]"
            >
              Details
            </button>
          )}
        </>
      )}
    </div>
  </div>
));

IntegrationCard.displayName = 'IntegrationCard';

// ================================
// MAIN CLIENT COMPONENT
