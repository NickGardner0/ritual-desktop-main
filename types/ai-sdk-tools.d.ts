/**
 * Type declarations for ai-sdk-tools packages
 */

declare module '@ai-sdk-tools/agents' {
  import type { LanguageModel, Tool, UIMessage } from 'ai';
  
  export interface AgentConfig<TContext extends Record<string, unknown> = Record<string, unknown>> {
    name: string;
    model: LanguageModel;
    instructions: string | ((context: TContext) => string);
    tools?: Record<string, Tool> | ((context: TContext) => Record<string, Tool>);
    handoffs?: Array<Agent<any>>;
    maxTurns?: number;
    temperature?: number;
    modelSettings?: Record<string, unknown>;
    matchOn?: (string | RegExp)[] | ((message: string) => boolean);
    memory?: any;
  }

  export interface AgentStreamOptionsUI {
    message: UIMessage;
    strategy?: 'auto' | 'manual';
    maxRounds?: number;
    maxSteps?: number;
    context?: Record<string, unknown>;
    agentChoice?: string;
    toolChoice?: string;
    experimental_transform?: any;
    sendReasoning?: boolean;
    sendSources?: boolean;
    sendFinish?: boolean;
    sendStart?: boolean;
    beforeStream?: (options: { writer: any }) => boolean | Promise<boolean>;
    onEvent?: (event: any) => void | Promise<void>;
    onFinish?: (event: any) => void | Promise<void>;
    onError?: (error: any) => void | Promise<void>;
    generateId?: () => string;
    messageMetadata?: any;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  }

  export class Agent<TContext extends Record<string, unknown> = Record<string, unknown>> {
    constructor(config: AgentConfig<TContext>);
    name: string;
    toUIMessageStream(options: AgentStreamOptionsUI): Response;
    stream(options: any): any;
    generate(options: any): Promise<any>;
    getHandoffs(): Array<Agent<any>>;
  }
}

declare module '@ai-sdk-tools/store' {
  export function useChat(options?: any): any;
  export function useChatStoreApi<T = any>(): any;
}

