"use client";

import { ArrowUpwardSharp, ArrowDownwardSharp, SubdirectoryArrowLeftSharp } from "@mui/icons-material";

export function SearchFooter() {
  return (
    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between text-xs text-gray-500">
      {/* Left side - Ritual logo */}
      <div className="flex items-center opacity-60">
        <img
          src="/images/ritual.svg"
          alt="Ritual"
          className="w-4 h-4 opacity-50"
        />
      </div>

      {/* Right side - Keyboard shortcuts */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <ArrowUpwardSharp sx={{ fontSize: 12 }} />
          <ArrowDownwardSharp sx={{ fontSize: 12 }} />
          <span>Navigate</span>
        </div>
        <div className="flex items-center gap-1">
          <SubdirectoryArrowLeftSharp sx={{ fontSize: 12 }} />
          <span>Select</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono">
            esc
          </kbd>
          <span>Close</span>
        </div>
      </div>
    </div>
  );
}
