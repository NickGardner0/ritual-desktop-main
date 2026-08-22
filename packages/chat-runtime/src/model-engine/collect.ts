import type {
  ModelEngineAdapter,
  ModelEngineInput,
  ModelEngineResponse,
  ModelEngineToolCall,
} from './types.js';

export async function collectModelEngineResponse(
  adapter: ModelEngineAdapter,
  input: ModelEngineInput,
): Promise<ModelEngineResponse> {
  let content = '';
  const calls = new Map<number, ModelEngineToolCall>();
  for await (const event of adapter.stream(input)) {
    if (event.type === 'text_delta') {
      content += event.text;
    } else if (event.type === 'tool_call_delta') {
      const call = calls.get(event.index) || { id: '', name: '', arguments: '' };
      if (event.id) call.id = event.id;
      if (event.name) call.name += event.name;
      if (event.arguments) call.arguments += event.arguments;
      calls.set(event.index, call);
    }
  }
  return {
    content: content || null,
    toolCalls: Array.from(calls.entries())
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call),
  };
}
