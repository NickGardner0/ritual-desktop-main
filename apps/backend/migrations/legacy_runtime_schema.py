"""Legacy additive schema statements now owned by Alembic migrations.

This module is migration-only. Runtime startup must not import or execute these
statements; new schema changes should be added as normal Alembic revisions.
"""

from __future__ import annotations

COLUMN_MIGRATIONS = [('watcher_state',
  'afk_timeout_seconds',
  'ALTER TABLE watcher_state ADD COLUMN afk_timeout_seconds INTEGER DEFAULT 900'),
 ('import_runs', 'undo_expires_at', 'ALTER TABLE import_runs ADD COLUMN undo_expires_at DATETIME'),
 ('import_runs', 'undo_package_json', 'ALTER TABLE import_runs ADD COLUMN undo_package_json TEXT'),
 ('habit_logs', 'origin_record_kind', 'ALTER TABLE habit_logs ADD COLUMN origin_record_kind TEXT'),
 ('habit_logs', 'origin_record_id', 'ALTER TABLE habit_logs ADD COLUMN origin_record_id TEXT'),
 ('wearable_devices',
  'provider',
  "ALTER TABLE wearable_devices ADD COLUMN provider TEXT DEFAULT 'apple_health'"),
 ('wearable_devices',
  'connection_id',
  'ALTER TABLE wearable_devices ADD COLUMN connection_id TEXT'),
 ('wearable_devices',
  'last_seen_at',
  'ALTER TABLE wearable_devices ADD COLUMN last_seen_at DATETIME'),
 ('wearable_devices', 'sdk_version', 'ALTER TABLE wearable_devices ADD COLUMN sdk_version TEXT'),
 ('users', 'phone_number', 'ALTER TABLE users ADD COLUMN phone_number TEXT'),
 ('users', 'sms_welcome_sent_at', 'ALTER TABLE users ADD COLUMN sms_welcome_sent_at DATETIME'),
 ('users', 'turso_db_name', 'ALTER TABLE users ADD COLUMN turso_db_name TEXT'),
 ('users', 'turso_db_url', 'ALTER TABLE users ADD COLUMN turso_db_url TEXT'),
 ('users', 'turso_provisioned_at', 'ALTER TABLE users ADD COLUMN turso_provisioned_at DATETIME'),
 ('users', 'turso_migrated_at', 'ALTER TABLE users ADD COLUMN turso_migrated_at DATETIME'),
 ('whoop_integrations', 'scope', 'ALTER TABLE whoop_integrations ADD COLUMN scope TEXT'),
 ('ai_conversations',
  'channel',
  "ALTER TABLE ai_conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'app'"),
 ('ai_conversations',
  'auto_run_queued',
  'ALTER TABLE ai_conversations ADD COLUMN auto_run_queued INTEGER NOT NULL DEFAULT 0'),
 ('users', 'timezone', 'ALTER TABLE users ADD COLUMN timezone TEXT'),
 ('sms_preferences',
  'daily_narrative_enabled',
  'ALTER TABLE sms_preferences ADD COLUMN daily_narrative_enabled INTEGER NOT NULL DEFAULT 1'),
 ('sms_preferences',
  'interrupts_enabled',
  'ALTER TABLE sms_preferences ADD COLUMN interrupts_enabled INTEGER NOT NULL DEFAULT 1'),
 ('sms_preferences',
  'allowed_interrupt_kinds',
  'ALTER TABLE sms_preferences ADD COLUMN allowed_interrupt_kinds TEXT NOT NULL DEFAULT '
  "'distraction_spiral'"),
 ('sms_preferences',
  'max_interrupts_per_day',
  'ALTER TABLE sms_preferences ADD COLUMN max_interrupts_per_day INTEGER NOT NULL DEFAULT 2'),
 ('sms_preferences',
  'min_hours_between_interrupts',
  'ALTER TABLE sms_preferences ADD COLUMN min_hours_between_interrupts INTEGER NOT NULL DEFAULT 4'),
 ('wearable_samples',
  'rollup_level',
  "ALTER TABLE wearable_samples ADD COLUMN rollup_level TEXT NOT NULL DEFAULT 'raw'"),
 ('wearable_samples',
  'rollup_window_minutes',
  'ALTER TABLE wearable_samples ADD COLUMN rollup_window_minutes INTEGER'),
 ('wearable_samples',
  'sample_count',
  'ALTER TABLE wearable_samples ADD COLUMN sample_count INTEGER'),
 ('wearable_samples',
  'should_project_to_habit_logs',
  'ALTER TABLE wearable_samples ADD COLUMN should_project_to_habit_logs INTEGER NOT NULL DEFAULT '
  '1'),
 ('wearable_raw_payloads',
  'normalization_error_json',
  'ALTER TABLE wearable_raw_payloads ADD COLUMN normalization_error_json TEXT'),
 ('user_ui_preferences',
  'overview_view_mode',
  'ALTER TABLE user_ui_preferences ADD COLUMN overview_view_mode TEXT'),
 ('report_runs', 'artifact_id', 'ALTER TABLE report_runs ADD COLUMN artifact_id TEXT'),
 ('artifacts', 'slug', 'ALTER TABLE artifacts ADD COLUMN slug TEXT'),
 ('artifacts', 'preview_text', 'ALTER TABLE artifacts ADD COLUMN preview_text TEXT'),
 ('artifacts', 'folder_key', 'ALTER TABLE artifacts ADD COLUMN folder_key TEXT'),
 ('artifacts',
  'is_pinned',
  'ALTER TABLE artifacts ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0'),
 ('workflow_definitions',
  'definition_family',
  "ALTER TABLE workflow_definitions ADD COLUMN definition_family TEXT NOT NULL DEFAULT 'routine'"),
 ('workflow_definitions',
  'trigger_type',
  "ALTER TABLE workflow_definitions ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'schedule'"),
 ('workflow_definitions',
  'signal_kind',
  'ALTER TABLE workflow_definitions ADD COLUMN signal_kind TEXT'),
 ('workflow_definitions',
  'cooldown_minutes',
  'ALTER TABLE workflow_definitions ADD COLUMN cooldown_minutes INTEGER NOT NULL DEFAULT 240'),
 ('workflow_definitions',
  'quiet_hours_json',
  "ALTER TABLE workflow_definitions ADD COLUMN quiet_hours_json TEXT NOT NULL DEFAULT '{}'"),
 ('workflow_definitions',
  'ranking_json',
  "ALTER TABLE workflow_definitions ADD COLUMN ranking_json TEXT NOT NULL DEFAULT '{}'"),
 ('workflow_runs',
  'proposed_actions_json',
  'ALTER TABLE workflow_runs ADD COLUMN proposed_actions_json TEXT'),
 ('workflow_runs',
  'policy_decisions_json',
  'ALTER TABLE workflow_runs ADD COLUMN policy_decisions_json TEXT'),
 ('workflow_runs',
  'fact_suggestions_json',
  'ALTER TABLE workflow_runs ADD COLUMN fact_suggestions_json TEXT'),
 ('workflow_runs',
  'queue_suggestions_json',
  'ALTER TABLE workflow_runs ADD COLUMN queue_suggestions_json TEXT'),
 ('approval_requests', 'capability', 'ALTER TABLE approval_requests ADD COLUMN capability TEXT'),
 ('approval_requests',
  'proposed_action_json',
  "ALTER TABLE approval_requests ADD COLUMN proposed_action_json TEXT NOT NULL DEFAULT '{}'"),
 ('approval_requests',
  'policy_decision_json',
  "ALTER TABLE approval_requests ADD COLUMN policy_decision_json TEXT NOT NULL DEFAULT '{}'")]

