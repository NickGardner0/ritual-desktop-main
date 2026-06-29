"use client";

export type RitualVaultFolderSettings = {
  folderPath: string | null;
  lastMirroredAt: string | null;
  lastRecordCount: number | null;
  updatedAt: string;
};

export const RITUAL_VAULT_FOLDER_SETTINGS_KEY = "ritual.vault.folder.settings.v1";

export const DEFAULT_RITUAL_VAULT_FOLDER_SETTINGS: RitualVaultFolderSettings = {
  folderPath: null,
  lastMirroredAt: null,
  lastRecordCount: null,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export function normalizeRitualVaultFolderSettings(value: unknown): RitualVaultFolderSettings {
  const candidate = value && typeof value === "object" ? value as Partial<RitualVaultFolderSettings> : {};
  return {
    folderPath: typeof candidate.folderPath === "string" && candidate.folderPath.trim()
      ? candidate.folderPath.trim()
      : null,
    lastMirroredAt: typeof candidate.lastMirroredAt === "string" ? candidate.lastMirroredAt : null,
    lastRecordCount: typeof candidate.lastRecordCount === "number" && candidate.lastRecordCount >= 0
      ? candidate.lastRecordCount
      : null,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
}

export function readRitualVaultFolderSettings(): RitualVaultFolderSettings {
  if (typeof window === "undefined") return DEFAULT_RITUAL_VAULT_FOLDER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(RITUAL_VAULT_FOLDER_SETTINGS_KEY);
    return raw ? normalizeRitualVaultFolderSettings(JSON.parse(raw)) : DEFAULT_RITUAL_VAULT_FOLDER_SETTINGS;
  } catch {
    return DEFAULT_RITUAL_VAULT_FOLDER_SETTINGS;
  }
}

export function writeRitualVaultFolderSettings(
  settings: Partial<RitualVaultFolderSettings>,
): RitualVaultFolderSettings {
  const normalized = normalizeRitualVaultFolderSettings({
    ...readRitualVaultFolderSettings(),
    ...settings,
    updatedAt: new Date().toISOString(),
  });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RITUAL_VAULT_FOLDER_SETTINGS_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent("ritual:vault-folder-settings-changed", { detail: normalized }));
  }
  return normalized;
}

export async function chooseRitualVaultFolder(): Promise<RitualVaultFolderSettings | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title: "Choose Ritual Vault folder",
    directory: true,
    recursive: true,
    multiple: false,
    canCreateDirectories: true,
  });
  if (!selected || Array.isArray(selected)) return null;
  return writeRitualVaultFolderSettings({ folderPath: selected });
}
