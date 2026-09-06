'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, AudioLines, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { VoiceWaveform, VoiceWaveformMini } from '@/components/voice-waveform';
import { HabitCanvas } from '@/components/chat/habit-canvas';
import { ViewModeToggle } from '@/components/analytics/view-mode-toggle';
import {
  SidebarToggleIcon,
  cn,
} from './chat-client.shared';
import { ChatMessageList } from './chat-message-list';
import { ChatComposerEntityExtras } from './chat-composer-entity-extras';
import type { ChatLayoutContext } from './chat-client.layout.types';

export function buildRenderActiveChat(ctx: ChatLayoutContext) {
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
    messages,
    openIntegrationsPage,
    partialTranscript,
    pendingFacts,
    queueAutoRun,
    queueItems,
    queuePrompt,
    router,
    runQueuedItem,
    cancelQueuedItem,
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
                          "flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-[1.25rem] ritual-snappy-row",
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
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-[#e5e5e5] hover:text-gray-600"
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

  function renderActiveChat() {
    return (
    <>
      {headerNavigation}
      {renderConversationContextMenu()}
      <div className="h-full w-full min-w-0 flex bg-white relative overflow-hidden">
      {renderConversationSidebar()}
      {renderCollapsedSidebarToggle()}

      {/* Chat Area */}
      <div className={cn(
        "flex-1 min-w-0 overflow-x-hidden flex flex-col transition-[padding] duration-200 ease-out",
        canvasData ? "pr-0" : ""
      )}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

          {/* Chat content - centered in available space */}
          <div className={cn(
            "pb-32 min-w-0 transition-[max-width] duration-200 mx-auto px-8 pt-8",
            canvasData ? "w-full max-w-none" : "max-w-[680px]"
          )}>
            <ChatMessageList
              canvasData={canvasData}
              conversationId={conversationId}
              isLoading={isLoading}
              latestUserMessageRef={latestUserMessageRef}
              messages={messages}
              queuePrompt={queuePrompt}
              scrollRef={scrollRef}
              sendMessage={sendMessage}
              setInput={setInput}
              streamingContent={streamingContent}
              toolStatus={toolStatus}
              voiceStyleEnabled={voiceStyleEnabled}
            />
          </div>
        </div>

        {/* Input */}
        <div className="sticky bottom-0 left-0 right-0 pb-6 pt-4 bg-gradient-to-t from-white/80 to-transparent backdrop-blur-lg">
          <div className={cn(
            "mx-auto px-8 transition-[max-width] duration-200",
            canvasData ? "w-full max-w-none" : "max-w-[680px]"
          )}>
            <form onSubmit={handleSubmit}>
                <div className="bg-[rgba(247,247,247,0.85)] backdrop-blur-lg border border-gray-200/80 shadow-sm overflow-hidden transition-shadow">
                  <div className="px-4 py-3">
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
                  {/* Voice Input */}
                  <div className="flex items-center gap-3">
                    {/* Voice Recording Button */}
                    <div className="flex items-center gap-2 group">
                      <button
                        type="button"
                        onClick={startVoiceRecognition}
                        disabled={isLoading}
                        className={cn(
                          "w-8 h-8 flex items-center justify-center",
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
                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors hover:bg-[#27251E] disabled:cursor-not-allowed"
                    >
                      <ArrowUp className={cn("w-4 h-4", isLoading && "opacity-70")} />
                    </button>
                  </div>
                </div>
              </div>
            </form>
            {conversationId ? (
              <div className="mt-3 rounded-sm border border-gray-200/80 bg-[rgba(247,247,247,0.72)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-medium text-[#2f2c25]">Queued next steps</div>
                    <div className="text-[11px] text-gray-500">Persisted follow-ups for this conversation.</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500">
                      <span>Auto-run</span>
                      <Switch checked={queueAutoRun} onCheckedChange={setQueueAutoRun} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsQueueOpen((current: boolean) => !current)}
                      className="text-[11px] text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
                    >
                      {isQueueOpen ? 'Hide queue' : 'Show queue'}
                    </button>
                  </div>
                </div>
                {isQueueOpen ? (
                  <div className="mt-3 space-y-2">
                    {queueItems.length ? queueItems.map((item: any) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] text-[#2f2c25]">{item.prompt_text}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-gray-400">{item.status}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.status === 'pending' ? (
                            <button
                              type="button"
                              onClick={() => void runQueuedItem(item.id)}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                            >
                              Run
                            </button>
                          ) : null}
                          {item.status === 'pending' ? (
                            <button
                              type="button"
                              onClick={() => void cancelQueuedItem(item.id)}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-[12px] text-gray-500">
                        No queued follow-ups yet.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Sheet open={isMemoryOpen} onOpenChange={setIsMemoryOpen}>
        <SheetContent side="right" className="w-full max-w-[460px] overflow-y-auto bg-[#fbfcff] px-6 py-6">
          <SheetHeader>
            <SheetTitle>Memory &amp; Rules</SheetTitle>
            <SheetDescription>
              Approved facts shape future prompts. Pending suggestions stay inactive until you approve them.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-5">
            <section className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Pending</div>
              <div className="mt-3 space-y-3">
                {pendingFacts.length ? pendingFacts.map((fact: any) => (
                  <div key={fact.id} className="rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-3">
                    <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                    <pre className="mt-2 overflow-auto rounded-[14px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" onClick={() => void dismissFact(fact.id)}>Dismiss</Button>
                      <Button className="bg-[#111827] text-white hover:bg-[#1f2937]" onClick={() => void approveFact(fact.id)}>Approve</Button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[18px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-3 py-5 text-sm text-[#6b7280]">
                    No pending memory suggestions.
                  </div>
                )}
              </div>
            </section>
            <section className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Approved</div>
              <div className="mt-3 space-y-3">
                {activeFacts.map((fact: any) => (
                  <div key={fact.id} className="rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-3">
                    <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                    <pre className="mt-2 overflow-auto rounded-[14px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* Canvas Side Panel */}
      <AnimatePresence>
        {canvasData && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: effectiveCanvasWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="relative flex shrink-0 overflow-hidden will-change-transform"
          >
            <div
              onMouseDown={handleCanvasResizeStart}
              className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1 cursor-col-resize"
              aria-label="Resize side panel"
              role="separator"
              aria-orientation="vertical"
            >
              <div className={cn(
                "mx-auto h-full w-px transition-colors",
                isResizingCanvas ? "bg-gray-400" : "bg-gray-200 hover:bg-gray-300",
              )} />
            </div>

            <div className="w-full overflow-hidden">
              <HabitCanvas 
                data={canvasData} 
                onClose={() => setCanvasData(null)} 
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </>
  );
  }

  return renderActiveChat;
}
