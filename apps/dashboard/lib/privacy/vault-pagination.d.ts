export function collectVaultRecordPages<T>(
  fetchPage: (cursor: string | null) => Promise<{
    records: T[];
    nextCursor?: string | null;
  }>,
): Promise<T[]>;
