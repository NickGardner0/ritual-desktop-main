'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, ArrowUpRight, AudioLines, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceWaveform, VoiceWaveformMini } from '../voice-waveform';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
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
    showSuggestions, clarifications, setClarifications, textareaRef, fileInputRef, handleFormSubmit, handleKeyDown,
    handleInputFocus, handleInputBlur, handleInlineOptionSelect, startVoiceRecognition, handleUploadClick,
    handleFileChange, handleCancelScreenshot, handleConfirmScreenshot, adjustEditedValue,
  } = props;

  const hasInput = input.trim().length > 0;
  const hasExtraInput = input.length > 120 || input.includes('\n');
  const hasSuggestionContent = visibleInlineOptions.length > 0 || clarifications.length > 0;
  const composerHeightClass = showSuggestions && hasSuggestionContent
    ? 'h-[194px]'
    : error
      ? 'h-[142px]'
      : hasExtraInput
        ? 'h-[132px]'
        : 'h-[114px]';
  const composerActionClass =
    'flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] text-[var(--icon-default)] transition-none hover:bg-[color-mix(in_srgb,var(--text-primary)_11%,transparent)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-panel)] disabled:cursor-not-allowed';

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

      <div
        className={cn(
          'relative mx-auto w-full max-w-[768px] overflow-hidden rounded-[18px] bg-[var(--surface-panel)] ring-1 ring-inset ring-[var(--border-muted)] transition-none focus-within:ring-[color-mix(in_srgb,var(--ritual-focus-ring)_28%,transparent)]',
          composerHeightClass
        )}
      >
        <form onSubmit={handleFormSubmit} className="h-full">
          <div className="relative h-full">
            <div className="absolute inset-x-0 top-0 px-5 pt-4">
              {isListening && audioStream ? (
                <div className="flex h-[36px] w-full items-center justify-center">
                  <VoiceWaveform isActive={true} audioStream={audioStream} className="h-8 w-full" />
                </div>
              ) : isListening || isProcessingVoice ? (
                <div className="h-[36px] w-full" aria-hidden />
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
                  className={cn(
                    "w-full resize-none border-0 bg-transparent font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-60",
                    "min-h-[42px] max-h-[80px] py-0.5 text-[17px] leading-6"
                  )}
                  rows={1}
                  aria-label={mode === 'log' ? 'Log an activity' : 'Ask about your personal data'}
                  disabled={submitButtonLoading}
                  readOnly={isListening}
                />
              )}

              <AnimatePresence initial={false}>
                {showSuggestions && hasSuggestionContent && (
                  <motion.div
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(4px)' }}
                    transition={{ duration: 0.14, ease: 'easeOut' }}
                    className="mt-1 max-h-[102px] overflow-y-auto border-t border-[var(--border-subtle)] pt-0.5"
                  >
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
                          "group flex w-full items-center justify-between gap-3 px-0 py-[7px] text-left text-[13px] transition-colors",
                          idx === selectedSuggestionIndex
                            ? "text-[var(--text-primary)]"
                            : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate leading-snug">{option.label}</div>
                          {option.kind === 'clarification' && option.sublabel && (
                            <div className="truncate text-[11px] leading-snug text-[var(--text-muted)]">
                              {option.sublabel}
                            </div>
                          )}
                        </div>
                        <ArrowUpRight
                          className={cn(
                            "h-3 w-3 flex-shrink-0 transition-colors",
                            idx === selectedSuggestionIndex
                              ? "text-[var(--icon-default)]"
                              : "text-[var(--icon-muted)] group-hover:text-[var(--icon-default)]"
                          )}
                        />
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.12, ease: 'easeOut' }}
                    className="mt-2 border border-red-200 bg-red-50 p-2 text-sm text-red-700"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="absolute bottom-3 left-4 right-12 flex items-center gap-2 text-[var(--text-secondary)]">
              <div className="flex h-8 items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] px-2.5">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMode(mode === 'log' ? 'chat' : 'log')}
                  className={cn(
                    "relative h-4 w-8 rounded-full transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-panel)]",
                    mode === 'chat'
                      ? "bg-primary"
                      : "bg-[color-mix(in_srgb,var(--text-primary)_16%,transparent)]"
                  )}
                  role="switch"
                  aria-checked={mode === 'chat'}
                  aria-label="Toggle between log and chat mode"
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-[var(--surface-raised)] shadow-sm transition-transform duration-150 ease-out",
                      mode === 'chat' ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
                <span className="text-[13px] font-normal text-[var(--text-secondary)]">
                  {mode === 'chat' ? 'Chat' : 'Log'}
                </span>
              </div>

              <button
                type="button"
                className={cn(
                  composerActionClass,
                  (isListening || isProcessingVoice) && "text-[var(--text-primary)]"
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={startVoiceRecognition}
                aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
              >
                {isListening ? (
                  <VoiceWaveformMini isActive={isListening} />
                ) : isProcessingVoice ? (
                  <BrailleSpinner className="text-sm text-[var(--text-primary)]" />
                ) : (
                  <AudioLines className="h-[18px] w-[18px] stroke-[1.5]" />
                )}
              </button>

              <button
                type="button"
                className={cn(
                  composerActionClass,
                  isUploadingScreenshot && "text-[var(--text-primary)]"
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleUploadClick}
                disabled={isUploadingScreenshot}
                aria-label="Upload Screen Time screenshot"
              >
                {isUploadingScreenshot ? (
                  <BrailleSpinner className="text-sm text-[var(--text-primary)]" />
                ) : (
                  <Paperclip className="h-4 w-4 stroke-[1.5]" />
                )}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              type="submit"
              disabled={!hasInput || submitButtonLoading}
              className={cn(
                'absolute bottom-3 right-3',
                composerActionClass,
                hasInput && !submitButtonLoading
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)]'
              )}
              aria-label="Submit"
            >
              {submitButtonLoading ? (
                <BrailleSpinner className="text-sm text-[var(--text-primary)]" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
