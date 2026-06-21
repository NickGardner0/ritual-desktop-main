export const connectRowActionClass =
  'inline-flex shrink-0 items-center justify-center rounded-sm px-1 text-xs font-medium text-[#878787] transition-colors group-hover:text-[#1f1e1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(39,37,30,0.18)] focus-visible:ring-offset-1';

export const connectRowActionConnectedClass =
  'inline-flex shrink-0 items-center justify-center rounded-sm px-1 text-xs font-medium text-[#5f9f18] transition-colors group-hover:text-[#497b13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(39,37,30,0.18)] focus-visible:ring-offset-1';

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
