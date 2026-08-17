#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

function abs(path) {
  return resolve(repoRoot, path);
}

function read(path) {
  return readFileSync(abs(path), "utf8");
}

const requiredPatterns = [
  {
    file: "apps/backend/services/tinybird_service.py",
    patterns: ["can_send_to_cloud", "data_class_for_tinybird_datasource", "privacy_blocked"],
  },
  {
    file: "apps/backend/services/search_service.py",
    patterns: ["can_send_to_cloud", "data_class_for_typesense_collection", "_can_use_collection", "delete_user_indexed_documents"],
  },
  {
    file: "apps/backend/api/screenshot.py",
    patterns: ["_enforce_vision_consent", "request_privacy_mode", "required_consent"],
  },
  {
    file: "apps/backend/api/core.py",
    patterns: ["plaintext_sync", "request_cloud_consents", "privacy_blocked"],
  },
  {
    file: "apps/dashboard/app/api/chat/stream/route.ts",
    patterns: ["privacyBlockResponse", "ai"],
  },
  {
    file: "apps/dashboard/lib/privacy/privacy-settings.ts",
    patterns: ["local_only", "private_sync", "cloud_intelligence", "X-Ritual-Cloud-Consents"],
  },
  {
    file: "apps/dashboard/lib/privacy/habit-vault-adapter.ts",
    patterns: ["readLocalVaultHabits", "HABIT_DEFINITIONS_COLLECTION", "HABIT_LOGS_COLLECTION"],
  },
  {
    file: "apps/desktop/src-tauri/src/local_vault.rs",
    patterns: ["AES-256-GCM", "vault_records", "vault_migration_manifest", "vault_deletion_receipt", "redacted_error"],
  },
  {
    file: "apps/backend/services/privacy_migration_inventory.py",
    patterns: ["deletes_cloud_data", "changes_source_of_truth", "build_privacy_migration_plan", "build_privacy_migration_records_batch", "execute_privacy_cloud_deletion", "confirm_behavioral_cloud_deletion"],
  },
  {
    file: "apps/dashboard/lib/privacy/vault-migration.ts",
    patterns: ["executeLocalVaultMigration", "hashMigrationRecords", "putManifest", "Local vault verification failed", "financial_transactions", "wearable_samples", "sms_copilot"],
  },
  {
    file: "apps/dashboard/lib/privacy/vault-deletion.ts",
    patterns: ["executeCloudBehavioralDeletion", "listMigrationManifests", "putDeletionReceipt", "confirm_behavioral_cloud_deletion", "requires_local_receipt"],
  },
  {
    file: "apps/backend/database/models/privacy_sync.py",
    patterns: ["PrivateSyncEnvelopeDB", "PrivateSyncDeviceDB", "PrivateSyncKeyGrantDB", "private_sync_devices", "private_sync_key_grants", "ciphertext", "server_revision", "ciphertext_sha256"],
  },
  {
    file: "apps/backend/services/privacy_private_sync.py",
    patterns: ["put_private_sync_envelopes", "list_private_sync_envelopes", "delete_private_sync_envelopes", "register_private_sync_device", "revoke_private_sync_device", "put_private_sync_key_grants", "_require_active_device", "SUPPORTED_ENVELOPE_ALGORITHMS", "ciphertext"],
  },
  {
    file: "apps/backend/api/privacy.py",
    patterns: ["e2ee/envelopes", "e2ee/devices", "e2ee/key-grants", "x-ritual-private-sync-device-id", "turso_encrypted_sync", "encrypted_sync", "external-erasure-execute", "deletion-execute"],
  },
  {
    file: "apps/dashboard/lib/privacy/vault-private-sync.ts",
    patterns: ["webCrypto().subtle", "AES-GCM", "ciphertext", "ensurePrivateSyncKey", "pushPrivateSyncEnvelopes", "pullPrivateSyncEnvelopes", "registerPrivateSyncDevice", "writeConflictRecord"],
  },
  {
    file: "apps/dashboard/lib/privacy/vault-private-sync-devices.ts",
    patterns: ["PRIVATE_SYNC_DEVICE_HEADER", "registerPrivateSyncDevice", "listPrivateSyncDevices", "revokePrivateSyncDevice", "putPrivateSyncKeyGrants"],
  },
  {
    file: "apps/dashboard/lib/privacy/ritual-vault-export.ts",
    patterns: ["RITUAL_VAULT_ROOT", "checksums.sha256", "createRitualVaultFileSet", "createRitualVaultArchive", "writeRitualVaultFolderMirror", "saveRitualVaultArchive", "previewRitualVaultArchive", "importRitualVaultArchive"],
  },
  {
    file: "apps/dashboard/lib/privacy/ritual-vault-folder-settings.ts",
    patterns: ["RITUAL_VAULT_FOLDER_SETTINGS_KEY", "chooseRitualVaultFolder", "folderPath", "lastMirroredAt"],
  },
  {
    file: "apps/dashboard/components/privacy-settings-panel.tsx",
    patterns: ["PrivacySettingsPanel", "vaultSync", "private_sync", "cloud_intelligence", "provider_sync", "plaintext_sync"],
  },
  {
    file: "apps/dashboard/components/privacy-private-sync-section.tsx",
    patterns: ["pushPrivateSyncEnvelopes", "pullPrivateSyncEnvelopes", "registerPrivateSyncDevice", "revokePrivateSyncDevice", "listPrivateSyncDevices"],
  },
  {
    file: "apps/dashboard/components/privacy-vault-export-section.tsx",
    patterns: ["saveRitualVaultArchive", "openAndImportRitualVaultArchive", "chooseRitualVaultFolder", "writeRitualVaultFolderMirror", "Include sensitive", "Encrypted archive", "Mirror"],
  },
  {
    file: "apps/dashboard/components/onboarding/steps/permissions-step.tsx",
    patterns: ["Ritual Vault folder", "chooseRitualVaultFolder", "writeRitualVaultFolderMirror"],
  },
  {
    file: "apps/dashboard/lib/api/generated/backend-client.ts",
    patterns: ["/api/privacy/e2ee/envelopes", "/api/privacy/e2ee/devices", "/api/privacy/e2ee/key-grants"],
  },
];

