/**
 * session.js - Enhanced session management with validation and automatic recovery,
 * including optional Sentry integration for error tracking and performance monitoring.
 */

import { showNotification } from './ui/notificationManager.js';

/**
 * Get current session ID or create a new one if invalid.
 * @returns {Promise<string|null>} Valid session ID or null if all attempts fail.
 */
export async function getSessionId() {
  let transaction;
  try {
    // Dynamically import Sentry for performance monitoring
    const sentryInit = await import('./sentryInit.js');
    transaction = sentryInit.startTransaction('getSessionId', 'session.get', {
      source: 'frontend',
    });

    // Add a breadcrumb indicating we’re trying to retrieve/validate the session
    sentryInit.addBreadcrumb({
      category: 'session',
      message: 'Attempting to retrieve or validate session ID',
      level: 'info',
    });
  } catch (err) {
    console.warn('[getSessionId] Failed to start Sentry transaction:', err);
  }

  let sessionId = sessionStorage.getItem("sessionId");

  // If we have a sessionId, validate it
  if (sessionId) {
    try {
      const isValid = await validateSession(sessionId);
      if (isValid) {
        if (transaction) {
          transaction.setData('session_id', sessionId);
          transaction.setData('result', 'valid_existing');
          transaction.setStatus('ok');
          transaction.finish();
        }
        return sessionId;
      }

      console.warn(`[getSessionId] Session ${sessionId} is invalid. Creating new session.`);
      sessionStorage.removeItem("sessionId");
    } catch (error) {
      console.error("[getSessionId] Error validating session:", error);
      sessionStorage.removeItem("sessionId");
      if (transaction) {
        transaction.setData('error_stage', 'validate_session');
        transaction.captureException?.(error);
      }
    }
  }

  // Create a new session if none, or if the existing one is invalid
  try {
    const newSessionId = await createNewConversation();
    if (newSessionId) {
      console.log('[getSessionId] Created new session:', newSessionId);
      sessionStorage.setItem("sessionId", newSessionId);

      if (transaction) {
        transaction.setData('session_id', newSessionId);
        transaction.setData('result', 'created_new');
        transaction.setStatus('ok');
        transaction.finish();
      }
      return newSessionId;
    }
  } catch (error) {
    console.error("[getSessionId] Failed to create new session:", error);
    showNotification("Failed to create a new conversation. Please refresh the page.", "error");

    if (transaction) {
      transaction.setData('error_stage', 'create_new_conversation');
      transaction.captureException?.(error);
      transaction.setStatus('internal_error');
      transaction.finish();
    }
  }

  // If we reach here, we did not successfully get/create a session
  if (transaction) {
    transaction.setData('result', 'failed');
    transaction.setStatus('unknown');
    transaction.finish();
  }
  return null;
}

/**
 * Validate if a session exists on the server.
 * @param {string} sessionId - Session ID to validate
 * @returns {Promise<boolean>} True if session is valid
 */
async function validateSession(sessionId) {
  let localTx;
  try {
    const sentryInit = await import('./sentryInit.js');
    localTx = sentryInit.startTransaction('validateSession', 'session.validate', {
      session_id: sessionId,
    });
    sentryInit.addBreadcrumb({
      category: 'session',
      message: `Validating session ${sessionId}`,
      level: 'info',
    });
  } catch (err) {
    console.warn('[validateSession] Failed to start Sentry transaction:', err);
  }

  try {
    const response = await fetch(
      `${window.location.origin}/api/session?session_id=${encodeURIComponent(sessionId)}`
    );
    if (!response.ok) {
      if (localTx) {
        localTx.setStatus('cancelled');
        localTx.finish();
      }
      return false;
    }
    const data = await response.json();
    const isValid = data && data.id === sessionId;

    if (localTx) {
      localTx.setStatus(isValid ? 'ok' : 'invalid');
      localTx.finish();
    }
    return isValid;
  } catch (error) {
    console.warn(`[validateSession] Error validating session ${sessionId}:`, error);
    if (localTx) {
      localTx.captureException?.(error);
      localTx.setStatus('internal_error');
      localTx.finish();
    }
    return false;
  }
}

/**
 * Create a new session
 * @param {string} title - Optional conversation title
 * @param {boolean} pinned - Whether the conversation is pinned
 * @param {boolean} archived - Whether the conversation is archived
 * @returns {Promise<string|null>} New session ID or null on failure
 */
