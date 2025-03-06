export async function getSessionId() {
  let sessionId = sessionStorage.getItem("sessionId");
  if (!sessionId) {
    try {
      const response = await fetch(`${window.location.origin}/api/chat/conversations`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: "New Conversation",
          pinned: false,
          archived: false
        })
      });
      if (!response.ok) throw new Error("Failed to create conversation");
      const data = await response.json();
      sessionId = data.conversation_id;
      sessionStorage.setItem("sessionId", sessionId);
    } catch (error) {
      console.error("Failed to create conversation:", error);
      return null;
    }
  }

  console.log('[getSessionId] Current conversation ID:', sessionId);

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(sessionId)) {
    console.error('[getSessionId] Invalid UUID format:', sessionId);
    // Attempt to create a new conversation if the ID is invalid
    try {
      console.log('[getSessionId] Attempting to create a new conversation...');
      const response = await fetch(`${window.location.origin}/api/chat/conversations`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: "New Conversation",
          pinned: false,
          archived: false
        })
      });
      if (!response.ok) throw new Error("Failed to create conversation");
      const data = await response.json();
      sessionId = data.conversation_id;
      sessionStorage.setItem("sessionId", sessionId);
      console.log('[getSessionId] Created new conversation ID:', sessionId);
    } catch (error) {
      console.error("[getSessionId] Failed to create new conversation:", error);
      return null;
    }
  }

  return sessionId;
}

export function setLastUserMessage(message) {
  sessionStorage.setItem('lastUserMessage', message);
}

export async function initializeSession() {
  try {
    const response = await fetch(`${window.location.origin}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: "New Conversation",
        pinned: false,
        archived: false
      })
    });
    if (!response.ok) throw new Error('Failed to create conversation');
    const data = await response.json();
    sessionStorage.setItem('sessionId', data.conversation_id);
    return true;
  } catch (error) {
    console.error('Failed to create conversation:', error);
    return false;
  }
}

export async function createNewConversation(title = "New Conversation", pinned = false, archived = false) {
  try {
    const response = await fetch(`${window.location.origin}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        pinned,
        archived
      })
    });
    if (!response.ok) throw new Error('Failed to create conversation');
    const data = await response.json();
    sessionStorage.setItem('sessionId', data.conversation_id);
    return data.conversation_id;
  } catch (error) {
    console.error('Failed to create conversation:', error);
    return null;
  }
}