export async function collectVaultRecordPages(fetchPage, options = {}) {
  const records = [];
  const seenCursors = new Set();
  const maxRecords = typeof options.maxRecords === 'number' && options.maxRecords > 0
    ? options.maxRecords
    : null;
  let cursor = null;
  do {
    const page = await fetchPage(cursor);
    records.push(...page.records);
    if (maxRecords && records.length >= maxRecords) {
      return records.slice(0, maxRecords);
    }
    const nextCursor = page.nextCursor || null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('Desktop vault pagination returned a repeated cursor');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  return records;
}