export async function createNewConversation(title = "New Conversation", pinned = false, archived = false) {
  let transaction;
  try {
    const sentryInit = await import('./sentryInit.js');
    transaction = sentryInit.startTransaction('createNewConversation', 'session.create', {
      conversation_title: title,
    });
    sentryInit.addBreadcrumb({
      category: 'session',
      message: 'Creating new conversation session',
      level: 'info',
      data: { title, pinned, archived },
    });
  } catch (err) {
    console.warn('[createNewConversation] Failed to start Sentry transaction:', err);
  }

  try {
    sessionStorage.removeItem("sessionId");

    const response = await fetch(`${window.location.origin}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorText = await response.text();
      const msg = `Failed to create session: ${response.status} - ${errorText}`;
      if (transaction) {
        transaction.setData('server_status', response.status);
        transaction.captureMessage?.(msg, 'error');
        transaction.setStatus('internal_error');
        transaction.finish();
      }
      throw new Error(msg);
    }

    const data = await response.json();
    const newSessionId = data.session_id;
    sessionStorage.setItem("sessionId", newSessionId);

    // Also create a conversation record for backward compatibility
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
      if (transaction) {
        transaction.captureException?.(convError);
      }
    }

    if (transaction) {
      transaction.setData('session_id', newSessionId);
      transaction.setStatus('ok');
      transaction.finish();
    }

    return newSessionId;
  } catch (error) {
    console.error('Failed to create session:', error);
    if (transaction) {
      transaction.captureException?.(error);
      transaction.setStatus('internal_error');
      transaction.finish();
    }
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

  // Add a breadcrumb for better diagnostic
  import('./sentryInit.js').then(sentry => {
    sentry.addBreadcrumb({
      category: 'session',
      message: `Switching session model to ${modelName}`,
      level: 'info',
      data: { sessionId, modelName },
    });
  });

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

      import('./sentryInit.js').then(sentry => {
        sentry.captureMessage?.(`Failed switchSessionModel: ${response.status}`, 'warning');
      });
      return false;
    }

    console.log(`[switchSessionModel] Successfully updated session model to ${modelName}`);
    return true;
  } catch (error) {
    console.error('[switchSessionModel] Error updating session model:', error);
    import('./sentryInit.js').then(sentry => {
      sentry.captureException?.(error, { context: 'switchSessionModel' });
    });
    return false;
  }
}

/**
 * Ensure we have a valid session, creating a new one if necessary
 * @returns {Promise<string|null>} Valid session ID or null if all attempts fail
 */
export async function ensureValidSession() {
  let transaction;
  try {
    const sentryInit = await import('./sentryInit.js');
    transaction = sentryInit.startTransaction('ensureValidSession','session.ensure');
  } catch (err) {
    console.warn('[ensureValidSession] Could not start transaction:', err);
  }

  let sessionId = sessionStorage.getItem("sessionId");
  if (sessionId) {
    const isValid = await validateSession(sessionId);
    if (isValid) {
      await refreshSession(sessionId);
      if (transaction) {
        transaction.setData('session_id', sessionId);
        transaction.setStatus('ok');
        transaction.finish();
      }
      return sessionId;
    }
    sessionStorage.removeItem("sessionId");
  }

  const newSessionId = await createNewConversation();
  if (transaction) {
    transaction.setData('session_id', newSessionId || 'null');
    transaction.setStatus(newSessionId ? 'ok' : 'internal_error');
    transaction.finish();
  }
  return newSessionId;
}

/**
 * Initialize a new session (legacy function for backward compatibility)
 * @returns {Promise<boolean>} Success status
 */
export async function initializeSession() {
  let transaction;
  try {
    const sentryInit = await import('./sentryInit.js');
    transaction = sentryInit.startTransaction('initializeSession', 'session.init');
  } catch (err) {
    console.warn('[initializeSession] Could not start transaction:', err);
  }

  try {
    const sessionId = await createNewConversation();
    if (sessionId) {
      sessionStorage.setItem('sessionId', sessionId);

      if (transaction) {
        transaction.setData('session_id', sessionId);
        transaction.setStatus('ok');
        transaction.finish();
      }
      return true;
    }
    if (transaction) {
      transaction.setData('result', 'failed');
      transaction.finish();
    }
    return false;
  } catch (error) {
    console.error('Failed to initialize session:', error);
    if (transaction) {
      transaction.captureException?.(error);
      transaction.setStatus('internal_error');
      transaction.finish();
    }
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

  let transaction;
  try {
    const sentryInit = await import('./sentryInit.js');
    transaction = sentryInit.startTransaction('refreshSession','session.refresh');
  } catch (err) {
    console.warn('[refreshSession] Could not start transaction:', err);
  }

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
      if (transaction) {
        transaction.setData('status_code', response.status);
        transaction.setStatus('cancelled');
        transaction.finish();
      }
      return false;
    }

    console.log(`[refreshSession] Successfully refreshed session ${sessionId}`);
    if (transaction) {
      transaction.setData('session_id', sessionId);
      transaction.setStatus('ok');
      transaction.finish();
    }
    return true;
  } catch (error) {
    console.error('[refreshSession] Error refreshing session:', error);
    if (transaction) {
      transaction.captureException?.(error);
      transaction.setStatus('internal_error');
      transaction.finish();
    }
    return false;
  }
}
