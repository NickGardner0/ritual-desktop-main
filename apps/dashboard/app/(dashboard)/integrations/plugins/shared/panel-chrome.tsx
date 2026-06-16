'use client';

import Image from 'next/image';
import { Monitor } from 'lucide-react';

export function renderIntegrationLogo(integration: string, size: 'card' | 'panel' = 'card') {
  const imageClass = size === 'panel' ? 'h-8 w-auto object-contain' : 'h-6 w-auto object-contain';

  switch (integration) {
    case 'plaid':
      return (
        <Image
          src="/images/plaid-mark.svg"
          alt="Plaid"
          width={48}
          height={52}
          className={size === 'panel' ? 'h-8 w-auto object-contain' : 'h-7 w-auto object-contain'}
        />
      );
    case 'whoop':
      return (
        <Image src="/images/whoop.svg" alt="Whoop" width={80} height={32} className={imageClass} />
      );
    case 'oura':
      return (
        <Image
          src="/images/oura.svg"
          alt="Oura"
          width={40}
          height={40}
          className={size === 'panel' ? 'h-14 w-auto object-contain -m-2' : 'h-16 w-auto object-contain -m-3'}
        />
      );
    case 'garmin':
      return <Image src="/images/garmin.svg" alt="Garmin" width={60} height={24} className={imageClass} />;
    case 'applewatch':
      return (
        <svg className={size === 'panel' ? 'h-8 w-8' : 'h-6 w-6'} viewBox="0 0 814 1000" fill="currentColor">
          <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
        </svg>
      );
    case 'computer':
      return <Monitor className={size === 'panel' ? 'h-8 w-8 text-gray-900' : 'h-7 w-7 text-gray-900'} />;
    case 'screentime':
      return (
        <Image
          src="/images/Screen_Time.svg"
          alt="Apple Screen Time"
          width={28}
          height={28}
          className={size === 'panel' ? 'h-8 w-8' : 'h-7 w-7'}
        />
      );
    case 'fitbit':
      return <Image src="/images/fitbit.svg" alt="Fitbit" width={60} height={24} className={imageClass} />;
    case 'imessage':
      return (
        <Image
          src="/images/imessage.svg"
          alt="iMessage"
          width={36}
          height={36}
          className={size === 'panel' ? 'h-8 w-8 rounded-[8px]' : 'h-8 w-8 rounded-[8px]'}
        />
      );
    case 'raycast':
      return (
        <Image
          src="/images/raycast.png"
          alt="Raycast"
          width={36}
          height={36}
          className={size === 'panel' ? 'h-9 w-9 rounded-lg object-contain' : 'h-9 w-9 rounded-lg object-contain'}
        />
      );
    case 'obsidian':
      return <Image src="/images/obsidian.svg" alt="Obsidian" width={24} height={24} className={size === 'panel' ? 'h-8 w-8' : 'h-7 w-7'} />;
    case 'calai':
      return (
        <Image
          src="/images/cal_ai.svg"
          alt="Cal AI"
          width={80}
          height={32}
          className={size === 'panel' ? 'h-9 w-auto object-contain' : 'h-8 w-auto object-contain'}
        />
      );
    case 'googlecalendar':
      return (
        <Image
          src="/images/Google_Calendar_Logo.svg"
          alt="Google Calendar"
          width={24}
          height={24}
          className={size === 'panel' ? 'h-8 w-8' : 'h-6 w-6'}
        />
      );
    case 'tesla':
      return (
        <Image
          src="/images/Tesla_T_symbol.svg"
          alt="Tesla"
          width={24}
          height={24}
          className={size === 'panel' ? 'h-8 w-8' : 'h-6 w-6'}
        />
      );
    default:
      return null;
  }
}

export function IntegrationPanelHeader({
  integration,
  title,
  subtitle,
  action,
}: {
  integration: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border-b border-[#e7e5dd] px-5 py-5">
      <div className="rounded-sm border border-[#e7e5dd] bg-[#f8f7f3] p-4">
        <div className="flex aspect-[16/8.6] items-center justify-center rounded-sm border border-[#23211d] bg-[linear-gradient(0deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px] bg-[#111111]">
          <div className="scale-[1.35] text-white">{renderIntegrationLogo(integration, 'panel')}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-b border-[#e7e5dd] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-[#e7e5dd] bg-white text-[#1f1e1a]">
            {renderIntegrationLogo(integration, 'panel')}
          </div>
          <div>
            <h3 className="text-[28px] leading-none tracking-[-0.03em] text-[#1f1e1a]">{title}</h3>
            <p className="mt-1 text-xs text-[#8a877d]">{subtitle}</p>
          </div>
        </div>
        <div>{action}</div>
      </div>
    </div>
  );
}
