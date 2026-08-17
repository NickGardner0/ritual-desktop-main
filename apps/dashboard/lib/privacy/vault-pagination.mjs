export async function collectVaultRecordPages(fetchPage) {
  const records = [];
  const seenCursors = new Set();
  let cursor = null;
  do {
    const page = await fetchPage(cursor);
    records.push(...page.records);
    const nextCursor = page.nextCursor || null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error('Desktop vault pagination returned a repeated cursor');
    }
    if (nextCursor) seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);
  return records;
}
