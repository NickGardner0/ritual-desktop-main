import { NextResponse } from 'next/server';

import { resolveLatestMacDownloadUrl } from '../shared';

export async function GET() {
  const target = await resolveLatestMacDownloadUrl();
  return NextResponse.redirect(target, 307);
}
