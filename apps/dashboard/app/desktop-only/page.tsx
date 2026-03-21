import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ritual Desktop Only',
  description: 'Ritual is currently available through the macOS desktop beta app.',
};

export default function DesktopOnlyPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f2e8] px-6 py-16 text-[#1d1a16]">
      <div className="w-full max-w-[560px] rounded-[32px] border border-black/10 bg-white/90 p-10 shadow-[0_30px_80px_rgba(0,0,0,0.08)] backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8a6f47]">
          Ritual Beta
        </p>
        <h1 className="mt-4 text-[34px] font-medium leading-[1.05] tracking-[-0.03em] text-[#1d1a16]">
          Ritual is currently available through the macOS desktop app.
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-[#55493c]">
          This hosted app is reserved for the desktop beta experience. If you were invited to the
          beta, open Ritual from the macOS app build you were sent.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            className="rounded-full border border-black/10 bg-[#1d1a16] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#2a241f]"
            href="/privacy"
          >
            Privacy Policy
          </Link>
          <Link
            className="rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-[#1d1a16] transition hover:bg-black/5"
            href="/data-retention"
          >
            Data Retention
          </Link>
        </div>
      </div>
    </main>
  );
}
