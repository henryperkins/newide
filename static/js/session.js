/**
 * Enhanced session management with validation and automatic recovery
 */

import { showNotification } from './ui/notificationManager.js';

/**
 * Get current session ID or create a new one if invalid
 * @returns {Promise<string|null>} Valid session ID or null if all attempts fail
 */
export async function getSessionId() {
  // First try to get existing session ID
  let sessionId = sessionStorage.getItem("sessionId");

  // If we have a session ID, validate it without throwing errors
  if (sessionId) {
    try {
      // Validation will return false if the session doesn't exist
      const isValid = await validateSession(sessionId);
      if (isValid) {
        return sessionId;
      }

      console.warn(`[getSessionId] Session ${sessionId} is invalid, creating new session`);
      // Session is invalid, clear it
      sessionStorage.removeItem("sessionId");
    } catch (error) {
      console.error("[getSessionId] Error validating session:", error);
      // Error while validating - clear the session and continue to create a new one
      sessionStorage.removeItem("sessionId");
    }
  }

  // Create a new session if we don't have one or the existing one is invalid
  try {
    const newSessionId = await createNewConversation();
    if (newSessionId) {
      console.log('[getSessionId] Created new session:', newSessionId);
      sessionStorage.setItem("sessionId", newSessionId);
      return newSessionId;
    }
  } catch (error) {
    console.error("[getSessionId] Failed to create new session:", error);
    showNotification("Failed to create a new conversation. Please refresh the page.", "error");
  }

  return null;
}

/**
 * Validate if a session exists on the server
 * @param {string} sessionId - Session ID to validate
 * @returns {Promise<boolean>} True if session is valid
 */
async function validateSession(sessionId) {
  try {
    // Check if the session exists by calling the dedicated session endpoint
    const response = await fetch(
      `${window.location.origin}/api/session?session_id=${encodeURIComponent(sessionId)}`
    );

    if (!response.ok) return false;
    
    const data = await response.json();
    
    // Return true only if we get a successful response with a valid session ID
    return data && data.id === sessionId;
  } catch (error) {
    // Don't throw errors - just return false to indicate invalid session
    console.warn(`[validateSession] Error validating session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Create a new session
 * @param {string} title - Optional conversation title (for backward compatibility)
 * @returns {Promise<string|null>} New session ID or null on failure
 */
export async function createNewConversation(title = "New Conversation", pinned = false, archived = false) {
  try {
    // First, explicitly clear any existing session ID to prevent reuse
    sessionStorage.removeItem("sessionId");

    // Create a new session using the unified session API
    const response = await fetch(`${window.location.origin}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create session: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const newSessionId = data.session_id;

    // Store the new session ID
    sessionStorage.setItem("sessionId", newSessionId);
    
    // Also create an associated conversation with the provided title
    // This ensures backward compatibility with code that expects a conversation
    try {
      await fetch(`${window.location.origin}/api/chat/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: newSessionId,
          title,
          pinned,
          archived
        })
      });
    } catch (convError) {
      console.warn('Failed to create conversation record for session:', convError);
      // Continue anyway as we have a valid session
    }

    return newSessionId;
  } catch (error) {
    console.error('Failed to create session:', error);
    return null;
  }
}

/**
 * Set the last user message in session storage
 * @param {string} message - User message to store
 */
export function setLastUserMessage(message) {
  sessionStorage.setItem('lastUserMessage', message);
}

/**
 * Update the model associated with a session
 * @param {string} sessionId - Session ID to update
 * @param {string} modelName - New model name to set
 * @returns {Promise<boolean>} Success status
 */
export async function switchSessionModel(sessionId, modelName) {
  if (!sessionId || !modelName) {
    console.error('[switchSessionModel] Missing required parameters');
    return false;
  }
  
  try {
    const response = await fetch(`${window.location.origin}/api/session/model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': sessionId
      },
      body: JSON.stringify({ model: modelName })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn(`[switchSessionModel] Failed to update session model: ${response.status}`, errorData);
      return false;
    }
    
    console.log(`[switchSessionModel] Successfully updated session model to ${modelName}`);
    return true;
  } catch (error) {
    console.error('[switchSessionModel] Error updating session model:', error);
    return false;
  }
}

/**
 * Ensure we have a valid session, creating a new one if necessary
 * @returns {Promise<string|null>} Valid session ID or null if all attempts fail
 */
export async function ensureValidSession() {
  // First try to get and validate existing session
  let sessionId = sessionStorage.getItem("sessionId");
  
  if (sessionId) {
    const isValid = await validateSession(sessionId);
    if (isValid) {
      // Refresh the session to extend its validity
      await refreshSession(sessionId);
      return sessionId;
    }
    
    // Clear invalid session
    sessionStorage.removeItem("sessionId");
  }
  
  // Create a new session if needed
  return await createNewConversation();
}

/**
 * Initialize a new session (legacy function kept for compatibility)
 * @returns {Promise<boolean>} Success status
 */
export async function initializeSession() {
  try {
    const sessionId = await createNewConversation();
    if (sessionId) {
      sessionStorage.setItem('sessionId', sessionId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to initialize session:', error);
    return false;
  }
}

/**
 * Refresh the current session to extend its validity
 * @param {string} sessionId - Session ID to refresh
 * @returns {Promise<boolean>} Success status
 */
export async function refreshSession(sessionId) {
  if (!sessionId) return false;
  
  try {
    const response = await fetch(`${window.location.origin}/api/session/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': sessionId
      }
    });
    
    if (!response.ok) {
      console.warn(`[refreshSession] Failed to refresh session ${sessionId}: ${response.status}`);
      return false;
    }
    
    console.log(`[refreshSession] Successfully refreshed session ${sessionId}`);
    return true;
  } catch (error) {
    console.error('[refreshSession] Error refreshing session:', error);
    return false;
  }
}