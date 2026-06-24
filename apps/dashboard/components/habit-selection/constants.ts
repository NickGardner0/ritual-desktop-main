export const connectRowActionClass =
  'inline-flex shrink-0 items-center justify-center rounded-sm px-1 text-xs font-medium text-[#878787] transition-none group-hover:text-[#1f1e1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(39,37,30,0.18)] focus-visible:ring-offset-1';

export const connectRowActionConnectedClass =
  'inline-flex shrink-0 items-center justify-center rounded-sm px-1 text-xs font-medium text-[#5f9f18] transition-none group-hover:text-[#497b13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(39,37,30,0.18)] focus-visible:ring-offset-1';

export const categoryRowClass =
  'ritual-snappy-row group flex h-[var(--sidebar-row-height)] items-center justify-between gap-2 -mx-2 rounded-sm px-[var(--sidebar-row-x)]';

export const categoryMap: Record<string, string> = {
  productivity: 'Productivity',
  fitness: 'Health',
  education: 'Education',
  experiments: 'Experiments',
  custom: 'Custom',
};

export type WatcherStatus = {
  is_running?: boolean;
  device_id?: string | null;
};
