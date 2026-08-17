"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Upload, Check, AlertCircle, ChevronDown } from "lucide-react";
import { BrailleSpinner } from "@/components/ui/braille-spinner";
import type { DataSourceConfig } from "../data-import-modal.config";

type Props = {
  error: string | null;
  file: File | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleClose: () => void;
  handleDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  handleDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  handleFetchPreview: () => void;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isDragging: boolean;
  isLoading: boolean;
  handleChooseFile: (file: File | null) => void;
  sourceConfig: DataSourceConfig | null;
};

export function UploadPreviewStep({
  error,
  file,
  fileInputRef,
  handleClose,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleFetchPreview,
  handleFileSelect,
  isDragging,
  isLoading,
  handleChooseFile,
  sourceConfig,
}: Props) {
  if (!sourceConfig) return null;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "border border-dashed p-8 text-center transition-colors cursor-pointer min-h-[180px] flex items-center justify-center",
          isDragging ? "border-gray-400 bg-[#F3F3F3]" : "border-gray-300 hover:border-gray-400",
          file && "border-gray-400 bg-[#F3F3F3]"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={sourceConfig.acceptedFiles}
          className="hidden"
          onChange={handleFileSelect}
        />

        {file ? (
          <div className="flex flex-col items-center gap-2">
            <Check className="w-6 h-6 text-gray-600" />
            <p className="text-sm font-medium text-gray-900">{file.name}</p>
            <p className="text-xs text-gray-500">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); handleChooseFile(null); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline mt-1"
            >
              Choose different file
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-6 h-6 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">Drop your file here</p>
            <p className="text-xs text-gray-500">or click to browse</p>
            <p className="text-xs text-gray-400 mt-2">Accepts {sourceConfig.acceptedFiles}</p>
          </div>
        )}
      </div>

      <details className="group">
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 list-none flex items-center gap-1">
          <ChevronDown className="w-3 h-3 -rotate-90 group-open:rotate-0 transition-transform" />
          How to export from {sourceConfig.name}
        </summary>
        <ol className="list-decimal list-inside space-y-0.5 text-xs text-gray-500 mt-2 pl-4">
          {sourceConfig.instructions.map((instruction, i) => (
            <li key={i}>{instruction}</li>
          ))}
        </ol>
      </details>

      {error && (
        <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 p-3 border border-red-200">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={handleClose}
          className="px-4 py-2 text-sm font-normal text-gray-600 hover:text-gray-900 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleFetchPreview}
          disabled={!file || isLoading}
          className="px-5 py-2 text-sm font-normal text-white bg-black rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <BrailleSpinner className="text-sm text-white" />
              Analyzing...
            </span>
          ) : (
            "Analyze & Preview"
          )}
        </button>
      </div>
    </div>
  );
}
