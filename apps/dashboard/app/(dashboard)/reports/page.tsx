import type { Metadata } from "next";
import { Info } from "lucide-react";

export const metadata: Metadata = {
  title: "Reports | Ritual",
  description: "Reports are coming soon.",
};

export default function ReportsPage() {
  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="flex min-h-full items-center justify-center px-4 text-center">
        <div>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <Info className="h-6 w-6 text-gray-400" />
          </div>
          <h3 className="mb-2 text-lg font-medium text-gray-900">
            Reports coming soon
          </h3>
          <p className="mx-auto max-w-sm text-sm text-gray-500">
            This page is being rebuilt from scratch.
          </p>
        </div>
      </div>
    </div>
  );
}
