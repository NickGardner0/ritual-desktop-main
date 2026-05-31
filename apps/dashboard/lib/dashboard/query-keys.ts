export const dashboardQueryKeys = {
  habits: {
    all: ['habits'] as const,
    lists: () => [...dashboardQueryKeys.habits.all, 'list'] as const,
    list: (userId: string) => [...dashboardQueryKeys.habits.lists(), userId] as const,
    details: () => [...dashboardQueryKeys.habits.all, 'detail'] as const,
    detail: (id: string) => [...dashboardQueryKeys.habits.details(), id] as const,
  },
  habitLogs: {
    all: ['habit-logs'] as const,
    lists: () => [...dashboardQueryKeys.habitLogs.all, 'list'] as const,
    list: (userId: string) => [...dashboardQueryKeys.habitLogs.lists(), userId] as const,
  },
  overviewSnapshot: {
    all: ['dashboard-snapshot', 'v2'] as const,
    byUser: (userId: string) => [...dashboardQueryKeys.overviewSnapshot.all, userId] as const,
    detail: (userId: string, rangeKey: string) => [
      ...dashboardQueryKeys.overviewSnapshot.byUser(userId),
      rangeKey,
    ] as const,
  },
  metricsSnapshot: {
    all: ['metrics-snapshot', 'v1'] as const,
    byUser: (userId: string) => [...dashboardQueryKeys.metricsSnapshot.all, userId] as const,
    detail: (userId: string, rangeKey: string) => [
      ...dashboardQueryKeys.metricsSnapshot.byUser(userId),
      rangeKey,
    ] as const,
  },
  logsReadModel: {
    all: ['logs-read-model', 'v1'] as const,
    byUser: (userId: string) => [...dashboardQueryKeys.logsReadModel.all, userId] as const,
    detail: (userId: string, rangeKey: string, limit = 200, offset = 0, habitId?: string | null) => [
      ...dashboardQueryKeys.logsReadModel.byUser(userId),
      rangeKey,
      limit,
      offset,
      habitId ?? 'all',
    ] as const,
  },
  calendarReadModel: {
    all: ['calendar-read-model', 'v1'] as const,
    byUser: (userId: string) => [...dashboardQueryKeys.calendarReadModel.all, userId] as const,
    detail: (userId: string, rangeKey: string) => [
      ...dashboardQueryKeys.calendarReadModel.byUser(userId),
      rangeKey,
    ] as const,
  },
  analyticsSummary: (userId: string) => ['analytics-summary', userId] as const,
  computerSnapshotsByUser: (userId: string) => ['computer-snapshot', userId] as const,
  computerActivityAll: () => ['computer-activity'] as const,
  usageBreakdownAll: () => ['usage-breakdown'] as const,
  overviewActivityByUser: (userId: string) => ['overview-activity', userId] as const,
} as const;

export const habitKeys = dashboardQueryKeys.habits;
export const habitLogKeys = dashboardQueryKeys.habitLogs;
