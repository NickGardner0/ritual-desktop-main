export const QUERY_POLICY = {
  general: {
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
  },
  staticResource: {
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 30,
  },
  dashboardSnapshot: {
    staleTime: 1000 * 60 * 3,
    gcTime: 1000 * 60 * 15,
  },
  overviewActivity: {
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
  },
  computerSnapshot: {
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  },
  computerEvents: {
    staleTime: 1000 * 15,
    gcTime: 1000 * 60 * 5,
  },
  computerBreakdown: {
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  },
  optimisticEntity: {
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60 * 12,
  },
} as const;
