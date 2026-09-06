type ToolPart = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  label?: string;
};

type PermissionAsk = {
  id: string;
  name: string;
  scope: string;
  profile: string;
  protocol?: 'legacy' | 'agent';
  sessionId?: string;
  askSeq?: number;
} | null;

type AgentApprovalHandler = (decision: 'allow' | 'deny' | 'always_allow', askSeq: number) => void;

type ChatSessionUiState = {
  toolParts: ToolPart[];
  permissionAsk: PermissionAsk;
  authToken: string | null;
  agentApprove: AgentApprovalHandler | null;
};

const listeners = new Set<() => void>();
let state: ChatSessionUiState = { toolParts: [], permissionAsk: null, authToken: null, agentApprove: null };

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeChatSessionUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getChatSessionUi(): ChatSessionUiState {
  return state;
}

export function resetChatSessionUi(): void {
  state = { toolParts: [], permissionAsk: null, authToken: state.authToken, agentApprove: state.agentApprove };
  emit();
}

export function setChatAuthToken(authToken: string | null): void {
  state = { ...state, authToken };
}

export function upsertChatToolPart(part: ToolPart): void {
  const existing = state.toolParts.findIndex((item) => item.id === part.id);
  const toolParts = existing >= 0
    ? state.toolParts.map((item, index) => (index === existing ? { ...item, ...part } : item))
    : [...state.toolParts, part];
  state = { ...state, toolParts };
  emit();
}

export function setChatPermissionAsk(permissionAsk: PermissionAsk): void {
  state = { ...state, permissionAsk };
  emit();
}

export function setAgentApprovalHandler(agentApprove: AgentApprovalHandler | null): void {
  state = { ...state, agentApprove };
}

export function useChatSessionUiSnapshot(): ChatSessionUiState {
  return state;
}

export type { ToolPart, PermissionAsk, ChatSessionUiState, AgentApprovalHandler };
