export const connectRowActionClass =
  'inline-flex h-8 w-[8.5rem] shrink-0 items-center justify-center rounded-sm border border-gray-200 bg-white px-2 text-sm font-normal text-gray-600 transition-colors hover:bg-gray-50';

export const connectRowActionConnectedClass =
  'inline-flex h-8 w-[8.5rem] shrink-0 items-center justify-center rounded-sm bg-[#73bf1d] px-2 text-sm font-normal text-white transition-colors hover:bg-[#5fa018]';

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