const forbiddenPatterns = [
  {
    file: "apps/dashboard/lib/privacy/privacy-settings.ts",
    patterns: ["storageMode", "file_native", "vaultPath"],
  },
  {
    file: "apps/dashboard/components/providers.tsx",
    patterns: ["FileNativeVaultChangeBridge", "FileNativeWorkflowSchedulerBridge"],
  },
  {
    file: "apps/dashboard/hooks/use-habits-query.ts",
    patterns: ["readFileNativeHabits", "createFileNativeHabit", "logFileNativeHabit"],
  },
  {
    file: "apps/dashboard/components/command-palette.tsx",
    patterns: ["searchConfiguredFileNativeVault", "Vault Files", "search_file_native_vault_selected"],
  },
  {
    file: "apps/dashboard/components/analytics/metrics/useMetricsCanonicalEffects.ts",
    patterns: ["readConfiguredFileNativeHabitAnalytics", "fileNativeAnalytics"],
  },
  {
    file: "apps/dashboard/components/analytics/metrics/useMetricsBarListEffects.ts",
    patterns: ["readConfiguredFileNativeHabitAnalytics", "fileNativeAnalytics"],
  },
  {
    file: "apps/dashboard/app/(dashboard)/calendar/calendar-client.tsx",
    patterns: ["readConfiguredFileNativeCalendarReadModel", "fileNativeReadModel"],
  },
  {
    file: "apps/dashboard/app/(dashboard)/calendar/use-calendar-task-composer.ts",
    patterns: ["saveConfiguredFileNativeScheduledBlock", "deleteConfiguredFileNativeScheduledBlock"],
  },
  {
    file: "apps/dashboard/app/(dashboard)/chat/use-chat-send-message.ts",
    patterns: ["readFileNativeVaultChatContext", "localVaultContext"],
  },
  {
    file: "packages/chat-runtime/src/handle-chat-stream.ts",
    patterns: ["localVaultContext", "buildLocalVaultContextPromptBlock"],
  },
  {
    file: "packages/chat-runtime/src/types.ts",
    patterns: ["LocalVaultContext", "file_native_vault"],
  },
  {
    file: "apps/desktop/src-tauri/src/main.rs",
    patterns: ["file_native_index", "file_native_watcher", "rebuild_file_native_index", "start_file_native_vault_watcher"],
  },
  {
    file: "apps/desktop/src-tauri/permissions/desktop-runtime.toml",
    patterns: ["file_native", "rebuild_file_native_index", "start_file_native_vault_watcher"],
  },
  {
    file: "apps/desktop/src-tauri/crates/ritual-db/src/schema/vault.rs",
    patterns: ["FILE_NATIVE_INDEX_SCHEMA_SQL", "idx_file_native"],
  },
];

const forbiddenFiles = [
  "apps/dashboard/lib/privacy/file-native-vault.ts",
  "apps/dashboard/lib/privacy/file-native-vault-storage.ts",
  "apps/dashboard/lib/privacy/file-native-vault-cache.ts",
  "apps/dashboard/lib/privacy/file-native-vault-search.ts",
  "apps/dashboard/lib/privacy/file-native-analytics-adapter.ts",
  "apps/dashboard/lib/privacy/file-native-habit-adapter.ts",
  "apps/dashboard/lib/privacy/file-native-workflow-adapter.ts",
  "apps/dashboard/lib/privacy/file-native-artifact-adapter.ts",
  "apps/dashboard/components/file-native-vault-change-bridge.tsx",
  "apps/dashboard/components/file-native-workflow-scheduler-bridge.tsx",
  "apps/dashboard/components/privacy-file-native-vault-section.tsx",
  "apps/dashboard/components/privacy-file-native-vault-diagnostics-section.tsx",
  "apps/dashboard/components/privacy-private-sync-hardening-section.tsx",
  "apps/backend/migrations/versions/20260624_0002_add_private_sync_devices.py",
  "apps/desktop/src-tauri/src/file_native_index.rs",
  "apps/desktop/src-tauri/src/file_native_index_analytics.rs",
  "apps/desktop/src-tauri/src/file_native_index_retrieval.rs",
  "apps/desktop/src-tauri/src/file_native_watcher.rs",
];

const failures = [];

for (const check of requiredPatterns) {
  if (!existsSync(abs(check.file))) {
    failures.push(`Missing required file ${check.file}`);
    continue;
  }
  const content = read(check.file);
  for (const pattern of check.patterns) {
    if (!content.includes(pattern)) {
      failures.push(`${check.file} missing required pattern: ${pattern}`);
    }
  }
}

for (const check of forbiddenPatterns) {
  if (!existsSync(abs(check.file))) continue;
  const content = read(check.file);
  for (const pattern of check.patterns) {
    if (content.includes(pattern)) {
      failures.push(`${check.file} contains forbidden pattern: ${pattern}`);
    }
  }
}

for (const file of forbiddenFiles) {
  if (existsSync(abs(file))) {
    failures.push(`Deferred runtime file should not exist: ${file}`);
  }
}

if (failures.length > 0) {
  console.error("Privacy guardrail verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Privacy guardrail verification passed.");
