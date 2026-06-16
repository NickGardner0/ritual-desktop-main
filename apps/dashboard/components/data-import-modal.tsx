"use client";

import React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronLeft, History, X } from "lucide-react";
import { useDataImport } from "./data-import/use-data-import";
import { SelectSourceStep } from "./data-import/select-source-step";
import { UploadPreviewStep } from "./data-import/upload-preview-step";
import { ConfigureStep } from "./data-import/configure-step";
import { ImportingStep } from "./data-import/importing-step";
import { CompleteStep } from "./data-import/complete-step";
import { HistoryStep } from "./data-import/history-step";

interface DataImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

export function DataImportModal({
  isOpen,
  onClose,
  onImportComplete,
}: DataImportModalProps) {
  const imp = useDataImport(onClose, onImportComplete);

  if (!isOpen) return null;

  const uploadPreviewProps = {
    error: imp.error, file: imp.file, fileInputRef: imp.fileInputRef,
    handleClose: imp.handleClose, handleDragLeave: imp.handleDragLeave, handleDragOver: imp.handleDragOver,
    handleDrop: imp.handleDrop, handleFetchPreview: imp.handleFetchPreview, handleFileSelect: imp.handleFileSelect,
    isDragging: imp.isDragging, isLoading: imp.isLoading, setFile: imp.setFile,
    sourceConfig: imp.sourceConfig ?? null,
  };

  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }}
    >
      <div 
        className="absolute inset-0 bg-[#f6f6f3]/60 dark:bg-[#121212]/80" 
        onClick={imp.handleClose}
      />
      
      <div 
        className="relative bg-white w-[90vw] max-w-xl flex flex-col shadow-xl border border-gray-300 z-10 rounded-sm max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {imp.step !== "select_source" && imp.step !== "complete" && imp.step !== "history" && (
              <button
                onClick={() => {
                  if (imp.step === "upload_preview") {
                    imp.setStep("select_source");
                    imp.setSelectedSource(null);
                    imp.setFile(null);
                    imp.setPreviewData(null);
                  } else if (imp.step === "configure") {
                    imp.setStep("upload_preview");
                    imp.setPreviewData(null);
                  } else if (imp.step === "importing") {
                    imp.handleCancelImport();
                  }
                }}
                className="p-1 hover:bg-[#F3F3F3] transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
            )}
            {imp.step === "history" && (
              <button
                onClick={() => imp.setStep("select_source")}
                className="p-1 hover:bg-[#F3F3F3] transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
            )}
            <h2 className="text-lg font-medium text-gray-900">
              {imp.step === "select_source" && "Import Data"}
              {imp.step === "upload_preview" && imp.sourceConfig?.name}
              {imp.step === "configure" && "Review & Import"}
              {imp.step === "importing" && "Importing..."}
              {imp.step === "complete" && "Import Complete"}
              {imp.step === "history" && "Import History"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {imp.step === "select_source" && (
              <button
                onClick={imp.handleShowHistory}
                className="p-1.5 hover:bg-[#F3F3F3] transition-colors text-gray-500 hover:text-gray-700"
                title="Import History"
              >
                <History className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={imp.handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className={cn(
          "flex-1 overflow-y-auto px-5 py-4",
          (imp.step === "select_source" || imp.step === "upload_preview") && "min-h-[360px]"
        )}>
          {imp.step === "select_source" && <SelectSourceStep imp={imp} />}
          {imp.step === "upload_preview" && (
            <UploadPreviewStep {...uploadPreviewProps} />
          )}
          {imp.step === "configure" && <ConfigureStep imp={imp} />}
          {imp.step === "importing" && <ImportingStep imp={imp} />}
          {imp.step === "complete" && <CompleteStep imp={imp} />}
          {imp.step === "history" && <HistoryStep imp={imp} />}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
