"use client";

import React from "react";
import { BrailleSpinner } from "@/components/ui/braille-spinner";
import type { DataImportController } from "./use-data-import";

type Props = { imp: DataImportController };

export function ImportingStep({ imp }: Props) {
  return (
<div className="py-8 text-center space-y-4">
              <BrailleSpinner className="mx-auto text-2xl text-gray-400" />
              <div>
                <p className="text-sm font-medium text-gray-900">Importing your data...</p>
                {imp.importProgress.total > 0 && (
                  <>
                    <div className="w-full bg-gray-200 h-2 mt-3 mb-2">
                      <div 
                        className="bg-black h-2 transition-all duration-300"
                        style={{ width: `${Math.round((imp.importProgress.current / imp.importProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {imp.importProgress.current.toLocaleString()} of {imp.importProgress.total.toLocaleString()}
                    </p>
                  </>
                )}
              </div>
              <button
                onClick={imp.handleCancelImport}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Cancel
              </button>
            </div>

  );
}
