/**
 * Conversation persistence helpers (create, save messages).
 *
 * Used by the orchestrator for fire-and-forget message persistence.
 */

const PYTHON_API_BASE = process.env.PYTHON_API_URL || process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export async function createConversation(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (response.ok) {
      const data = await response.json();
      console.log('💬 Created new conversation:', data.id);
      return data.id;
    }
    console.error('❌ Failed to create conversation:', await response.text());
    return null;
  } catch (error) {
    console.error('❌ Error creating conversation:', error);
    return null;
  }
}

export async function saveMessage(
  token: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  toolPayload?: Record<string, unknown> | null
): Promise<boolean> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        content,
        tool_payload: toolPayload || null,
      }),
    });
    if (response.ok) {
      console.log(`💾 Saved ${role} message to conversation ${conversationId}`);
      return true;
    }
    console.error('❌ Failed to save message:', await response.text());
    return false;
  } catch (error) {
    console.error('❌ Error saving message:', error);
    return false;
  }
}

export async function getPromptFacts(token: string): Promise<Array<Record<string, unknown>>> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/ai-facts?status=active`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.items) ? data.items.filter((item: any) => item?.visibility === 'prompt' || item?.visibility === 'ui') : [];
  } catch (error) {
    console.error('❌ Error loading prompt facts:', error);
    return [];
  }
}

export async function createFactSuggestions(
  token: string,
  suggestions: Array<Record<string, unknown>>,
): Promise<void> {
  if (!suggestions.length) return;
  try {
    await Promise.all(
      suggestions.map((suggestion) =>
        fetch(`${PYTHON_API_BASE}/api/ai-facts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...suggestion,
            status: 'pending',
            source_type: suggestion.source_type || 'assistant',
          }),
        }).catch((error) => {
          console.error('❌ Error storing fact suggestion:', error);
        }),
      ),
    );
  } catch (error) {
    console.error('❌ Error storing fact suggestions:', error);
  }
}
