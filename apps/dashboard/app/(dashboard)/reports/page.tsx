import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports | Ritual",
  description: "Reports are coming soon.",
};

export default function ReportsPage() {
  return (
    <div className="flex-1 overflow-auto bg-[#fafafa]">
      <div className="flex min-h-full items-center justify-center px-8 py-12">
        <h1 className="text-[22px] font-semibold leading-none text-[#2f2f2f]">
          Coming soon
        </h1>
      </div>
    </div>
  );
}
