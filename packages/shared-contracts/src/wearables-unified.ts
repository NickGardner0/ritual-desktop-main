export type WearableProvider = "apple_health" | "whoop" | "garmin" | "oura" | "fitbit";

export type WearableAuthMethod = "sdk" | "oauth" | "import";
export type WearableConnectionStatus = "active" | "paused" | "error" | "revoked";

export interface WearableCapability {
  provider: WearableProvider;
  display_name: string;
  auth_method: WearableAuthMethod;
  supports_sync: boolean;
  supports_webhook: boolean;
  supports_import_fallback: boolean;
  supports_metric_selection: boolean;
  supports_backfill: boolean;
}

export interface WearableConnection {
  id: string;
  provider: WearableProvider;
  auth_method: WearableAuthMethod;
  status: WearableConnectionStatus;
  provider_user_id?: string | null;
  last_sync_at?: string | null;
  last_successful_sync_at?: string | null;
  last_error_json?: Record<string, unknown> | null;
  tracked_metrics: string[];
  source_count: number;
}

export interface WearableSample {
  id: string;
  provider: WearableProvider;
  metric_type: string;
  provider_metric_type?: string | null;
  external_id?: string | null;
  recorded_at?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  attributed_date?: string | null;
  value: number;
  unit: string;
  aggregation_kind: string;
  confidence?: number | null;
  timezone?: string | null;
  source_id?: string | null;
  attributes_json?: Record<string, unknown> | null;
  deleted_at?: string | null;
}

export interface WearableEvent {
  id: string;
  provider: WearableProvider;
  event_type: string;
  provider_event_type?: string | null;
  external_id?: string | null;
  start_time: string;
  end_time: string;
  attributed_date?: string | null;
  timezone?: string | null;
  title?: string | null;
  summary_value?: number | null;
  summary_unit?: string | null;
  source_id?: string | null;
  details_json?: Record<string, unknown> | null;
  deleted_at?: string | null;
}

export interface WearableSyncRun {
  id: string;
  provider: WearableProvider;
  trigger: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  items_seen: number;
  items_written: number;
  items_updated: number;
  items_deleted: number;
  error_json?: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
}

export interface WearableConnectionsResponse {
  providers: WearableCapability[];
  connections: WearableConnection[];
}

export interface WearableConnectionActionResponse {
  success: boolean;
  provider: WearableProvider;
  connection?: WearableConnection | null;
  authorization_url?: string | null;
  message?: string | null;
}

export interface WearableSyncResponse {
  success: boolean;
  provider: WearableProvider;
  sync_run: WearableSyncRun;
  message?: string | null;
}
