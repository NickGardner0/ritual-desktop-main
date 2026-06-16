import type { DateRange } from 'react-day-picker';
import type { HabitStats } from '@/lib/services/analytics-api';

export interface OverviewViewProps {
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  hideControls?: boolean;
  initialOverviewStats?: Record<string, HabitStats>;
  isOverviewSnapshotFetching?: boolean;
}
