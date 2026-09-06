"use client"

import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type { HabitOption, ScreenshotPreview } from './ai-habit-chat.types';

interface ScreenshotConfirmationModalProps {
  isUploadingScreenshot: boolean;
  screenshotPreview: ScreenshotPreview | null;
  uploadedFileName: string | null;
  editedValue: string;
  setEditedValue: (value: string) => void;
  selectedHabitId: string | null;
  setSelectedHabitId: (value: string | null) => void;
  selectedScreenshotHabit: HabitOption | null;
  screenshotHabitOptions: HabitOption[];
  showHabitPicker: boolean;
  setShowHabitPicker: Dispatch<SetStateAction<boolean>>;
  isConfirming: boolean;
  adjustEditedValue: (delta: number) => void;
  handleCancelScreenshot: () => void;
  handleConfirmScreenshot: () => void;
}

export function ScreenshotConfirmationModal({
  isUploadingScreenshot,
  screenshotPreview,
  uploadedFileName,
  editedValue,
  setEditedValue,
  selectedHabitId,
  setSelectedHabitId,
  selectedScreenshotHabit,
  screenshotHabitOptions,
  showHabitPicker,
  setShowHabitPicker,
  isConfirming,
  adjustEditedValue,
  handleCancelScreenshot,
  handleConfirmScreenshot,
}: ScreenshotConfirmationModalProps) {
  if (!isUploadingScreenshot && !screenshotPreview) {
    return null;
  }

  return (

        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            onClick={handleCancelScreenshot}
          />

          {/* Modal */}
          <div
            className="relative z-10 w-[92vw] max-w-[470px] rounded-none border border-gray-300 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-200/80 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {!isUploadingScreenshot && screenshotPreview?.low_confidence && (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  {!isUploadingScreenshot && !screenshotPreview?.low_confidence && (
                    <Check className="h-4 w-4 text-gray-900" />
                  )}

                  <h3 className="text-sm font-medium tracking-tight text-[#111827]">
                    {isUploadingScreenshot ? "Analyzing screenshot" : "Detected"}
                  </h3>

                  {/* Status pill */}
                  {!isUploadingScreenshot && screenshotPreview?.low_confidence && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                      Review
                    </span>
                  )}
                </div>

                {/* filename */}
                <p className="mt-1 truncate text-xs text-[#6B7280]">
                  {uploadedFileName ?? "Screenshot"}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCancelScreenshot}
                className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* BODY */}
            <div className="px-4 py-4">
              {/* Loading state */}
              {isUploadingScreenshot && (
                <div className="flex min-h-[168px] items-center justify-center">
                  <div className="w-full px-3 py-6 text-center">
                    <p className="text-lg font-medium tracking-tight text-[#111827]">
                      Matching to your habits
                    </p>
                    <div className="mt-3 flex justify-center">
                      <BrailleSpinner name="braille" className="text-[30px]" />
                    </div>
                    <p className="mt-3 text-xs text-[#6B7280]">
                      Extracting values from your image.
                    </p>
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      Usually done in a few seconds.
                    </p>
                  </div>
                </div>
              )}

              {/* Confirmation state */}
              {screenshotPreview && !isUploadingScreenshot && (
                <div className="space-y-3">
                  {/* HERO VALUE */}
                  <div className="px-2 py-2">
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="number"
                        value={editedValue}
                        onChange={(e) => setEditedValue(e.target.value)}
                        className="w-24 bg-transparent text-center text-[32px] font-medium tracking-tight text-[#111827] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        step="0.1"
                        min="0"
                      />
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => adjustEditedValue(0.1)}
                          className="inline-flex h-5 w-5 items-center justify-center border border-[#D1D5DB] text-[#4B5563] hover:bg-[#F3F4F6]"
                          aria-label="Increase value"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustEditedValue(-0.1)}
                          className="inline-flex h-5 w-5 items-center justify-center border border-[#D1D5DB] text-[#4B5563] hover:bg-[#F3F4F6]"
                          aria-label="Decrease value"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-sm text-[#4B5563]">
                        {selectedScreenshotHabit?.unit_type || screenshotPreview.unit}
                      </span>
                    </div>

                    {screenshotPreview.description && (
                      <p className="mt-2 text-center text-xs text-[#6B7280]">
                        {screenshotPreview.description}
                      </p>
                    )}

                    {/* Validation warning */}
                    {!screenshotPreview.validation.is_valid && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium">Check this value</div>
                          <div className="text-amber-800/90">
                            {screenshotPreview.validation.reason}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* HABIT SELECTOR */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6B7280]">Log to</div>

                    <div className="border border-[#C8CDD5] bg-white">
                      <button
                        type="button"
                        onClick={() => setShowHabitPicker((current) => !current)}
                        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#F9FAFB]"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[#111827]">
                            {selectedHabitId
                              ? selectedScreenshotHabit?.name
                              : screenshotPreview.habit_name}
                          </div>
                          <div className="text-xs text-[#6B7280]">
                            {selectedHabitId
                              ? "Existing habit"
                              : screenshotPreview.is_new_habit
                                ? "Will create new habit"
                                : "Detected habit"}
                          </div>
                        </div>
                        <div className="ml-3 flex items-center gap-2">
                          <span className="text-xs text-[#9CA3AF]">
                            {selectedScreenshotHabit?.unit_type || screenshotPreview.unit}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-[#9CA3AF] transition-transform",
                              showHabitPicker && "rotate-180"
                            )}
                          />
                        </div>
                      </button>

                      {showHabitPicker && (
                        <div className="border-t border-[#E5E7EB]">
                          {screenshotPreview.is_new_habit && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedHabitId(null);
                                setShowHabitPicker(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 border-b border-gray-200 px-2.5 py-1.5 text-left text-sm ritual-snappy-row ritual-snappy-row-menu",
                                !selectedHabitId && "bg-[#F3F3F3]"
                              )}
                            >
                              <span className="text-xs font-semibold text-gray-900">+</span>
                              <span className="truncate">Create &quot;{screenshotPreview.habit_name}&quot;</span>
                            </button>
                          )}

                          <div className="max-h-28 overflow-y-auto">
                            {screenshotHabitOptions.map((habit) => (
                              <button
                                key={habit.id}
                                type="button"
                                onClick={() => {
                                  setSelectedHabitId(habit.id);
                                  setShowHabitPicker(false);
                                }}
                                className={cn(
                                  "flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm ritual-snappy-row ritual-snappy-row-menu",
                                  selectedHabitId === habit.id && "bg-[#F3F3F3]"
                                )}
                              >
                                <span className="truncate">{habit.name}</span>
                                <span className="ml-3 text-xs text-[#9CA3AF]">
                                  {habit.unit_type}
                                </span>
                              </button>
                            ))}
                            {screenshotHabitOptions.length === 0 && (
                              <div className="px-2.5 py-1.5 text-xs text-[#6B7280]">
                                No habits available
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* FOOTER */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-200/80 bg-[#F7F7F8] px-4 py-3">
              <button
                type="button"
                onClick={handleCancelScreenshot}
                className="border border-[#C8CDD5] px-3 py-1.5 text-sm text-[#4B5563] hover:bg-[#EBEDF0] hover:text-[#111827]"
                disabled={isConfirming}
              >
                Cancel
              </button>

              {!isUploadingScreenshot && (
                <button
                  type="button"
                  onClick={handleConfirmScreenshot}
                  disabled={isConfirming || !editedValue}
                  className="inline-flex items-center gap-2 border border-[#111827] bg-[#111827] px-3 py-1.5 text-sm font-medium text-white rounded-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isConfirming ? (
                    <BrailleSpinner className="text-sm text-white" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Log
                </button>
              )}
            </div>
          </div>
        </div>
  );
}
