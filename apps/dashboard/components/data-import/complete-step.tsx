"use client";

import React from "react";
import { Check, RotateCcw } from "lucide-react";
import type { DataImportController } from "./use-data-import";

type Props = { imp: DataImportController };

export function CompleteStep({ imp }: Props) {
  if (!imp.importResult) return null;

  return (
            <div className="py-8 text-center space-y-4">
              <div className="w-12 h-12 border-2 border-green-500 flex items-center justify-center mx-auto rounded-full">
                <Check className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-lg font-medium text-gray-900">Import Complete!</p>
                <div className="mt-3 text-sm text-gray-600 space-y-1">
                  <p><span className="font-medium text-gray-900">{imp.importResult.imported.toLocaleString()}</span> records imported</p>
                  {imp.importResult.updated > 0 && (
                    <p><span className="font-medium text-gray-900">{imp.importResult.updated.toLocaleString()}</span> records updated</p>
                  )}
                  {imp.importResult.skipped > 0 && (
                    <p className="text-gray-500">{imp.importResult.skipped.toLocaleString()} skipped (duplicates)</p>
                  )}
                  {imp.importResult.errors > 0 && (
                    <p className="text-red-500">{imp.importResult.errors.toLocaleString()} errors</p>
                  )}
                </div>
              </div>
              <div className="flex justify-center gap-3 pt-2">
                {imp.importRunId && (
                  <button
                    onClick={() => imp.importRunId && imp.handleUndoImport(imp.importRunId)}
                    disabled={imp.isLoading}
                    className="px-4 py-2 text-sm font-normal text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Undo
                  </button>
                )}
                <button
                  onClick={imp.handleClose}
                  className="px-5 py-2 text-sm font-normal text-white bg-black rounded-sm transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
  );
}
