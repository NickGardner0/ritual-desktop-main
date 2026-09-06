/**
 * Calendar Loading State
 * Shown during route transitions to the calendar page
 */

export default function CalendarLoading() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="h-[52px] border-b border-border" />
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="flex-1 animate-pulse rounded-lg border border-border bg-[linear-gradient(var(--border-subtle)_1px,transparent_1px)] bg-[length:100%_64px]" />
        <div className="hidden w-80 rounded-lg border border-border bg-muted xl:block" />
      </div>
    </div>
  );
}
