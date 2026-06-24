export const connectRowActionClass =
  'inline-flex shrink-0 items-center justify-center rounded-sm px-1 text-[13px] font-medium text-[#8b8a86] transition-none group-hover:text-[#343330] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(39,37,30,0.16)] focus-visible:ring-offset-1';

export const connectRowActionConnectedClass =
  'inline-flex shrink-0 items-center justify-center rounded-sm px-1 text-[13px] font-medium text-[#4b8d15] transition-none group-hover:text-[#3d7411] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(39,37,30,0.16)] focus-visible:ring-offset-1';

export const categoryRowClass =
  'ritual-snappy-row ritual-snappy-row-muted-menu group flex h-9 items-center justify-between gap-3 -mx-2 rounded-md px-2.5 text-[#2c2b28] [&_p]:text-[13.5px] [&_p]:font-medium [&_p]:tracking-normal [&_p]:text-[#2c2b28] [&_svg]:text-[#222326]';

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
