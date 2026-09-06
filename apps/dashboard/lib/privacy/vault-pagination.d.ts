export function collectVaultRecordPages<T>(
  fetchPage: (cursor: string | null) => Promise<{
    records: T[];
    nextCursor?: string | null;
  }>,
  options?: { maxRecords?: number },
): Promise<T[]>;
