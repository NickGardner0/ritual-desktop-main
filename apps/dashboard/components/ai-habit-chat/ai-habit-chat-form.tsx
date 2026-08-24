'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Download,
  FileUp,
  Plus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
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
  onImportData: () => void;
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
    onImportData, handleFileChange, handleCancelScreenshot, handleConfirmScreenshot, adjustEditedValue,
  } = props;

  const hasInput = input.trim().length > 0;
  const hasExtraInput = input.length > 120 || input.includes('\n');
  const hasSuggestionContent = visibleInlineOptions.length > 0 || clarifications.length > 0;
  const composerHeightClass = showSuggestions && hasSuggestionContent
    ? 'h-[184px]'
    : error
      ? 'h-[132px]'
      : hasExtraInput
        ? 'h-[124px]'
        : 'h-[104px]';
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
          'relative mx-auto w-full max-w-[660px] overflow-hidden rounded-[12px] bg-[var(--surface-panel)]',
          composerHeightClass
        )}
      >
        <form onSubmit={handleFormSubmit} className="h-full">
          <div className="relative h-full">
            <div className="absolute inset-x-0 top-0 px-4 pt-3">
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
                    "min-h-[36px] max-h-[64px] px-1 py-0.5 text-[15px] leading-5"
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

            <div className="absolute bottom-2.5 left-4 right-24 flex items-center gap-2 text-[var(--text-secondary)]">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      composerActionClass,
                      "data-[state=open]:bg-[color-mix(in_srgb,var(--text-primary)_11%,transparent)] data-[state=open]:text-[var(--text-primary)]"
                    )}
                    aria-label="Add an attachment or import data"
                    title="Add"
                  >
                    <Plus className="h-[18px] w-[18px] stroke-[1.5]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="top"
                  sideOffset={8}
                  collisionPadding={12}
                  className="w-44"
                  aria-label="Add to composer"
                >
                  <DropdownMenuItem
                    onSelect={handleUploadClick}
                    disabled={isUploadingScreenshot}
                  >
                    <FileUp className="h-4 w-4 text-[var(--icon-default)]" strokeWidth={1.75} />
                    <span>Attach file</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onImportData}>
                    <Download className="h-4 w-4 text-[var(--icon-default)]" strokeWidth={1.75} />
                    <span>Import data</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div
                role="group"
                aria-label="Composer mode"
                className="inline-flex h-8 items-center rounded-full bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] p-0.5"
              >
                {(['log', 'chat'] as const).map((nextMode) => {
                  const isActive = mode === nextMode;
                  return (
                    <button
                      key={nextMode}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        setMode(nextMode);
                        setClarifications([]);
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-full border px-3.5 text-[13px] font-normal transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-panel)]',
                        isActive
                          ? 'border-[var(--border-floating)] bg-[var(--surface-raised)] text-[var(--text-primary)]'
                          : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                      )}
                    >
                      {nextMode === 'log' ? 'Log' : 'Chat'}
                    </button>
                  );
                })}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="absolute bottom-2.5 right-3 flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  composerActionClass,
                  (isListening || isProcessingVoice) && "text-[var(--text-primary)]"
                )}
                onMouseDown={(event) => event.preventDefault()}
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
                type="submit"
                disabled={!hasInput || submitButtonLoading}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--surface-raised)] transition-none hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-panel)] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Submit"
              >
                {submitButtonLoading ? (
                  <BrailleSpinner className="text-sm text-[var(--surface-raised)]" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
