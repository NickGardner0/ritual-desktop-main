export type ModelEngineTextPart = {
  type: 'text';
  text: string;
};

export type ModelEngineImagePart = {
  type: 'image_url';
  imageUrl: string;
  detail?: 'auto' | 'low' | 'high';
};

export type ModelEngineContent = string | Array<ModelEngineTextPart | ModelEngineImagePart> | null;

export type ModelEngineToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ModelEngineMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ModelEngineContent;
  toolCallId?: string;
  toolCalls?: ModelEngineToolCall[];
};

export type ModelEngineTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ModelEngineToolChoice =
  | 'auto'
  | 'none'
  | { type: 'function'; function: { name: string } };

export type ModelEngineInput = {
  model: string;
  messages: ModelEngineMessage[];
  tools?: ModelEngineTool[];
  toolChoice?: ModelEngineToolChoice;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object';
  signal?: AbortSignal;
};

export type ModelEngineEvent =
  | { type: 'text_delta'; text: string }
  | {
      type: 'tool_call_delta';
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: 'done'; finishReason?: string | null };

export interface ModelEngineAdapter {
  stream(input: ModelEngineInput): AsyncIterable<ModelEngineEvent>;
}

export type ModelEngineResponse = {
  content: string | null;
  toolCalls: ModelEngineToolCall[];
};
