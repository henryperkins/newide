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
    // Check if the session exists by trying to fetch the first message
    const response = await fetch(
      `${window.location.origin}/api/chat/conversations/${sessionId}/messages?limit=1`
    );

    // Return true only if we get a successful response
    return response.ok;
  } catch (error) {
    // Don't throw errors - just return false to indicate invalid session
    console.warn(`[validateSession] Error validating session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Create a new conversation session
 * @param {string} title - Optional conversation title
 * @returns {Promise<string|null>} New session ID or null on failure
 */
export async function createNewConversation(title = "New Conversation", pinned = false, archived = false) {
  try {
    // First, explicitly clear any existing session ID to prevent reuse
    sessionStorage.removeItem("sessionId");

    const response = await fetch(`${window.location.origin}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        pinned,
        archived
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create conversation: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const newSessionId = data.conversation_id;

    // Store the new session ID
    sessionStorage.setItem("sessionId", newSessionId);

    return newSessionId;
  } catch (error) {
    console.error('Failed to create conversation:', error);
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