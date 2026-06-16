"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { DATA_SOURCES, DataSourceIcon, type DataSource } from "../data-import-modal.config";
import type { DataImportController } from "./use-data-import";

type Props = { imp: DataImportController };

export function SelectSourceStep({ imp }: Props) {
  return (
<div className="space-y-0">
              {DATA_SOURCES.map((source) => (
                <div
                  key={source.id}
                  className="flex justify-between items-center h-11"
                >
                  <div className="flex items-center">
                    <div className="flex h-11 w-11 items-center justify-center">
                      <DataSourceIcon 
                        source={source.id} 
                        className={cn(
                          "text-gray-900",
                          source.id === "oura" ? "h-7 w-auto" :
                          source.id === "whoop" || source.id === "garmin" ? "h-5 w-auto" :
                          source.id === "csv" ? "h-5 w-5" :
                          "w-5 h-5"
                        )} 
                      />
                    </div>
                    <span className="text-sm font-normal text-gray-900 ml-2.5">{source.name}</span>
                  </div>
                  <button
                    onClick={() => imp.handleSelectSource(source.id)}
                    className="px-4 py-1.5 text-sm font-normal text-gray-700 bg-white border border-gray-300 rounded-sm hover:bg-[#F3F3F3] transition-colors mr-1"
                  >
                    Import
                  </button>
                </div>
              ))}
            </div>

  );
}
