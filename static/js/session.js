export async function getSessionId() {
  let sessionId = sessionStorage.getItem("sessionId");
  if (!sessionId) {
    try {
      const response = await fetch(`${window.location.origin}/api/session/create`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to create session");
      const data = await response.json();
      sessionId = data.session_id;
      sessionStorage.setItem("sessionId", sessionId);
    } catch (error) {
      console.error("Failed to create session:", error);
      return null;
    }
  }

  console.log('[getSessionId] Current session ID:', sessionId);

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(sessionId)) {
    console.error('[getSessionId] Invalid UUID format:', sessionId);
    // Attempt to create a new session if the ID is invalid
    try {
      console.log('[getSessionId] Attempting to create a new session...');
      const response = await fetch(`${window.location.origin}/api/session/create`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to create session");
      const data = await response.json();
      sessionId = data.session_id;
      sessionStorage.setItem("sessionId", sessionId);
      console.log('[getSessionId] Created new session ID:', sessionId);
    } catch (error) {
      console.error("[getSessionId] Failed to create new session:", error);
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
    const response = await fetch(`${window.location.origin}/api/session/create`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to create session');
    const data = await response.json();
    sessionStorage.setItem('sessionId', data.session_id);
    return true;
  } catch (error) {
    console.error('Failed to create session:', error);
    return false;
  }
}
