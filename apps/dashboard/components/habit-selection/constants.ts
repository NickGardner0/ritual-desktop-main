export const connectRowActionClass =
  'inline-flex shrink-0 items-center justify-center px-1 text-[12.5px] font-medium text-[#8b8a86] transition-none group-hover:text-[#343330]';

export const connectRowActionConnectedClass =
  'inline-flex shrink-0 items-center justify-center px-1 text-[12.5px] font-medium text-[#4b8d15] transition-none group-hover:text-[#3d7411]';

export const categoryRowClass =
  'ritual-snappy-row group -mx-1 flex h-8 items-center justify-between gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 text-[#2c2b28] outline-none focus-visible:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-inset [&_svg]:text-[#222326]';

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
