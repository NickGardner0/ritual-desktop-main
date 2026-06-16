"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { History, RotateCcw } from "lucide-react";
import { BrailleSpinner } from "@/components/ui/braille-spinner";
import { DataSourceIcon, type DataSource } from "../data-import-modal.config";
import type { DataImportController } from "./use-data-import";

type Props = { imp: DataImportController };

export function HistoryStep({ imp }: Props) {
  return (
<div className="space-y-3">
              {imp.isLoadingHistory ? (
                <div className="py-8 text-center">
                  <BrailleSpinner className="mx-auto text-lg text-gray-400" />
                </div>
              ) : imp.importHistory.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm">No import history yet</p>
                </div>
              ) : (
                imp.importHistory.map((run) => (
                  <div key={run.id} className="border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <DataSourceIcon source={run.source as DataSource} className="w-4 h-4 text-gray-600" />
                        <span className="text-sm font-medium text-gray-900">{run.file_name || run.source}</span>
                      </div>
                      <span className={cn(
                        "text-xs px-2 py-0.5",
                        run.status === "completed" ? "bg-green-100 text-green-700" :
                        run.status === "failed" ? "bg-red-100 text-red-700" :
                        run.status === "undone" ? "bg-gray-100 text-gray-600" :
                        "bg-gray-100 text-gray-600"
                      )}>
                        {run.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>{new Date(run.created_at).toLocaleDateString()} at {new Date(run.created_at).toLocaleTimeString()}</p>
                      {run.summary && (
                        <p>{run.summary.imported} imported, {run.summary.skipped} skipped</p>
                      )}
                    </div>
                    {run.undo_available && run.status === "completed" && (
                      <button
                        onClick={() => imp.handleUndoImport(run.id)}
                        disabled={imp.isLoading}
                        className="mt-2 text-xs text-gray-500 hover:text-gray-700 underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Undo import
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

  );
}
