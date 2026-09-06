/**
 * @ritual/shared-contracts
 * 
 * Shared types and contracts used across:
 * - Desktop app (Tauri + Next.js)
 * - iOS companion app (SwiftUI)
 * - Backend (FastAPI)
 */

// Normalized metric types
export type {
  WearableSource,
  MetricType,
  Unit,
  NormalizedMetric,
  WearableDevice,
} from "./normalized";

// Apple Health ingest contract
export type {
  AppleIngestRequest,
  AppleIngestResult,
  AppleIngestResponse,
  AppleIngestRequestV2,
  AppleIngestResponseV2,
  DeleteResult,
  DeviceRegisterRequest,
  DeviceRegisterResponse,
} from "./apple_ingest";

export { buildCanonicalString } from "./apple_ingest";

// Computer activity analytics contracts
export type {
  ActivityEvent,
  AttentionHeader,
  RankedBar,
  ActivityBreakdownSource,
  ActivityBreakdownCapabilities,
  ComputerActivityViewModel,
  ActivityBreakdownViewModel,
  TimeRangePreset,
  TimeRange,
  UsageBreakdownKind,
  BreakdownPoint,
  BreakdownResponse,
  ComputerActivityRangeParams,
  ComputerSummaryResponse,
  ComputerDailyResponseRow,
  TopAppResponseRow,
  TopDomainResponseRow,
  AggregatedComputerStatsResponse,
  ComputerActivityReadSource,
} from "./computer-activity";

export type {
  WearableProvider,
  WearableAuthMethod,
  WearableConnectionStatus,
  WearableCapability,
  WearableConnection,
  WearableSample,
  WearableEvent,
  WearableSyncRun,
  WearableConnectionsResponse,
  WearableConnectionActionResponse,
  WearableSyncResponse,
} from "./wearables-unified";

export type { CreateHabitInput, HabitRecord } from "./habits";

export {
  AUTHORED_RELATIONSHIPS,
  ENTITY_MENTION_TOKEN_PATTERN,
  ENTITY_TYPES,
  ENTITY_TYPE_ALIASES,
  LAYER_0_ENTITY_TYPES,
  canonicalEntityType,
  entityRefKey,
  entityRoute,
  entityTypeToPrivacyClass,
  formatEntityMentionToken,
  insertEntityMentionToken,
  isDayId,
  isEntityType,
  isTimeWindowId,
  parseDateMentionQuery,
  parseEntityMentionTokens,
  splitEntityMentionText,
  stripEntityMentionTokens,
  unavailableEntitySummary,
  virtualDateSummary,
} from "./entities";
export type {
  AuthoredRelationship,
  EntityAvailability,
  EntityRef,
  EntitySummary,
  EntityType,
  Layer0EntityType,
  EntityMentionSegment,
  ParsedDateMention,
  RelatedEntity,
  RelatedEntitySource,
} from "./entities";

export {
  CLOUD_CONSENTS,
  CLOUD_DESTINATIONS,
  DATA_CLASSES,
  PRIVACY_MODES,
  canSendToCloud,
  isSensitiveDataClass,
  redactAnalyticsProperties,
  shouldRedactAnalyticsProperty,
} from "./privacy";

export type {
  CalendarEvent,
  CalendarEventKind,
  CalendarEventOrigin,
  CalendarEventStatus,
  CalendarMode,
  CalendarMutationProposal,
  CalendarOccurrence,
  CalendarPreferences,
  CalendarRangeReadModel,
  CalendarReviewData,
  CalendarSource,
  CalendarSyncState,
  CalendarTaskSummary,
  CalendarView,
  RecurrenceScope,
  WorkflowTimelineItem,
} from "./calendar";
export type {
  CloudConsent,
  CloudDestination,
  PrivacyDataClass,
  PrivacyDecision,
  PrivacyMode,
  PrivacyPolicyInput,
} from "./privacy";
