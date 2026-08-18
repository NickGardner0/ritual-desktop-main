'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, AudioLines, Check, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { VoiceWaveform, VoiceWaveformMini } from '@/components/voice-waveform';
import { HabitCanvas } from '@/components/chat/habit-canvas';
import { ViewModeToggle } from '@/components/analytics/view-mode-toggle';
import {
  CHAT_PAGE_CARD_BG,
  ConnectAppsBar,
  Response,
  SidebarToggleIcon,
  TextShimmer,
  cleanContentForDisplay,
  cn,
} from './chat-client.shared';


import { buildRenderActiveChat } from './chat-client.layout.active';
import { ChatComposerEntityExtras } from './chat-composer-entity-extras';

import type { ChatLayoutContext } from './chat-client.layout.types';

export type { ChatLayoutContext };

export function createChatLayoutRenderers(ctx: Record<string, any>) {
  const {
    activeFacts,
    approveFact,
    audioStream,
    canvasData,
    conversationContextMenu,
    conversationId,
    conversations,
    copyShareImage,
    currentQuestion,
    deleteConversation,
    dismissConnectAppsBar,
    dismissFact,
    effectiveCanvasWidth,
    greeting,
    handleCanvasResizeStart,
    handleConversationContextDelete,
    handleInputBlur,
    handleInputFocus,
    handleKeyDown,
    handleSubmit,
    handleViewChange,
    headerCenterSlot,
    headerLeftSlot,
    input,
    attachedEntityRefs,
    setAttachedEntityRefs,
    isListening,
    isLoading,
    isLoadingConversations,
    isMemoryOpen,
    isProcessingVoice,
    isQueueOpen,
    isResizingCanvas,
    isSidebarCollapsed,
    latestUserMessageRef,
    loadQueueItems,
    messages,
    openIntegrationsPage,
    partialTranscript,
    pendingFacts,
    queueAutoRun,
    queueItems,
    queuePrompt,
    router,
    runQueuedItem,
    scrollRef,
    sendMessage,
    setCanvasData,
    setInput,
    setIsMemoryOpen,
    setIsQueueOpen,
    setIsSidebarCollapsed,
    setKeyboardSuggestionActive,
    setQueueAutoRun,
    setSelectedSuggestionIndex,
    showConnectAppsBar,
    showConversationContextMenu,
    startNewConversation,
    startVoiceRecognition,
    streamingContent,
    suggestionList,
    switchConversation,
    textareaRef,
    toolStatus,
    voiceStyleEnabled,
  } = ctx;

  function renderLoadingConversation() {
    return (
      <div className="h-full flex flex-col bg-[var(--content-bg)] relative">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <BrailleSpinner className="text-base text-gray-400" />
            <span className="text-gray-500 text-sm">Loading conversation...</span>
          </div>
        </div>
      </div>
    );
  }

  function renderPendingFirstMessage() {
    return (
      <div className="h-full w-full min-w-0 flex bg-[var(--content-bg)] relative overflow-hidden">
        {renderCollapsedSidebarToggle()}

        <div className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="max-w-[680px] mx-auto px-8 pt-8 pb-32">
              <h1 className="text-2xl font-medium text-gray-900 leading-snug mb-6">
                {currentQuestion}
              </h1>
              {toolStatus && (
                <div className="flex items-center gap-2 py-2">
                  {toolStatus.done ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-sm text-neutral-500">{toolStatus.label.replace('...', '')}</span>
                    </>
                  ) : (
                    <TextShimmer className="text-sm" duration={0.75}>
                      {toolStatus.label}
                    </TextShimmer>
                  )}
                </div>
              )}
              {!toolStatus && isLoading && (
                <div className="flex items-center gap-2 py-2">
                  <TextShimmer className="text-sm" duration={1.5}>
                    {'Thinking...'}
                  </TextShimmer>
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 left-0 right-0 pb-6 pt-4 bg-gradient-to-t from-[rgba(252,252,252,0.86)] to-transparent backdrop-blur-lg">
            <div className="max-w-[680px] mx-auto px-8">
              <form onSubmit={handleSubmit}>
                <div className="bg-[rgba(247,247,247,0.85)] backdrop-blur-lg border border-gray-200/80 shadow-sm overflow-hidden transition-shadow">
                  <div className="px-4 py-2.5">
                    <textarea
                      ref={textareaRef}
                      value={isListening && partialTranscript ? partialTranscript : input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setSelectedSuggestionIndex(0);
                        setKeyboardSuggestionActive(false);
                      }}
                      onKeyDown={handleKeyDown}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      placeholder={isListening ? 'Listening...' : 'Ask a follow-up question...'}
                      className="w-full resize-none border-0 outline-none text-[15px] text-gray-900 placeholder-gray-400 bg-transparent min-h-[22px] max-h-[96px]"
                      rows={1}
                      disabled={isLoading}
                      readOnly={isListening}
                    />
                    <ChatComposerEntityExtras
                      input={input}
                      attached={attachedEntityRefs || []}
                      onAttachedChange={setAttachedEntityRefs}
                      onInputChange={(value) => {
                        setInput(value);
                        setSelectedSuggestionIndex(0);
                        setKeyboardSuggestionActive(false);
                      }}
                    />
                  </div>
                  <div className="px-4">
                    {suggestionList}
                  </div>
                  {isListening && (
                    <div className="px-4 pb-1 flex flex-col items-center gap-1">
                      <div className="h-8 w-full max-w-[280px]">
                        <VoiceWaveform isActive={isListening} audioStream={audioStream} sensitivity={2.9} barWidth={4} barGap={2} />
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-3 pb-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 group">
                        <button
                          type="button"
                          onClick={startVoiceRecognition}
                          disabled={isLoading}
                          className={cn(
                            "w-8 h-8 flex items-center justify-center transition-all duration-200",
                            isListening || isProcessingVoice
                              ? "text-gray-900"
                              : "text-gray-400 hover:text-gray-600",
                            "disabled:opacity-50"
                          )}
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
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (input.trim()) {
                            void queuePrompt(input.trim(), 'manual');
                          } else {
                            setIsQueueOpen((current: boolean) => !current);
                          }
                        }}
                        disabled={!conversationId}
                        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
                      >
                        {input.trim() ? 'Queue prompt' : `Queue (${queueItems.filter((item: any) => item.status === 'pending').length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsMemoryOpen(true)}
                        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                      >
                        Memory ({pendingFacts.length})
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors hover:bg-[#27251E] disabled:cursor-not-allowed"
                    >
                      <ArrowUp className={cn("w-4 h-4", isLoading && "opacity-70")} />
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const headerNavigation = headerCenterSlot
    ? createPortal(
        <ViewModeToggle currentView="chat" onViewChange={handleViewChange} />,
        headerCenterSlot,
      )
    : null;

  const renderConversationSidebar = () => (
    <AnimatePresence>
      {!isSidebarCollapsed && (
        <motion.aside
          initial={{ x: -18, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -18, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="h-full w-[272px] shrink-0 border-r border-[rgba(15,23,42,0.045)] flex flex-col overflow-hidden bg-[#f4f4f3] shadow-[inset_-1px_0_0_rgba(15,23,42,0.02)] will-change-transform"
        >
          <div className="px-3 pt-1.5 pb-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex items-center gap-2 text-[#2f2c25] transition-opacity hover:opacity-75"
                title="Go to Dashboard"
              >
                <img src="/images/eclipse.svg" alt="Ritual" className="h-5 w-5 opacity-90" />
              </button>
              <button
                onClick={() => setIsSidebarCollapsed(true)}
                className="flex h-8 w-8 items-center justify-center text-[rgb(95,98,102)] transition-colors hover:text-[#2f2c25]"
                title="Collapse sidebar"
              >
                <SidebarToggleIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2">
              <button
                onClick={startNewConversation}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-[#3d392f] transition-colors hover:border-gray-300"
                title="New Chat"
                aria-label="New Chat"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New chat</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2.5 pb-3">
            <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-400">
              Recent chats
            </div>
            <div className="flex flex-col gap-px">
              {isLoadingConversations ? (
                <div className="flex items-center justify-center py-6">
                  <BrailleSpinner className="text-sm text-gray-400" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center text-xs text-gray-400">
                  No conversations yet
                </div>
              ) : (
                conversations.slice(0, 10).map((conv: any) => {
                  const displayTitle = conv.first_message || conv.title || 'New conversation';
                  const truncatedTitle =
                    displayTitle.length > 36 ? `${displayTitle.substring(0, 36)}...` : displayTitle;

                  return (
                    <div
                      key={conv.id}
                      className="group flex items-center gap-1 rounded-md"
                      onContextMenu={(e) => showConversationContextMenu(conv.id, e)}
                    >
                      <button
                        onClick={() => switchConversation(conv.id)}
                        className={cn(
                          "flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-[1.25rem] transition-colors",
                          conv.id === conversationId
                            ? "bg-white text-[#232119] shadow-[0_0_0_1px_rgba(15,23,42,0.03)]"
                            : "text-[#605b51] hover:bg-[#e5e5e5] hover:text-[#2f2c25]"
                        )}
                        title={displayTitle}
                      >
                        <span className="block truncate">{truncatedTitle}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-[#e5e5e5] hover:text-gray-600"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );

  function renderCollapsedSidebarToggle() {
    return isSidebarCollapsed && headerLeftSlot
      ? createPortal(
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          className="fixed left-[82px] top-[3px] z-[60] flex h-5 w-5 items-center justify-center text-[rgb(95,98,102)] transition-colors hover:text-[#2f2c25]"
          title="Expand sidebar"
        >
          <SidebarToggleIcon className="h-4 w-4" />
        </button>
        ,
        headerLeftSlot,
      )
      : null;
  }

  function renderConversationContextMenu() {
    if (!conversationContextMenu || typeof document === 'undefined') {
      return null;
    }

    const left = Math.min(conversationContextMenu.x, Math.max(12, window.innerWidth - 172));
    const top = Math.min(conversationContextMenu.y, Math.max(12, window.innerHeight - 72));

    return createPortal(
      <div className="fixed inset-0 z-[120]">
        <div className="absolute inset-0" />
        <div
          className="absolute min-w-[160px] rounded-md border border-[rgba(15,23,42,0.08)] bg-white p-1 shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
          style={{ left, top }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={handleConversationContextDelete}
            className="flex w-full items-center rounded-md px-3 py-2 text-left text-[13px] text-[#2f2c25] ritual-snappy-row"
          >
            Delete conversation
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  function renderEmptyChat() {
    return (
      <>
        {headerNavigation}
        {renderConversationContextMenu()}
        <div className="h-full flex bg-white relative overflow-x-hidden">
        {renderConversationSidebar()}
        {renderCollapsedSidebarToggle()}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">

          <div className="flex-1 flex flex-col items-center justify-center p-6 pb-24">
            <div className="max-w-2xl w-full space-y-4">
              {/* Logo + Greeting */}
              <div className="flex flex-col items-center gap-2 mb-1">
                <div className="relative flex h-12 w-12 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(15,23,42,0.08)_0%,rgba(15,23,42,0)_72%)] blur-sm" />
                  <img
                    src="/images/eclipse.svg"
                    alt="Ritual"
                    className="relative h-8 w-8 opacity-70 saturate-[0.8]"
                  />
                </div>
                <h1 className="text-[26px] font-normal text-gray-900 tracking-tight">
                  Welcome to Ritual
                </h1>
              </div>

              {/* Input — clean rounded card */}
              <form onSubmit={handleSubmit} className="relative">
                <div
                  className="border border-gray-300 rounded-sm overflow-hidden transition-shadow focus-within:shadow-md focus-within:border-gray-400/80"
                  style={{ backgroundColor: CHAT_PAGE_CARD_BG }}
                >
                  <textarea
                    ref={textareaRef}
                    value={isListening && partialTranscript ? partialTranscript : input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setSelectedSuggestionIndex(0);
                      setKeyboardSuggestionActive(false);
                    }}
                    onKeyDown={handleKeyDown}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    placeholder={isListening ? 'Listening...' : 'Ask about your personal data'}
                    className="w-full resize-none border-0 outline-none text-[15px] text-gray-900 placeholder-gray-400 bg-transparent px-5 pt-3 pb-1.5 min-h-[48px] max-h-[96px]"
                    rows={1}
                    readOnly={isListening}
                  />
                  <ChatComposerEntityExtras
                    input={input}
                    attached={attachedEntityRefs || []}
                    onAttachedChange={setAttachedEntityRefs}
                    onInputChange={(value) => {
                      setInput(value);
                      setSelectedSuggestionIndex(0);
                      setKeyboardSuggestionActive(false);
                    }}
                  />
                  <div className="px-5">
                    {suggestionList}
                  </div>
                  {isListening && (
                    <div className="px-5 pb-1 flex justify-center">
                      <div className="h-8 w-full max-w-[280px]">
                        <VoiceWaveform isActive={isListening} audioStream={audioStream} sensitivity={2.9} barWidth={4} barGap={2} />
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 pb-2.5">
                    {/* Voice Input */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={startVoiceRecognition}
                        className={cn(
                          "w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200",
                          isListening || isProcessingVoice
                            ? "text-gray-900"
                            : "text-gray-400 hover:text-gray-600 hover:bg-gray-200/50"
                        )}
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
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsMemoryOpen(true)}
                        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                      >
                        Memory
                      </button>
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors hover:bg-[#27251E] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  </div>
                  {showConnectAppsBar ? (
                    <ConnectAppsBar
                      onOpenIntegrations={openIntegrationsPage}
                      onDismiss={dismissConnectAppsBar}
                    />
                  ) : null}
                </div>
              </form>

            </div>
          </div>
        </div>
        </div>
      </>
    );
  }


  const renderActiveChat = buildRenderActiveChat(ctx);

  return {
    renderLoadingConversation,
    renderPendingFirstMessage,
    renderEmptyChat,
    renderActiveChat,
  };
}
