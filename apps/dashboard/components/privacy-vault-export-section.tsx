'use client';

import { useEffect, useState } from 'react';
import { Download, FileArchive, FolderOpen, RefreshCw, Upload } from 'lucide-react';

import type { DesktopVaultStatus } from '@/lib/privacy/vault-client';
import {
  DEFAULT_RITUAL_VAULT_EXPORT_CATEGORIES,
  RITUAL_VAULT_SENSITIVE_DEFAULT_EXCLUSIONS,
  SENSITIVE_RITUAL_VAULT_CATEGORIES,
  openAndImportRitualVaultArchive,
  saveEncryptedRitualVaultArchive,
  saveRitualVaultArchive,
  writeRitualVaultFolderMirror,
  type RitualVaultArchive,
  type RitualVaultEncryptedArchive,
  type RitualVaultFolderMirrorResult,
  type RitualVaultImportResult,
} from '@/lib/privacy/ritual-vault-export';
import {
  chooseRitualVaultFolder,
  readRitualVaultFolderSettings,
  writeRitualVaultFolderSettings,
  type RitualVaultFolderSettings,
} from '@/lib/privacy/ritual-vault-folder-settings';
import { getDesktopVaultStatus } from '@/lib/privacy/vault-client';
import {
  SettingsGroup,
  SettingsRow,
} from '@/components/ui/ritual-system';
import { cn } from '@/lib/utils';

type Props = {
  userId?: string | null;
  onVaultStatus: (status: DesktopVaultStatus | null) => void;
};

