'use client';

import React from 'react';
import { ArrowUp, ArrowUpRight, AudioLines, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceWaveform, VoiceWaveformMini } from '../voice-waveform';
import { BrailleSpinner } from './braille-spinner';
import { ScreenshotConfirmationModal } from './screenshot-confirmation-modal';
import type { Clarification, InlineSuggestionOption, InputMode, ScreenshotPreview } from './ai-habit-chat.types';
import type { HabitOption } from './ai-habit-chat.types';

export type AiHabitChatFormProps = {
  mode: InputMode;
  setMode: React.Dispatch<React.SetStateAction<InputMode>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  error: string | null;
  isListening: boolean;
  isProcessingVoice: boolean;
  audioStream: MediaStream | null;
  partialTranscript: string | null;
  submitButtonLoading: boolean;
  isUploadingScreenshot: boolean;
  screenshotPreview: ScreenshotPreview | null;
  uploadedFileName: string | null;
  editedValue: string;
  setEditedValue: React.Dispatch<React.SetStateAction<string>>;
  selectedHabitId: string | null;
  setSelectedHabitId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedScreenshotHabit: HabitOption | null;
  screenshotHabitOptions: HabitOption[];
  showHabitPicker: boolean;
  setShowHabitPicker: React.Dispatch<React.SetStateAction<boolean>>;
  isConfirming: boolean;
  visibleInlineOptions: InlineSuggestionOption[];
  selectedSuggestionIndex: number;
  setSelectedSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;
  keyboardSuggestionActive: boolean;
  setKeyboardSuggestionActive: React.Dispatch<React.SetStateAction<boolean>>;
  showSuggestions: boolean;
  clarifications: Clarification[];
  setClarifications: React.Dispatch<React.SetStateAction<Clarification[]>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  router: { push: (path: string) => void; prefetch: (path: string) => void };
  handleFormSubmit: (e: React.FormEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleInputFocus: () => void;
  handleInputBlur: () => void;
  handleInlineOptionSelect: (option: InlineSuggestionOption) => void;
  startVoiceRecognition: () => void;
  handleUploadClick: () => void;
  handleFileChange: React.ChangeEventHandler<HTMLInputElement>;
  handleCancelScreenshot: () => void;
  handleConfirmScreenshot: () => void;
  adjustEditedValue: (delta: number) => void;
};

export function AiHabitChatForm(props: AiHabitChatFormProps) {
  const {
    mode, setMode, input, setInput, error, isListening, isProcessingVoice, audioStream,
    partialTranscript, submitButtonLoading, isUploadingScreenshot, screenshotPreview, uploadedFileName,
    editedValue, setEditedValue, selectedHabitId, setSelectedHabitId, selectedScreenshotHabit,
    screenshotHabitOptions, showHabitPicker, setShowHabitPicker, isConfirming, visibleInlineOptions,
    selectedSuggestionIndex, setSelectedSuggestionIndex, keyboardSuggestionActive, setKeyboardSuggestionActive,
    showSuggestions, clarifications, setClarifications, textareaRef, fileInputRef, router, handleFormSubmit, handleKeyDown,
    handleInputFocus, handleInputBlur, handleInlineOptionSelect, startVoiceRecognition, handleUploadClick,
    handleFileChange, handleCancelScreenshot, handleConfirmScreenshot, adjustEditedValue,
  } = props;

  return (
    <div className="w-full">
      {/* Screenshot Modal - Compact macOS-inspired */}
      <ScreenshotConfirmationModal
        isUploadingScreenshot={isUploadingScreenshot}
        screenshotPreview={screenshotPreview}
        uploadedFileName={uploadedFileName}
        editedValue={editedValue}
        setEditedValue={setEditedValue}
        selectedHabitId={selectedHabitId}
        setSelectedHabitId={setSelectedHabitId}
        selectedScreenshotHabit={selectedScreenshotHabit}
        screenshotHabitOptions={screenshotHabitOptions}
        showHabitPicker={showHabitPicker}
        setShowHabitPicker={setShowHabitPicker}
        isConfirming={isConfirming}
        adjustEditedValue={adjustEditedValue}
        handleCancelScreenshot={handleCancelScreenshot}
        handleConfirmScreenshot={handleConfirmScreenshot}
      />

      <div className="relative border border-gray-200/80 bg-[#FEFEFE] shadow-sm rounded-sm transition-all duration-300 hover:shadow-md hover:border-gray-300 focus-within:shadow-md focus-within:border-gray-300">
        <form onSubmit={handleFormSubmit}>
          <div className="px-5 pt-3 pb-3">
            {/* Input Area */}
            <div className="mb-1 relative">
              {isListening && audioStream ? (
                <div className="w-full flex flex-col items-center justify-center gap-1">
                  <div className="w-full h-[42px] flex items-center justify-center">
                    <VoiceWaveform isActive={true} audioStream={audioStream} className="h-10 w-full" />
                  </div>
                </div>
              ) : isListening || isProcessingVoice ? (
                <div className="w-full h-[42px]" aria-hidden />
              ) : (
                <textarea
                  ref={textareaRef}
                  value={isListening && partialTranscript ? partialTranscript : input}
                  onChange={(e) => {
                    if (clarifications.length > 0) {
                      setClarifications([]);
                    }
                    setInput(e.target.value);
                    setSelectedSuggestionIndex(0);
                    setKeyboardSuggestionActive(false);
                  }}
                  onKeyDown={handleKeyDown}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder={isListening
                    ? "Listening..."
                    : mode === 'log'
                      ? "Log anything..."
                      : "Ask about your personal data..."
                  }
                  className="w-full resize-none border-0 outline-none text-base text-gray-900 placeholder-gray-500 bg-transparent py-1.5 font-normal leading-6"
                  rows={1}
                  disabled={submitButtonLoading}
                  readOnly={isListening}
                />
              )}
            </div>

            <div
              className={cn(
                "overflow-hidden transition-all duration-150 ease-out",
                showSuggestions ? "max-h-[104px] opacity-100 pt-1 pb-0" : "max-h-0 opacity-0"
              )}
            >
              <div className="max-h-[98px] overflow-y-auto border-t border-gray-200/70 pt-0.5">
                {visibleInlineOptions.map((option, idx) => (
                  <button
                    key={option.key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleInlineOptionSelect(option)}
                    onMouseEnter={() => {
                      setSelectedSuggestionIndex(idx);
                      setKeyboardSuggestionActive(true);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-0 py-[7px] text-left text-[13px] transition-colors group",
                      idx === selectedSuggestionIndex
                        ? "text-gray-950"
                        : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate leading-snug">{option.label}</div>
                      {option.kind === 'clarification' && option.sublabel && (
                        <div className="truncate text-[11px] leading-snug text-gray-400">
                          {option.sublabel}
                        </div>
                      )}
                    </div>
                    <ArrowUpRight
                      className={cn(
                        "w-3 h-3 flex-shrink-0 transition-colors",
                        idx === selectedSuggestionIndex ? "text-gray-500" : "text-gray-300 group-hover:text-gray-500"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Bottom Row */}
            <div className="flex justify-between items-center mt-1.5">
              {/* Left side: Mode Toggle + Voice Button */}
              <div className="flex items-center gap-2 text-gray-600">
                {/* Mode Toggle - iOS style (FIRST) */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode(mode === 'log' ? 'chat' : 'log')}
                    className={cn(
                      "relative w-9 h-5 rounded-full transition-colors duration-200 ease-in-out focus:outline-none",
                      mode === 'chat' ? "bg-gray-900" : "bg-gray-300"
                    )}
                    role="switch"
                    aria-checked={mode === 'chat'}
                    aria-label="Toggle between log and chat mode"
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-in-out",
                        mode === 'chat' ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                  {mode === 'chat' ? (
                    <button
                      type="button"
                      onClick={() => router.push('/chat')}
                      className="text-xs text-gray-600 font-medium hover:text-gray-900 hover:underline transition-colors"
                      title="Open chat history"
                    >
                      Chat
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500 font-medium">
                      Log
                    </span>
                  )}
                </div>

                {/* Voice Button (SECOND) */}
                <div className="relative group">
                  <button
                    type="button"
                    className={cn(
                      "w-8 h-8 flex items-center justify-center transition-all duration-200 bg-transparent hover:bg-transparent",
                      isListening || isProcessingVoice
                        ? "text-gray-900"
                        : "text-gray-600 hover:text-gray-800"
                    )}
                    onClick={startVoiceRecognition}
                    aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                  >
                    {isListening ? (
                      <VoiceWaveformMini isActive={isListening} />
                    ) : isProcessingVoice ? (
                      <BrailleSpinner className="text-sm text-gray-900" />
                    ) : (
                      <AudioLines className="w-[18px] h-[18px] stroke-[1.5]" />
                    )}
                  </button>
                  {/* Tooltip */}
                  {!isListening && !isProcessingVoice && (
                    <div className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Voice Mode
                    </div>
                  )}
                </div>

                {/* Screen Time Upload Button (THIRD) */}
                <div className="relative group">
                  <button
                    type="button"
                    className={cn(
                      "w-8 h-8 flex items-center justify-center transition-all duration-200",
                      isUploadingScreenshot
                        ? "text-gray-900"
                        : "text-gray-600 hover:text-gray-800"
                    )}
                    onClick={handleUploadClick}
                    disabled={isUploadingScreenshot}
                    aria-label="Upload Screen Time screenshot"
                  >
                    {isUploadingScreenshot ? (
                      <BrailleSpinner className="text-sm text-gray-900" />
                    ) : (
                      <Paperclip className="w-4 h-4 stroke-[1.5]" />
                    )}
                  </button>
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {/* Tooltip */}
                  {!isUploadingScreenshot && (
                    <div className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Attach file
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!input.trim() || submitButtonLoading}
                className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors duration-200 hover:bg-[#27251E] disabled:cursor-not-allowed"
              >
                {submitButtonLoading ? (
                  <BrailleSpinner className="text-sm text-white" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}