CREATE_TABLE_SQL = [('artifacts',
  '\n'
  '            CREATE TABLE IF NOT EXISTS artifacts (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                kind TEXT NOT NULL,\n'
  '                source_type TEXT NOT NULL,\n'
  '                source_id TEXT,\n'
  '                title TEXT NOT NULL,\n'
  '                slug TEXT,\n'
  "                status TEXT NOT NULL DEFAULT 'published',\n"
  '                summary TEXT,\n'
  '                preview_text TEXT,\n'
  '                folder_key TEXT,\n'
  '                is_pinned INTEGER NOT NULL DEFAULT 0,\n'
  '                body_json TEXT NOT NULL,\n'
  "                metadata_json TEXT NOT NULL DEFAULT '{}',\n"
  '                period_start TEXT,\n'
  '                period_end TEXT,\n'
  "                timezone TEXT NOT NULL DEFAULT 'America/New_York',\n"
  '                conversation_id TEXT,\n'
  '                published_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE SET '
  'NULL\n'
  '            )\n'
  '            '),
 ('artifact_revisions',
  '\n'
  '            CREATE TABLE IF NOT EXISTS artifact_revisions (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                artifact_id TEXT NOT NULL,\n'
  '                version INTEGER NOT NULL DEFAULT 1,\n'
  '                editor_type TEXT NOT NULL,\n'
  '                body_json TEXT NOT NULL,\n'
  '                summary TEXT,\n'
  '                change_note TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('artifact_links',
  '\n'
  '            CREATE TABLE IF NOT EXISTS artifact_links (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                artifact_id TEXT NOT NULL,\n'
  '                user_id TEXT NOT NULL,\n'
  '                target_type TEXT NOT NULL,\n'
  '                target_id TEXT NOT NULL,\n'
  "                relationship TEXT NOT NULL DEFAULT 'linked',\n"
  "                metadata_json TEXT NOT NULL DEFAULT '{}',\n"
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('action_profiles',
  '\n'
  '            CREATE TABLE IF NOT EXISTS action_profiles (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                name TEXT NOT NULL,\n'
  '                mode TEXT NOT NULL,\n'
  '                is_default INTEGER NOT NULL DEFAULT 0,\n'
  "                rules_json TEXT NOT NULL DEFAULT '{}',\n"
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('workflow_definitions',
  '\n'
  '            CREATE TABLE IF NOT EXISTS workflow_definitions (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                kind TEXT NOT NULL,\n'
  '                name TEXT NOT NULL,\n'
  "                definition_family TEXT NOT NULL DEFAULT 'routine',\n"
  "                trigger_type TEXT NOT NULL DEFAULT 'schedule',\n"
  '                signal_kind TEXT,\n'
  '                cooldown_minutes INTEGER NOT NULL DEFAULT 240,\n'
  "                quiet_hours_json TEXT NOT NULL DEFAULT '{}',\n"
  "                status TEXT NOT NULL DEFAULT 'draft',\n"
  "                timezone TEXT NOT NULL DEFAULT 'America/New_York',\n"
  "                cadence TEXT NOT NULL DEFAULT 'daily',\n"
  '                send_hour_local INTEGER NOT NULL DEFAULT 8,\n'
  '                send_minute_local INTEGER NOT NULL DEFAULT 0,\n'
  "                send_weekdays_json TEXT NOT NULL DEFAULT '[]',\n"
  "                delivery_channel TEXT NOT NULL DEFAULT 'in_app',\n"
  "                delivery_json TEXT NOT NULL DEFAULT '{}',\n"
  "                ranking_json TEXT NOT NULL DEFAULT '{}',\n"
  "                config_json TEXT NOT NULL DEFAULT '{}',\n"
  '                template_version INTEGER NOT NULL DEFAULT 1,\n'
  '                action_profile_id TEXT NOT NULL,\n'
  '                last_run_at DATETIME,\n'
  '                next_run_at DATETIME,\n'
  '                last_error TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(action_profile_id) REFERENCES action_profiles(id)\n'
  '            )\n'
  '            '),
 ('workflow_runs',
  '\n'
  '            CREATE TABLE IF NOT EXISTS workflow_runs (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                workflow_definition_id TEXT NOT NULL,\n'
  '                user_id TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'queued',\n"
  '                trigger_source TEXT NOT NULL,\n'
  '                window_start DATETIME,\n'
  '                window_end DATETIME,\n'
  '                artifact_id TEXT,\n'
  '                conversation_id TEXT,\n'
  '                plan_json TEXT,\n'
  '                result_json TEXT,\n'
  '                proposed_actions_json TEXT,\n'
  '                policy_decisions_json TEXT,\n'
  '                fact_suggestions_json TEXT,\n'
  '                queue_suggestions_json TEXT,\n'
  '                error_json TEXT,\n'
  '                idempotency_key TEXT,\n'
  '                started_at DATETIME,\n'
  '                finished_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(workflow_definition_id) REFERENCES workflow_definitions(id) ON '
  'DELETE CASCADE,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,\n'
  '                FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE SET '
  'NULL\n'
  '            )\n'
  '            '),
 ('approval_requests',
  '\n'
  '            CREATE TABLE IF NOT EXISTS approval_requests (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                workflow_run_id TEXT,\n'
  '                action_kind TEXT NOT NULL,\n'
  '                capability TEXT,\n'
  "                status TEXT NOT NULL DEFAULT 'pending',\n"
  '                reason TEXT,\n'
  "                payload_json TEXT NOT NULL DEFAULT '{}',\n"
  "                proposed_action_json TEXT NOT NULL DEFAULT '{}',\n"
  "                policy_decision_json TEXT NOT NULL DEFAULT '{}',\n"
  '                expires_at DATETIME,\n'
  '                resolved_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL\n'
  '            )\n'
  '            '),
 ('action_receipts',
  '\n'
  '            CREATE TABLE IF NOT EXISTS action_receipts (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                workflow_run_id TEXT,\n'
  '                conversation_id TEXT,\n'
  '                action_kind TEXT NOT NULL,\n'
  '                capability TEXT NOT NULL,\n'
  '                target_ref TEXT,\n'
  "                status TEXT NOT NULL DEFAULT 'applied',\n"
  '                before_json TEXT,\n'
  '                after_json TEXT,\n'
  '                undo_json TEXT,\n'
  "                metadata_json TEXT NOT NULL DEFAULT '{}',\n"
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL,\n'
  '                FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE SET '
  'NULL\n'
  '            )\n'
  '            '),
 ('conversation_queue_items',
  '\n'
  '            CREATE TABLE IF NOT EXISTS conversation_queue_items (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                conversation_id TEXT NOT NULL,\n'
  '                user_id TEXT NOT NULL,\n'
  '                prompt_text TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'pending',\n"
  "                source TEXT NOT NULL DEFAULT 'manual',\n"
  '                after_message_id TEXT,\n'
  '                position INTEGER NOT NULL DEFAULT 0,\n'
  '                auto_run INTEGER NOT NULL DEFAULT 0,\n'
  '                error_json TEXT,\n'
  '                started_at DATETIME,\n'
  '                completed_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE '
  'CASCADE,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('ai_facts',
  '\n'
  '            CREATE TABLE IF NOT EXISTS ai_facts (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                category TEXT NOT NULL,\n'
  '                subject TEXT NOT NULL,\n'
  '                predicate TEXT NOT NULL,\n'
  '                value_json TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'pending',\n"
  '                confidence REAL NOT NULL DEFAULT 0.5,\n'
  "                source_type TEXT NOT NULL DEFAULT 'assistant',\n"
  '                source_ref TEXT,\n'
  "                visibility TEXT NOT NULL DEFAULT 'private',\n"
  '                last_confirmed_at DATETIME,\n'
  '                expires_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('ai_fact_events',
  '\n'
  '            CREATE TABLE IF NOT EXISTS ai_fact_events (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                fact_id TEXT NOT NULL,\n'
  '                user_id TEXT NOT NULL,\n'
  '                event_type TEXT NOT NULL,\n'
  "                payload_json TEXT NOT NULL DEFAULT '{}',\n"
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(fact_id) REFERENCES ai_facts(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('ambient_signal_events',
  '\n'
  '            CREATE TABLE IF NOT EXISTS ambient_signal_events (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                workflow_definition_id TEXT,\n'
  '                workflow_run_id TEXT,\n'
  '                signal_kind TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'candidate',\n"
  '                score REAL NOT NULL DEFAULT 0,\n'
  '                confidence REAL NOT NULL DEFAULT 0,\n'
  '                suppression_reason TEXT,\n'
  '                dedupe_key TEXT,\n'
  "                payload_json TEXT NOT NULL DEFAULT '{}',\n"
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(workflow_definition_id) REFERENCES workflow_definitions(id) ON '
  'DELETE SET NULL,\n'
  '                FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL\n'
  '            )\n'
  '            '),
 ('wearable_connections',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_connections (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                provider TEXT NOT NULL,\n'
  '                auth_method TEXT NOT NULL,\n'
  '                provider_user_id TEXT,\n'
  "                status TEXT NOT NULL DEFAULT 'active',\n"
  '                access_token TEXT,\n'
  '                refresh_token TEXT,\n'
  '                token_expires_at DATETIME,\n'
  '                scopes_json TEXT,\n'
  '                settings_json TEXT,\n'
  '                last_sync_at DATETIME,\n'
  '                last_successful_sync_at DATETIME,\n'
  '                last_error_json TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id)\n'
  '            )\n'
  '            '),
 ('wearable_sources',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_sources (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                connection_id TEXT,\n'
  '                provider TEXT NOT NULL,\n'
  '                source_kind TEXT NOT NULL,\n'
  '                external_source_id TEXT,\n'
  '                external_source_name TEXT,\n'
  '                device_name TEXT,\n'
  '                device_model TEXT,\n'
  '                device_type TEXT,\n'
  '                platform TEXT,\n'
  '                source_bundle_id TEXT,\n'
  '                priority_rank INTEGER NOT NULL DEFAULT 100,\n'
  '                is_active BOOLEAN DEFAULT 1,\n'
  '                metadata_json TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id),\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id)\n'
  '            )\n'
  '            '),
 ('wearable_raw_payloads',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_raw_payloads (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                connection_id TEXT,\n'
  '                provider TEXT NOT NULL,\n'
  '                direction TEXT NOT NULL,\n'
  '                external_id TEXT,\n'
  '                payload_sha256 TEXT NOT NULL,\n'
  '                payload_json TEXT NOT NULL,\n'
  '                received_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                expires_at DATETIME,\n'
  '                normalization_error_json TEXT,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id),\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id)\n'
  '            )\n'
  '            '),
 ('wearable_samples',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_samples (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                connection_id TEXT,\n'
  '                source_id TEXT,\n'
  '                provider TEXT NOT NULL,\n'
  '                metric_type TEXT NOT NULL,\n'
  '                provider_metric_type TEXT,\n'
  '                external_id TEXT,\n'
  '                recorded_at DATETIME,\n'
  '                start_time DATETIME,\n'
  '                end_time DATETIME,\n'
  '                attributed_date TEXT,\n'
  '                value REAL NOT NULL,\n'
  '                unit TEXT NOT NULL,\n'
  "                aggregation_kind TEXT NOT NULL DEFAULT 'point',\n"
  "                rollup_level TEXT NOT NULL DEFAULT 'raw',\n"
  '                rollup_window_minutes INTEGER,\n'
  '                sample_count INTEGER,\n'
  '                should_project_to_habit_logs INTEGER NOT NULL DEFAULT 1,\n'
  '                confidence REAL,\n'
  '                timezone TEXT,\n'
  '                attributes_json TEXT,\n'
  '                raw_payload_id TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                deleted_at DATETIME,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id),\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),\n'
  '                FOREIGN KEY(source_id) REFERENCES wearable_sources(id),\n'
  '                FOREIGN KEY(raw_payload_id) REFERENCES wearable_raw_payloads(id)\n'
  '            )\n'
  '            '),
 ('habit_projection_policies',
  '\n'
  '            CREATE TABLE IF NOT EXISTS habit_projection_policies (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                habit_id TEXT NOT NULL,\n'
  '                canonical_metric_type TEXT,\n'
  "                projection_source_priority_json TEXT NOT NULL DEFAULT '[]',\n"
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(habit_id) REFERENCES habits(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('metric_fact_rebuild_runs',
  '\n'
  '            CREATE TABLE IF NOT EXISTS metric_fact_rebuild_runs (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  "                mode TEXT NOT NULL DEFAULT 'dry_run',\n"
  "                status TEXT NOT NULL DEFAULT 'running',\n"
  '                start_date TEXT,\n'
  '                end_date TEXT,\n'
  '                source_families_json TEXT,\n'
  '                habit_ids_json TEXT,\n'
  '                facts_seen INTEGER NOT NULL DEFAULT 0,\n'
  '                facts_written INTEGER NOT NULL DEFAULT 0,\n'
  '                facts_unchanged INTEGER NOT NULL DEFAULT 0,\n'
  '                legacy_fallback_count INTEGER NOT NULL DEFAULT 0,\n'
  '                summary_json TEXT,\n'
  '                error_json TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                completed_at DATETIME,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('metric_daily_facts',
  '\n'
  '            CREATE TABLE IF NOT EXISTS metric_daily_facts (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                habit_id TEXT NOT NULL,\n'
  '                habit_name TEXT,\n'
  '                metric_key TEXT NOT NULL,\n'
  '                date TEXT NOT NULL,\n'
  '                value REAL NOT NULL DEFAULT 0,\n'
  "                unit TEXT NOT NULL DEFAULT 'count',\n"
  '                source_family TEXT NOT NULL,\n'
  '                provider TEXT,\n'
  '                record_count INTEGER NOT NULL DEFAULT 0,\n'
  '                provenance_json TEXT,\n'
  '                rebuild_run_id TEXT,\n'
  "                status TEXT NOT NULL DEFAULT 'complete',\n"
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(habit_id) REFERENCES habits(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(rebuild_run_id) REFERENCES metric_fact_rebuild_runs(id)\n'
  '            )\n'
  '            '),
 ('wearable_events',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_events (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                connection_id TEXT,\n'
  '                source_id TEXT,\n'
  '                provider TEXT NOT NULL,\n'
  '                event_type TEXT NOT NULL,\n'
  '                provider_event_type TEXT,\n'
  '                external_id TEXT,\n'
  '                start_time DATETIME NOT NULL,\n'
  '                end_time DATETIME NOT NULL,\n'
  '                attributed_date TEXT,\n'
  '                timezone TEXT,\n'
  '                title TEXT,\n'
  '                summary_value REAL,\n'
  '                summary_unit TEXT,\n'
  '                details_json TEXT,\n'
  '                raw_payload_id TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                deleted_at DATETIME,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id),\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),\n'
  '                FOREIGN KEY(source_id) REFERENCES wearable_sources(id),\n'
  '                FOREIGN KEY(raw_payload_id) REFERENCES wearable_raw_payloads(id)\n'
  '            )\n'
  '            '),
 ('wearable_sync_cursors',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_sync_cursors (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                connection_id TEXT NOT NULL,\n'
  '                source_id TEXT,\n'
  '                cursor_key TEXT NOT NULL,\n'
  '                cursor_type TEXT NOT NULL,\n'
  '                cursor_value TEXT NOT NULL,\n'
  '                last_synced_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),\n'
  '                FOREIGN KEY(source_id) REFERENCES wearable_sources(id)\n'
  '            )\n'
  '            '),
 ('wearable_sync_runs',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_sync_runs (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                connection_id TEXT,\n'
  '                provider TEXT NOT NULL,\n'
  '                trigger TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'running',\n"
  '                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                completed_at DATETIME,\n'
  '                items_seen INTEGER DEFAULT 0,\n'
  '                items_written INTEGER DEFAULT 0,\n'
  '                items_updated INTEGER DEFAULT 0,\n'
  '                items_deleted INTEGER DEFAULT 0,\n'
  '                error_json TEXT,\n'
  '                metadata_json TEXT,\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id)\n'
  '            )\n'
  '            '),
 ('wearable_ingest_job_batches',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_ingest_job_batches (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                provider TEXT,\n'
  '                requested_by_user_id TEXT,\n'
  '                trigger TEXT,\n'
  "                status TEXT NOT NULL DEFAULT 'queued',\n"
  '                total_jobs INTEGER NOT NULL DEFAULT 0,\n'
  '                completed_jobs INTEGER NOT NULL DEFAULT 0,\n'
  '                failed_jobs INTEGER NOT NULL DEFAULT 0,\n'
  '                metadata_json TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                started_at DATETIME,\n'
  '                completed_at DATETIME,\n'
  '                FOREIGN KEY(requested_by_user_id) REFERENCES users(id)\n'
  '            )\n'
  '            '),
 ('wearable_ingest_jobs',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_ingest_jobs (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                batch_id TEXT,\n'
  '                user_id TEXT NOT NULL,\n'
  '                connection_id TEXT,\n'
  '                provider TEXT NOT NULL,\n'
  '                job_type TEXT NOT NULL,\n'
  "                trigger TEXT NOT NULL DEFAULT 'manual',\n"
  "                status TEXT NOT NULL DEFAULT 'queued',\n"
  '                metric_scope_json TEXT,\n'
  '                start_date TEXT,\n'
  '                end_date TEXT,\n'
  '                payload_json TEXT,\n'
  '                result_json TEXT,\n'
  '                error_json TEXT,\n'
  '                idempotency_key TEXT,\n'
  '                sync_run_id TEXT,\n'
  '                attempts INTEGER NOT NULL DEFAULT 0,\n'
  '                max_attempts INTEGER NOT NULL DEFAULT 3,\n'
  '                last_attempt_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                started_at DATETIME,\n'
  '                completed_at DATETIME,\n'
  '                FOREIGN KEY(batch_id) REFERENCES wearable_ingest_job_batches(id),\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id),\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),\n'
  '                FOREIGN KEY(sync_run_id) REFERENCES wearable_sync_runs(id)\n'
  '            )\n'
  '            '),
 ('wearable_outbox_events',
  '\n'
  '            CREATE TABLE IF NOT EXISTS wearable_outbox_events (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                connection_id TEXT,\n'
  '                source_id TEXT,\n'
  '                provider TEXT NOT NULL,\n'
  '                event_type TEXT NOT NULL,\n'
  "                delivery_target TEXT NOT NULL DEFAULT 'internal',\n"
  '                related_record_kind TEXT NOT NULL,\n'
  '                related_record_id TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'queued',\n"
  '                payload_json TEXT,\n'
  '                result_json TEXT,\n'
  '                error_json TEXT,\n'
  '                dedupe_key TEXT,\n'
  '                attempts INTEGER NOT NULL DEFAULT 0,\n'
  '                max_attempts INTEGER NOT NULL DEFAULT 5,\n'
  '                available_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                started_at DATETIME,\n'
  '                completed_at DATETIME,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id),\n'
  '                FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),\n'
  '                FOREIGN KEY(source_id) REFERENCES wearable_sources(id)\n'
  '            )\n'
  '            '),
 ('heart_rate_sessions',
  '\n'
  '            CREATE TABLE IF NOT EXISTS heart_rate_sessions (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                source_type TEXT NOT NULL,\n'
  '                source_device_id TEXT NOT NULL,\n'
  '                status TEXT NOT NULL,\n'
  '                started_at DATETIME NOT NULL,\n'
  '                ended_at DATETIME,\n'
  '                app_version TEXT,\n'
  '                device_model TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id)\n'
  '            )\n'
  '            '),
 ('heart_rate_samples',
  '\n'
  '            CREATE TABLE IF NOT EXISTS heart_rate_samples (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                session_id TEXT NOT NULL,\n'
  '                source_type TEXT NOT NULL,\n'
  '                source_device_id TEXT NOT NULL,\n'
  '                bpm_raw INTEGER NOT NULL,\n'
  '                bpm_display INTEGER NOT NULL,\n'
  '                quality_score REAL,\n'
  '                is_outlier BOOLEAN NOT NULL DEFAULT 0,\n'
  '                rr_intervals_json TEXT,\n'
  '                contact_detected BOOLEAN,\n'
  '                received_at DATETIME NOT NULL,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id),\n'
  '                FOREIGN KEY(session_id) REFERENCES heart_rate_sessions(id)\n'
  '            )\n'
  '            '),
 ('heart_rate_1m_rollups',
  '\n'
  '            CREATE TABLE IF NOT EXISTS heart_rate_1m_rollups (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                bucket_start DATETIME NOT NULL,\n'
  '                source_preference TEXT NOT NULL,\n'
  '                sample_count INTEGER NOT NULL,\n'
  '                bpm_avg REAL NOT NULL,\n'
  '                bpm_min INTEGER NOT NULL,\n'
  '                bpm_max INTEGER NOT NULL,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id)\n'
  '            )\n'
  '            '),
 ('live_biometrics_state',
  '\n'
  '            CREATE TABLE IF NOT EXISTS live_biometrics_state (\n'
  '                user_id TEXT PRIMARY KEY,\n'
  '                current_bpm INTEGER,\n'
  '                current_source_type TEXT,\n'
  '                latest_sample_at DATETIME,\n'
  '                connection_state TEXT,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id)\n'
  '            )\n'
  '            '),
 ('sms_preferences',
  '\n'
  '            CREATE TABLE IF NOT EXISTS sms_preferences (\n'
  '                user_id TEXT PRIMARY KEY,\n'
  '                enabled INTEGER NOT NULL DEFAULT 1,\n'
  '                proactive_enabled INTEGER NOT NULL DEFAULT 1,\n'
  '                quiet_hours_start TEXT,\n'
  '                quiet_hours_end TEXT,\n'
  '                max_proactive_per_day INTEGER NOT NULL DEFAULT 1,\n'
  "                allowed_triggers TEXT NOT NULL DEFAULT '',\n"
  '                daily_narrative_enabled INTEGER NOT NULL DEFAULT 1,\n'
  '                interrupts_enabled INTEGER NOT NULL DEFAULT 1,\n'
  "                allowed_interrupt_kinds TEXT NOT NULL DEFAULT 'distraction_spiral',\n"
  '                max_interrupts_per_day INTEGER NOT NULL DEFAULT 2,\n'
  '                min_hours_between_interrupts INTEGER NOT NULL DEFAULT 4,\n'
  '                last_proactive_sent_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id)\n'
  '            )\n'
  '            '),
 ('sms_copilot_events',
  '\n'
  '            CREATE TABLE IF NOT EXISTS sms_copilot_events (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                conversation_id TEXT,\n'
  '                kind TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'candidate',\n"
  '                score REAL NOT NULL DEFAULT 0,\n'
  '                confidence REAL NOT NULL DEFAULT 0,\n'
  '                novelty_score REAL NOT NULL DEFAULT 0,\n'
  '                actionability_score REAL NOT NULL DEFAULT 0,\n'
  '                dedupe_key TEXT NOT NULL,\n'
  '                suppression_reason TEXT,\n'
  '                trigger_window_start DATETIME,\n'
  '                trigger_window_end DATETIME,\n'
  '                headline TEXT,\n'
  '                body TEXT,\n'
  '                metrics_json TEXT,\n'
  '                response_options_json TEXT,\n'
  '                assistant_message_id TEXT,\n'
  '                user_reply_message_id TEXT,\n'
  '                provider_message_id TEXT,\n'
  '                sent_at DATETIME,\n'
  '                replied_at DATETIME,\n'
  '                acted_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE SET '
  'NULL\n'
  '            )\n'
  '            '),
 ('behavior_baseline_snapshots',
  '\n'
  '            CREATE TABLE IF NOT EXISTS behavior_baseline_snapshots (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                metric_key TEXT NOT NULL,\n'
  '                lookback_days INTEGER NOT NULL DEFAULT 14,\n'
  '                baseline_json TEXT NOT NULL,\n'
  '                computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('report_schedules',
  '\n'
  '            CREATE TABLE IF NOT EXISTS report_schedules (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                user_id TEXT NOT NULL,\n'
  '                name TEXT NOT NULL,\n'
  '                cadence TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'draft',\n"
  "                timezone TEXT NOT NULL DEFAULT 'America/New_York',\n"
  "                delivery_channel TEXT NOT NULL DEFAULT 'email',\n"
  '                delivery_label TEXT NOT NULL,\n'
  '                send_hour_local INTEGER NOT NULL DEFAULT 8,\n'
  '                send_minute_local INTEGER NOT NULL DEFAULT 0,\n'
  '                send_weekday INTEGER,\n'
  '                send_day_of_month INTEGER,\n'
  "                recipients_json TEXT NOT NULL DEFAULT '[]',\n"
  "                sections_json TEXT NOT NULL DEFAULT '[]',\n"
  '                last_sent_at DATETIME,\n'
  '                next_run_at DATETIME,\n'
  '                last_error TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('report_runs',
  '\n'
  '            CREATE TABLE IF NOT EXISTS report_runs (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                schedule_id TEXT NOT NULL,\n'
  '                user_id TEXT NOT NULL,\n'
  '                cadence TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'queued',\n"
  '                period_start TEXT NOT NULL,\n'
  '                period_end TEXT NOT NULL,\n'
  '                subject TEXT,\n'
  '                summary_json TEXT,\n'
  '                email_html TEXT,\n'
  '                artifact_id TEXT,\n'
  '                generated_at DATETIME,\n'
  '                sent_at DATETIME,\n'
  '                error_json TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(schedule_id) REFERENCES report_schedules(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL\n'
  '            )\n'
  '            '),
 ('report_notifications',
  '\n'
  '            CREATE TABLE IF NOT EXISTS report_notifications (\n'
  '                id TEXT PRIMARY KEY,\n'
  '                report_run_id TEXT NOT NULL,\n'
  '                user_id TEXT NOT NULL,\n'
  "                channel TEXT NOT NULL DEFAULT 'email',\n"
  '                recipient_email TEXT NOT NULL,\n'
  "                status TEXT NOT NULL DEFAULT 'queued',\n"
  '                provider_message_id TEXT,\n'
  '                payload_json TEXT,\n'
  '                sent_at DATETIME,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(report_run_id) REFERENCES report_runs(id) ON DELETE CASCADE,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE\n'
  '            )\n'
  '            '),
 ('user_ui_preferences',
  '\n'
  '            CREATE TABLE IF NOT EXISTS user_ui_preferences (\n'
  '                user_id TEXT PRIMARY KEY,\n'
  '                habit_text_color TEXT,\n'
  '                overview_view_mode TEXT,\n'
  '                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n'
  '                FOREIGN KEY(user_id) REFERENCES users(id)\n'
  '            )\n'
  '            ')]

INDEX_SQL = [('idx_habit_logs_habit_date',
  'CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_date ON habit_logs (habit_id, date)'),
 ('idx_habit_logs_habit_status_date',
  'CREATE INDEX IF NOT EXISTS idx_habit_logs_habit_status_date ON habit_logs (habit_id, status, '
  'date)'),
 ('idx_habit_logs_origin_record',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_logs_origin_record ON habit_logs (habit_id, '
  'origin_record_kind, origin_record_id)'),
 ('idx_wearable_connections_user_provider',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_wearable_connections_user_provider ON '
  'wearable_connections (user_id, provider)'),
 ('idx_wearable_sources_user_provider_external',
  'CREATE INDEX IF NOT EXISTS idx_wearable_sources_user_provider_external ON wearable_sources '
  '(user_id, provider, external_source_id)'),
 ('idx_wearable_samples_user_metric_recorded',
  'CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_metric_recorded ON wearable_samples '
  '(user_id, metric_type, recorded_at)'),
 ('idx_wearable_samples_user_provider_date',
  'CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_provider_date ON wearable_samples '
  '(user_id, provider, attributed_date)'),
 ('idx_wearable_samples_user_provider_external',
  'CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_provider_external ON wearable_samples '
  '(user_id, provider, external_id)'),
 ('idx_wearable_samples_user_metric_start',
  'CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_metric_start ON wearable_samples (user_id, '
  'metric_type, start_time)'),
 ('idx_wearable_samples_user_metric_date_rollup',
  'CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_metric_date_rollup ON wearable_samples '
  '(user_id, metric_type, attributed_date, rollup_level)'),
 ('idx_wearable_events_user_type_start',
  'CREATE INDEX IF NOT EXISTS idx_wearable_events_user_type_start ON wearable_events (user_id, '
  'event_type, start_time)'),
 ('idx_wearable_events_user_provider_external',
  'CREATE INDEX IF NOT EXISTS idx_wearable_events_user_provider_external ON wearable_events '
  '(user_id, provider, external_id)'),
 ('idx_wearable_events_user_type_date_start',
  'CREATE INDEX IF NOT EXISTS idx_wearable_events_user_type_date_start ON wearable_events '
  '(user_id, event_type, attributed_date, start_time)'),
 ('idx_habit_projection_policies_habit',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_projection_policies_habit ON '
  'habit_projection_policies (habit_id)'),
 ('idx_metric_fact_runs_user_created',
  'CREATE INDEX IF NOT EXISTS idx_metric_fact_runs_user_created ON metric_fact_rebuild_runs '
  '(user_id, created_at)'),
 ('idx_metric_fact_runs_user_status',
  'CREATE INDEX IF NOT EXISTS idx_metric_fact_runs_user_status ON metric_fact_rebuild_runs '
  '(user_id, status)'),
 ('idx_metric_daily_facts_unique',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_daily_facts_unique ON metric_daily_facts (user_id, '
  'habit_id, metric_key, date)'),
 ('idx_metric_daily_facts_user_date',
  'CREATE INDEX IF NOT EXISTS idx_metric_daily_facts_user_date ON metric_daily_facts (user_id, '
  'date)'),
 ('idx_metric_daily_facts_user_habit_date',
  'CREATE INDEX IF NOT EXISTS idx_metric_daily_facts_user_habit_date ON metric_daily_facts '
  '(user_id, habit_id, date)'),
 ('idx_metric_daily_facts_user_metric_date',
  'CREATE INDEX IF NOT EXISTS idx_metric_daily_facts_user_metric_date ON metric_daily_facts '
  '(user_id, metric_key, date)'),
 ('idx_wearable_sync_cursors_unique',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_wearable_sync_cursors_unique ON wearable_sync_cursors '
  "(connection_id, COALESCE(source_id, ''), cursor_key)"),
 ('idx_wearable_raw_payloads_provider_received',
  'CREATE INDEX IF NOT EXISTS idx_wearable_raw_payloads_provider_received ON wearable_raw_payloads '
  '(provider, received_at)'),
 ('idx_wearable_ingest_jobs_status_created',
  'CREATE INDEX IF NOT EXISTS idx_wearable_ingest_jobs_status_created ON wearable_ingest_jobs '
  '(status, created_at)'),
 ('idx_wearable_ingest_jobs_user_provider',
  'CREATE INDEX IF NOT EXISTS idx_wearable_ingest_jobs_user_provider ON wearable_ingest_jobs '
  '(user_id, provider)'),
 ('idx_wearable_ingest_jobs_idempotency',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_wearable_ingest_jobs_idempotency ON wearable_ingest_jobs '
  '(idempotency_key) WHERE idempotency_key IS NOT NULL'),
 ('idx_wearable_outbox_events_status_available',
  'CREATE INDEX IF NOT EXISTS idx_wearable_outbox_events_status_available ON '
  'wearable_outbox_events (status, available_at)'),
 ('idx_wearable_outbox_events_user_provider',
  'CREATE INDEX IF NOT EXISTS idx_wearable_outbox_events_user_provider ON wearable_outbox_events '
  '(user_id, provider)'),
 ('idx_wearable_outbox_events_dedupe',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_wearable_outbox_events_dedupe ON wearable_outbox_events '
  '(dedupe_key) WHERE dedupe_key IS NOT NULL'),
 ('idx_heart_rate_sessions_user_started',
  'CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_started ON heart_rate_sessions '
  '(user_id, started_at)'),
 ('idx_heart_rate_sessions_user_status',
  'CREATE INDEX IF NOT EXISTS idx_heart_rate_sessions_user_status ON heart_rate_sessions (user_id, '
  'status)'),
 ('idx_heart_rate_samples_user_received',
  'CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_user_received ON heart_rate_samples (user_id, '
  'received_at)'),
 ('idx_heart_rate_samples_user_source_received',
  'CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_user_source_received ON heart_rate_samples '
  '(user_id, source_type, received_at)'),
 ('idx_heart_rate_samples_session_received',
  'CREATE INDEX IF NOT EXISTS idx_heart_rate_samples_session_received ON heart_rate_samples '
  '(session_id, received_at)'),
 ('idx_heart_rate_rollups_user_bucket_source',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_heart_rate_rollups_user_bucket_source ON '
  'heart_rate_1m_rollups (user_id, bucket_start, source_preference)'),
 ('idx_ai_conversations_user_sms_unique',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_conversations_user_sms_unique ON ai_conversations '
  "(user_id) WHERE channel = 'sms'"),
 ('idx_sms_copilot_events_user_dedupe',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_copilot_events_user_dedupe ON sms_copilot_events '
  '(user_id, dedupe_key)'),
 ('idx_sms_copilot_events_user_status_created',
  'CREATE INDEX IF NOT EXISTS idx_sms_copilot_events_user_status_created ON sms_copilot_events '
  '(user_id, status, created_at)'),
 ('idx_sms_copilot_events_user_kind_created',
  'CREATE INDEX IF NOT EXISTS idx_sms_copilot_events_user_kind_created ON sms_copilot_events '
  '(user_id, kind, created_at)'),
 ('idx_behavior_baselines_user_metric_computed',
  'CREATE INDEX IF NOT EXISTS idx_behavior_baselines_user_metric_computed ON '
  'behavior_baseline_snapshots (user_id, metric_key, computed_at)'),
 ('idx_artifacts_user_kind_created',
  'CREATE INDEX IF NOT EXISTS idx_artifacts_user_kind_created ON artifacts (user_id, kind, '
  'created_at DESC)'),
 ('idx_artifacts_source_unique',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_source_unique ON artifacts (source_type, '
  'source_id) WHERE source_id IS NOT NULL'),
 ('idx_artifact_revisions_artifact_version',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_revisions_artifact_version ON artifact_revisions '
  '(artifact_id, version)'),
 ('idx_artifact_links_artifact_target',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_links_artifact_target ON artifact_links '
  '(artifact_id, target_type, target_id)'),
 ('idx_artifact_links_user_target',
  'CREATE INDEX IF NOT EXISTS idx_artifact_links_user_target ON artifact_links (user_id, '
  'target_type, target_id)'),
 ('idx_action_profiles_user_mode',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_action_profiles_user_mode ON action_profiles (user_id, '
  'mode)'),
 ('idx_workflow_definitions_user_kind',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definitions_user_kind ON workflow_definitions '
  '(user_id, kind)'),
 ('idx_workflow_runs_definition_created',
  'CREATE INDEX IF NOT EXISTS idx_workflow_runs_definition_created ON workflow_runs '
  '(workflow_definition_id, created_at DESC)'),
 ('idx_workflow_runs_user_status_created',
  'CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_status_created ON workflow_runs (user_id, '
  'status, created_at DESC)'),
 ('idx_workflow_runs_idempotency',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_idempotency ON workflow_runs '
  '(idempotency_key) WHERE idempotency_key IS NOT NULL'),
 ('idx_approval_requests_user_status_created',
  'CREATE INDEX IF NOT EXISTS idx_approval_requests_user_status_created ON approval_requests '
  '(user_id, status, created_at DESC)'),
 ('idx_action_receipts_user_created',
  'CREATE INDEX IF NOT EXISTS idx_action_receipts_user_created ON action_receipts (user_id, '
  'created_at DESC)'),
 ('idx_action_receipts_run_created',
  'CREATE INDEX IF NOT EXISTS idx_action_receipts_run_created ON action_receipts (workflow_run_id, '
  'created_at DESC)'),
 ('idx_conversation_queue_user_conversation',
  'CREATE INDEX IF NOT EXISTS idx_conversation_queue_user_conversation ON conversation_queue_items '
  '(user_id, conversation_id, status, position)'),
 ('idx_ai_facts_user_status_category',
  'CREATE INDEX IF NOT EXISTS idx_ai_facts_user_status_category ON ai_facts (user_id, status, '
  'category, created_at DESC)'),
 ('idx_ai_fact_events_fact_created',
  'CREATE INDEX IF NOT EXISTS idx_ai_fact_events_fact_created ON ai_fact_events (fact_id, '
  'created_at DESC)'),
 ('idx_ambient_signal_events_user_status',
  'CREATE INDEX IF NOT EXISTS idx_ambient_signal_events_user_status ON ambient_signal_events '
  '(user_id, status, created_at DESC)'),
 ('idx_ambient_signal_events_dedupe',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_ambient_signal_events_dedupe ON ambient_signal_events '
  '(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL'),
 ('idx_report_schedules_user_status',
  'CREATE INDEX IF NOT EXISTS idx_report_schedules_user_status ON report_schedules (user_id, '
  'status)'),
 ('idx_report_schedules_next_run',
  'CREATE INDEX IF NOT EXISTS idx_report_schedules_next_run ON report_schedules (status, '
  'next_run_at)'),
 ('idx_report_runs_schedule_created',
  'CREATE INDEX IF NOT EXISTS idx_report_runs_schedule_created ON report_runs (schedule_id, '
  'created_at)'),
 ('idx_report_runs_user_status',
  'CREATE INDEX IF NOT EXISTS idx_report_runs_user_status ON report_runs (user_id, status, '
  'created_at)'),
 ('idx_report_runs_artifact',
  'CREATE INDEX IF NOT EXISTS idx_report_runs_artifact ON report_runs (artifact_id)'),
 ('idx_report_notifications_run_recipient',
  'CREATE INDEX IF NOT EXISTS idx_report_notifications_run_recipient ON report_notifications '
  '(report_run_id, recipient_email)')]
