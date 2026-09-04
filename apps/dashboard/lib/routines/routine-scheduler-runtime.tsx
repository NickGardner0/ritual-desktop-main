'use client';

import { useRoutineScheduler } from '@/lib/routines/use-routine-scheduler';

export default function RoutineSchedulerRuntime() {
  useRoutineScheduler();
  return null;
}