export function PrivacyVaultExportSection({ userId, onVaultStatus }: Props) {
  const [includeSensitiveExport, setIncludeSensitiveExport] = useState(false);
  const [encryptArchive, setEncryptArchive] = useState(true);
  const [archivePassphrase, setArchivePassphrase] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [folderMessage, setFolderMessage] = useState('');
  const [folderSettings, setFolderSettings] = useState<RitualVaultFolderSettings>(() => readRitualVaultFolderSettings());
  const [lastExport, setLastExport] = useState<(
    RitualVaultArchive | RitualVaultEncryptedArchive
  ) & { savedPath?: string } | null>(null);
  const [lastImport, setLastImport] = useState<RitualVaultImportResult | null>(null);
  const [lastMirror, setLastMirror] = useState<RitualVaultFolderMirrorResult | null>(null);

  useEffect(() => {
    const refreshFolderSettings = () => setFolderSettings(readRitualVaultFolderSettings());
    window.addEventListener('storage', refreshFolderSettings);
    window.addEventListener('ritual:vault-folder-settings-changed', refreshFolderSettings);
    return () => {
      window.removeEventListener('storage', refreshFolderSettings);
      window.removeEventListener('ritual:vault-folder-settings-changed', refreshFolderSettings);
    };
  }, []);

  const runExport = async () => {
    if (!userId) return;
    if (encryptArchive && archivePassphrase.trim().length < 12) {
      setExportMessage('Enter an archive passphrase with at least 12 characters.');
      return;
    }
    try {
      setExportMessage('Creating Ritual Vault archive...');
      const result = encryptArchive
        ? await saveEncryptedRitualVaultArchive({
          userId,
          includeSensitive: includeSensitiveExport,
          passphrase: archivePassphrase,
        })
        : await saveRitualVaultArchive({
          userId,
          includeSensitive: includeSensitiveExport,
        });
      setLastExport(result);
      onVaultStatus(await getDesktopVaultStatus(userId));
      setExportMessage(
        result.savedPath
          ? `Exported ${result.recordCount} records to ${result.fileName}${encryptArchive ? ' with encryption' : ''}.`
          : `Prepared ${result.recordCount} records; save was cancelled.`,
      );
    } catch {
      setExportMessage('Ritual Vault export could not be completed.');
    }
  };

  const runImport = async () => {
    if (!userId) return;
    try {
      setImportMessage('Validating Ritual Vault archive...');
      const result = await openAndImportRitualVaultArchive({
        userId,
        passphrase: archivePassphrase || undefined,
      });
      if (!result) {
        setImportMessage('Import was cancelled.');
        return;
      }
      setLastImport(result);
      onVaultStatus(await getDesktopVaultStatus(userId));
      setImportMessage(`Imported ${result.importedCount} records after checksum verification.`);
    } catch {
      setImportMessage('Ritual Vault import failed validation or could not be completed.');
    }
  };

  const chooseFolder = async () => {
    try {
      setFolderMessage('Choosing Ritual Vault folder...');
      const result = await chooseRitualVaultFolder();
      if (!result?.folderPath) {
        setFolderMessage('Folder selection was cancelled.');
        return;
      }
      setFolderSettings(result);
      setFolderMessage(`Folder selected: ${result.folderPath}`);
    } catch {
      setFolderMessage('Ritual Vault folder could not be selected in this runtime.');
    }
  };

  const mirrorFolder = async () => {
    if (!userId || !folderSettings.folderPath) return;
    try {
      setFolderMessage('Mirroring Ritual Vault folder...');
      const result = await writeRitualVaultFolderMirror({
        userId,
        folderPath: folderSettings.folderPath,
        includeSensitive: includeSensitiveExport,
      });
      setLastMirror(result);
      setFolderSettings(writeRitualVaultFolderSettings({
        folderPath: result.folderPath,
        lastMirroredAt: result.mirroredAt,
        lastRecordCount: result.recordCount,
      }));
      onVaultStatus(await getDesktopVaultStatus(userId));
      setFolderMessage(`Mirrored ${result.recordCount} records into ${result.folderPath}.`);
    } catch {
      setFolderMessage('Ritual Vault folder mirror could not be written.');
    }
  };

  return (
    <section>
      <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">Ritual Vault</h2>
      <SettingsGroup>
        <SettingsRow>
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#306774]/10 text-[#306774]">
                <FileArchive className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">
                  File-over-App archive
                </p>
                <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[var(--text-muted)]">
                  Export or import a checksum-verified `Ritual Vault/` ZIP from the encrypted local vault.
                </p>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setIncludeSensitiveExport(false)}
                className={cn(
                  'h-6 rounded-[7px] border px-2 text-[11px] font-medium transition-colors',
                  !includeSensitiveExport
                    ? 'border-[#306774] bg-[#306774] text-white'
                    : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                )}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setIncludeSensitiveExport(true)}
                className={cn(
                  'h-6 rounded-[7px] border px-2 text-[11px] font-medium transition-colors',
                  includeSensitiveExport
                    ? 'border-[#9f2d20] bg-[#9f2d20] text-white'
                    : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                )}
              >
                Include sensitive
              </button>
            </div>

            <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
              Standard export includes {DEFAULT_RITUAL_VAULT_EXPORT_CATEGORIES.length} core categories and excludes {SENSITIVE_RITUAL_VAULT_CATEGORIES.length} sensitive categories by default.
            </p>
            {includeSensitiveExport ? (
              <p className="mt-1 text-[11px] leading-snug text-[#9f2d20]">
                Sensitive export includes categories that may contain {RITUAL_VAULT_SENSITIVE_DEFAULT_EXCLUSIONS.slice(6).join(', ')}.
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#3f3f3f]">
                <input
                  type="checkbox"
                  checked={encryptArchive}
                  onChange={(event) => setEncryptArchive(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#3c7783]"
                />
                Encrypted archive
              </label>
              <input
                type="password"
                value={archivePassphrase}
                onChange={(event) => setArchivePassphrase(event.target.value)}
                placeholder="Archive passphrase"
                className="h-7 w-[190px] rounded-[7px] border border-black/10 bg-white px-2 text-[12px] text-[#2b2b2b] outline-none focus:border-[#306774]"
              />
            </div>
            {exportMessage ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{exportMessage}</p>
            ) : null}
            {importMessage ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{importMessage}</p>
            ) : null}
            {lastExport ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Last export: {lastExport.recordCount} records, {lastExport.manifest.categories.length} categories.
              </p>
            ) : null}
            {lastImport ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Last import: {lastImport.importedCount} records, {lastImport.preview.checksumCount} checksums verified.
              </p>
            ) : null}
            <div className="mt-2 rounded-[7px] border border-black/10 bg-white px-2 py-2">
              <p className="truncate text-[11px] font-medium text-[#2b2b2b]">
                {folderSettings.folderPath || 'No Ritual folder selected'}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-muted)]">
                {folderSettings.lastMirroredAt
                  ? `Last mirror: ${folderSettings.lastRecordCount ?? 0} records`
                  : 'Readable files are mirrored from the encrypted local vault.'}
              </p>
              {folderMessage ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{folderMessage}</p>
              ) : null}
              {lastMirror ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                  Mirror files: {lastMirror.fileCount}; categories: {lastMirror.manifest.categories.length}.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={chooseFolder}
              disabled={!userId}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                userId
                  ? 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={2.2} />
              Folder
            </button>
            <button
              type="button"
              onClick={mirrorFolder}
              disabled={!userId || !folderSettings.folderPath}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                userId && folderSettings.folderPath
                  ? 'border-[#306774] bg-[#306774] text-white hover:bg-[#285966]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
              Mirror
            </button>
            <button
              type="button"
              onClick={runExport}
              disabled={!userId}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                userId
                  ? 'border-[#306774] bg-[#306774] text-white hover:bg-[#285966]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
              Export
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!userId}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                userId
                  ? 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              <Upload className="h-3.5 w-3.5" strokeWidth={2.2} />
              Import
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </section>
  );
}
