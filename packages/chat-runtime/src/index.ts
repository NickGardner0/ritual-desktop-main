export {
  handleChatStreamRequest,
  type ChatStreamRequestBody,
  type ChatStreamRequestContext,
} from './handle-chat-stream.js';

export {
  handleSmsChatPost,
  handleSmsProactivePost,
  splitSmsSegments,
  handleSmsChatPost as handleSmsChatRequest,
  handleSmsProactivePost as handleSmsProactiveRequest,
  type SmsChatRequest,
  type SmsProactiveRequest,
  type SmsChatResponse,
} from './sms.js';

export * from './executors/index.js';
export * from './narrative/index.js';
export * from './assistant-turn.js';
export {
  AssistantKernel,
  AssistantSessionBusyError,
  AssistantTurnRun,
  AssistantTurnConflictError,
  STALE_IN_FLIGHT_MS,
  defaultAssistantKernel,
  isInFlightTurnStatus,
  isStaleInFlightTurn,
} from './assistant-kernel.js';
export type { AssistantTurnRunOutcome } from './assistant-kernel.js';
export {
  DurableAssistantTurnStore,
  HttpAssistantTurnStore,
  MemoryAssistantTurnStore,
  getAssistantTurnStore,
  setAssistantTurnStoreForTests,
} from './assistant-turn-store.js';
export { planToolBatch, executeDeclaredToolCalls, mapInBatchMode } from './tool-batch.js';
export { tools } from './tools.js';
export * from './tool-registry.js';
export * from './weekly-overview-utils.js';
export {
  createChatStreamResponse,
  formatPhaseLine,
  formatPermissionLine,
  formatToolLine,
  labelForChatPhase,
  parsePhaseLine,
  parsePermissionLine,
  parseToolLine,
  PHASE_LABELS,
} from './stream-response.js';
export {
  compactApiMessages,
  isDoomLoop,
  pruneBulkyToolResult,
  toolBatchSignature,
} from './session-drain.js';
export {
  ACTION_PROFILES,
  draftToolResult,
  isActionProfile,
  isUserPermissionChoice,
  permissionScopeKey,
  rememberAlways,
  resetPermissionStateForTests,
  resolveToolPermission,
  submitPermissionDecision,
  waitForPermission,
} from './action-permission.js';
export { startChatRuntimeSidecar } from './sidecar.js';
export {
  classifyModelEngineError,
  collectModelEngineResponse,
  defaultModelEngine,
  ModelEngineError,
  OpenAIModelEngineAdapter,
  setOpenAIClientForTests,
} from './model-engine/index.js';
export type {
  ModelEngineAdapter,
  ModelEngineEvent,
  ModelEngineInput,
  ModelEngineMessage,
  ModelEngineResponse,
  ModelEngineToolCall,
} from './model-engine/index.js';
