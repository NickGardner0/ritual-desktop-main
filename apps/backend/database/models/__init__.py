"""SQLAlchemy database models — package re-exports for backward compatibility."""
from database.models.base import Base, _utcnow_naive
from database.models.artifacts import (
    ArtifactDB,
    ArtifactRevisionDB,
    ArtifactLinkDB,
)
from database.models.conversations import (
    AIConversationDB,
    AIMessageDB,
    AssistantTurnDB,
    ConversationQueueItemDB,
)
from database.models.experiments import ExperimentDB, ExperimentEntryDB
from database.models.entities import EntityReferenceDB
from database.models.facts import (
    AiFactDB,
    AiFactEventDB,
)
from database.models.financial import (
    FinancialConnectionDB,
    FinancialAccountDB,
    FinancialTransactionDB,
    FinancialSyncCursorDB,
    FinancialSyncRunDB,
)
from database.models.habits import (
    HabitDB,
    HabitLogDB,
    ScheduledBlockDB,
    HabitAliasDB,
    HabitProjectionPolicyDB,
)
from database.models.imports import (
    ImportRunDB,
    ImportItemDB,
    ImportMappingPresetDB,
)
from database.models.integrations import (
    IntegrationDB,
)
from database.models.metrics import (
    MetricFactRebuildRunDB,
    MetricDailyFactDB,
)
from database.models.privacy_sync import (
    PrivateSyncDeviceDB,
    PrivateSyncEnvelopeDB,
    PrivateSyncKeyGrantDB,
)
from database.models.reports import (
    ReportScheduleDB,
    ReportRunDB,
    ReportNotificationDB,
)
from database.models.scheduler import SchedulerOccurrenceClaimDB
from database.models.desktop_auth import DesktopAuthHandoffDB
from database.models.sms import (
    SmsPreferencesDB,
    SmsCopilotEventDB,
    BehaviorBaselineSnapshotDB,
)
from database.models.tasks import (
    RoutineDB,
    RoutineRunDB,
    TaskDB,
    TaskEventDB,
)
from database.models.user import (
    AccountDeletionJobDB,
    UserDB,
    UserActivationStateDB,
    UserActivationChecklistItemDB,
    UserUIPreferencesDB,
    UserLocationPingDB,
    UserLocationStateDB,
)
from database.models.watcher import (
    WatcherDeviceDB,
    WatcherStateDB,
    ActivityEventDB,
    DailyActivityRollupDB,
    AfkEventDB,
    DomainDailyRollupDB,
    WatcherSyncOutboxDB,
    WatcherAppExclusionDB,
)
from database.models.wearables import (
    WhoopIntegrationDB,
    WearableConnectionDB,
    WearableSourceDB,
    WearableRawPayloadDB,
    WearableSampleDB,
    WearableEventDB,
    WearableSyncCursorDB,
    WearableSyncRunDB,
    WearableIngestJobBatchDB,
    WearableIngestJobDB,
    WearableOutboxEventDB,
    WearableDeviceDB,
    WearableMetricDB,
    WearableIngestEventDB,
    ScreenTimeRollupDB,
    HeartRateSessionDB,
    HeartRateSampleDB,
    HeartRateRollup1mDB,
    LiveBiometricsStateDB,
)
from database.models.workflows import (
    ActionProfileDB,
    WorkflowDefinitionDB,
    WorkflowRunDB,
    ApprovalRequestDB,
    ActionReceiptDB,
    AmbientSignalEventDB,
)

__all__ = [
    "Base",
    "_utcnow_naive",
    "AIConversationDB",
    "AIMessageDB",
    "ActionProfileDB",
    "ActionReceiptDB",
    "AccountDeletionJobDB",
    "ActivityEventDB",
    "AfkEventDB",
    "AiFactDB",
    "AiFactEventDB",
    "AmbientSignalEventDB",
    "ApprovalRequestDB",
    "ArtifactDB",
    "ArtifactLinkDB",
    "ArtifactRevisionDB",
    "AssistantTurnDB",
    "BehaviorBaselineSnapshotDB",
    "ConversationQueueItemDB",
    "EntityReferenceDB",
    "ExperimentDB",
    "ExperimentEntryDB",
    "DailyActivityRollupDB",
    "DesktopAuthHandoffDB",
    "DomainDailyRollupDB",
    "FinancialAccountDB",
    "FinancialConnectionDB",
    "FinancialSyncCursorDB",
    "FinancialSyncRunDB",
    "FinancialTransactionDB",
    "HabitAliasDB",
    "HabitDB",
    "HabitLogDB",
    "HabitProjectionPolicyDB",
    "HeartRateRollup1mDB",
    "HeartRateSampleDB",
    "HeartRateSessionDB",
    "ImportItemDB",
    "ImportMappingPresetDB",
    "ImportRunDB",
    "IntegrationDB",
    "LiveBiometricsStateDB",
    "MetricDailyFactDB",
    "MetricFactRebuildRunDB",
    "PrivateSyncDeviceDB",
    "PrivateSyncEnvelopeDB",
    "PrivateSyncKeyGrantDB",
    "ReportNotificationDB",
    "ReportRunDB",
    "ReportScheduleDB",
    "RoutineDB",
    "RoutineRunDB",
    "ScheduledBlockDB",
    "SchedulerOccurrenceClaimDB",
    "ScreenTimeRollupDB",
    "SmsCopilotEventDB",
    "SmsPreferencesDB",
    "TaskDB",
    "TaskEventDB",
    "UserActivationChecklistItemDB",
    "UserActivationStateDB",
    "UserDB",
    "UserLocationPingDB",
    "UserLocationStateDB",
    "UserUIPreferencesDB",
    "WatcherAppExclusionDB",
    "WatcherDeviceDB",
    "WatcherStateDB",
    "WatcherSyncOutboxDB",
    "WearableConnectionDB",
    "WearableDeviceDB",
    "WearableEventDB",
    "WearableIngestEventDB",
    "WearableIngestJobBatchDB",
    "WearableIngestJobDB",
    "WearableMetricDB",
    "WearableOutboxEventDB",
    "WearableRawPayloadDB",
    "WearableSampleDB",
    "WearableSourceDB",
    "WearableSyncCursorDB",
    "WearableSyncRunDB",
    "WhoopIntegrationDB",
    "WorkflowDefinitionDB",
    "WorkflowRunDB",
]
