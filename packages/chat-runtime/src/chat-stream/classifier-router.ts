import {
  classifyRetrievalRoute,
  isComprehensiveWeeklyRecapQuery,
  isDailyOverviewQuery,
  isMonthlyOverviewQuery,
  resolveWeeklyOverviewParamsFromQuery,
} from '../query-classifier.js';

export type ForcedOverviewTool =
  | 'getWeeklyOverview'
  | 'getDailyOverview'
  | 'getMonthlyOverview'
  | 'getActivitySummary'
  | 'getComputerTimeSpentBreakdown';

export type ClassifierRouteDecision = {
  retrievalRoute: ReturnType<typeof classifyRetrievalRoute>;
  forcedToolName: ForcedOverviewTool | null;
  weeklyOverviewQueryParams: ReturnType<typeof resolveWeeklyOverviewParamsFromQuery>;
  strictThisWeekForWeeklyOverview: boolean;
  deterministicFastPath: boolean;
  deferredOverviewFastPath: boolean;
};

export function classifyChatRoute(
  latestUserContent: string,
  timezone: string | undefined,
  isVoiceMode: boolean,
): ClassifierRouteDecision {
  const retrievalRoute = classifyRetrievalRoute(latestUserContent);
  const forceScreenTimeBreakdown = retrievalRoute === 'time_breakdown';
  const forceContextRecap = retrievalRoute === 'anchored_day_recap' || retrievalRoute === 'range_recap';
  const forceDailyOverview = retrievalRoute === 'habit_metrics' && isDailyOverviewQuery(latestUserContent);
  const forceMonthlyOverview =
    retrievalRoute === 'habit_metrics' && !forceDailyOverview && isMonthlyOverviewQuery(latestUserContent);
  const forceWeeklyOverview =
    retrievalRoute === 'habit_metrics'
    && !forceDailyOverview
    && !forceMonthlyOverview
    && isComprehensiveWeeklyRecapQuery(latestUserContent);

  const forcedToolName: ForcedOverviewTool | null = forceScreenTimeBreakdown
    ? 'getComputerTimeSpentBreakdown'
    : forceContextRecap
      ? 'getActivitySummary'
      : forceDailyOverview
        ? 'getDailyOverview'
        : forceMonthlyOverview
          ? 'getMonthlyOverview'
          : forceWeeklyOverview
            ? 'getWeeklyOverview'
            : null;

  const weeklyOverviewQueryParams = resolveWeeklyOverviewParamsFromQuery(latestUserContent, timezone);
  const strictThisWeekForWeeklyOverview = weeklyOverviewQueryParams.strictThisWeek === true;

  const deterministicFastPath =
    !isVoiceMode
    && !!forcedToolName
    && ['getWeeklyOverview', 'getDailyOverview', 'getMonthlyOverview', 'getActivitySummary'].includes(forcedToolName);

  const deferredOverviewFastPath =
    !isVoiceMode
    && !!forcedToolName
    && ['getWeeklyOverview', 'getDailyOverview', 'getMonthlyOverview'].includes(forcedToolName);

  return {
    retrievalRoute,
    forcedToolName,
    weeklyOverviewQueryParams,
    strictThisWeekForWeeklyOverview,
    deterministicFastPath,
    deferredOverviewFastPath,
  };
}
