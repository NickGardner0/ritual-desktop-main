export const connectRowActionClass =
  'shrink-0 text-[12.5px] font-normal tabular-nums text-[rgba(39,37,30,0.4)] transition-colors group-hover:text-[rgba(39,37,30,0.55)] group-data-[active=true]:text-[rgba(39,37,30,0.55)]';

export const connectRowActionConnectedClass =
  'shrink-0 text-[12.5px] font-normal text-[#4b8d15] transition-colors';

/** Codex-like palette row: soft rounded hover/active, whole-row target */
export const categoryRowClass =
  'ritual-snappy-row group flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 text-left text-[#27251E] outline-none transition-colors hover:bg-[#F3F3F3] focus-visible:bg-[#F3F3F3] data-[active=true]:bg-[#F3F3F3] disabled:cursor-wait disabled:opacity-50 [&_svg]:text-[#27251E]';

export const sectionLabelClass =
  'px-2.5 pb-1 pt-3 text-[11px] font-medium tracking-[0.01em] text-[rgba(39,37,30,0.4)] first:pt-1';

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
