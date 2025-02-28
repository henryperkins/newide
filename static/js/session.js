// static/js/session.js - Consolidated version

// Import notification utilities
import { showNotification, showConfirmDialog } from './ui/notificationManager.js';

// Session state
let sessionId = null;
let sessionLastChecked = 0;
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
let lastUserMessage = null; // Store last user message for retry scenarios

/**
 * Get the current session ID
 * @returns {string|null} The current session ID or null if no active session
 */
export function getSessionId() {
  // First check URL for session_id parameter
  const urlParams = new URLSearchParams(window.location.search);
  const paramSessionId = urlParams.get('session_id');
  if (paramSessionId && validateSessionId(paramSessionId)) {
    // Store in localStorage for future use
    localStorage.setItem('current_session_id', paramSessionId);
    return paramSessionId;
  }
  
  // Next check localStorage
  const storedSessionId = localStorage.getItem('current_session_id');
  if (storedSessionId && validateSessionId(storedSessionId)) {
    return storedSessionId;
  }
  
  // Generate a new session ID if none found or invalid
  const newSessionId = generateSessionId();
  localStorage.setItem('current_session_id', newSessionId);
  return newSessionId;
}

/**
 * Validate a session ID format (UUID)
 * @param {string} sessionId - The session ID to validate
 * @returns {boolean} - Whether the session ID is valid
 */
function validateSessionId(sessionId) {
  // Simple UUID format validation regex
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(sessionId);
}

/**
 * Generate a new UUID-format session ID
 * @returns {string} - A new session ID
 */
function generateSessionId() {
  // RFC4122 version 4 compliant UUID generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    // eslint-disable-next-line no-bitwise
    const r = Math.random() * 16 | 0;
    // eslint-disable-next-line no-bitwise
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Create a new session, replacing the current one
 * @returns {string} - The new session ID
 */
export function createNewSession() {
  const newSessionId = generateSessionId();
  localStorage.setItem('current_session_id', newSessionId);
  
  // Update URL without reloading if possible
  if (window.history && window.history.replaceState) {
    const url = new URL(window.location);
    url.searchParams.set('session_id', newSessionId);
    window.history.replaceState({}, '', url);
  }
  
  return newSessionId;
}

/**
 * Switch to a specified session
 * @param {string} sessionId - The session ID to switch to
 * @returns {boolean} - Whether the switch was successful
 */
export function switchToSession(sessionId) {
  if (!validateSessionId(sessionId)) {
    console.error(`Invalid session ID format: ${sessionId}`);
    return false;
  }
  
  localStorage.setItem('current_session_id', sessionId);
  
  // Update URL without reloading if possible
  if (window.history && window.history.replaceState) {
    const url = new URL(window.location);
    url.searchParams.set('session_id', sessionId);
    window.history.replaceState({}, '', url);
  }
  
  return true;
}

/**
 * Store the last user message for retry purposes
 * @param {string} message - The message to store
 */
export function setLastUserMessage(message) {
  lastUserMessage = message;
}

/**
 * Get the last user message
 * @returns {string|null} The last user message or null if none exists
 */
export function getLastUserMessage() {
  return lastUserMessage;
}

/**
 * Initialize session, creating one if needed
 * @returns {Promise<boolean>} True if session initialized successfully
 */
export async function initializeSession() {
  // If we already have a sessionId and it was checked recently, don't reinitialize
  if (sessionId && (Date.now() - sessionLastChecked < SESSION_CHECK_INTERVAL)) {
    console.log('[SESSION] Using cached session:', sessionId);
    return true;
  }
  
  console.log('[SESSION] Initializing session...');
  
  try {
    // First try to validate existing session
    const existingId = localStorage.getItem('current_session_id');
    if (existingId) {
      console.log('[SESSION] Found stored session ID:', existingId);
      
      // Validate session by calling API
      const isValid = await validateSession(existingId);
      if (isValid) {
        sessionId = existingId;
        sessionLastChecked = Date.now();
        return true;
      }
      
      console.log('[SESSION] Stored session is invalid, creating new one');
    }
    
    // Create new session
    const newSession = await createSession();
    if (newSession) {
      sessionId = newSession.session_id;
      localStorage.setItem('current_session_id', sessionId);
      sessionLastChecked = Date.now();
      return true;
    }
    
    throw new Error('Failed to create session');
  } catch (error) {
    console.error('[SESSION] Initialization error:', error);
    showNotification('Failed to initialize session. Please reload the page.', 'error');
    return false;
  }
}

/**
 * Validate a session ID with the server
 * @param {string} id - Session ID to validate
 * @returns {Promise<boolean>} True if session is valid
 */
async function validateSession(id) {
  try {
    const response = await fetch(`/api/session?session_id=${id}`);
    if (!response.ok) return false;
    
    const data = await response.json();
    return data && data.id === id;
  } catch (error) {
    console.warn('[SESSION] Error validating session:', error);
    return false;
  }
}

/**
 * Create a new session
 * @returns {Promise<Object|null>} Session data or null if creation failed
 */
async function createSession() {
  try {
    // Get current model for initialization
    const modelSelect = document.getElementById('model-select');
    const modelName = modelSelect ? modelSelect.value : 'DeepSeek-R1';
    
    const response = await fetch('/api/session/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Model-Type': modelName
      }
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create session: ${text}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('[SESSION] Error creating session:', error);
    return null;
  }
}

/**
 * Refresh the current session to extend its expiration
 * @returns {Promise<boolean>} True if session was refreshed successfully
 */
export async function refreshSession() {
  if (!sessionId) return false;
  
  try {
    const response = await fetch(`/api/session/refresh?session_id=${sessionId}`, {
      method: 'POST'
    });
    
    if (response.ok) {
      sessionLastChecked = Date.now();
      return true;
    }
    
    return false;
  } catch (error) {
    console.warn('[SESSION] Error refreshing session:', error);
    return false;
  }
}

/**
 * Update the model associated with the current session
 * @param {string} modelName - The model name to set for the session
 * @returns {Promise<boolean>} True if model was updated successfully
 */
export async function updateSessionModel(modelName) {
  if (!sessionId) return false;
  
  try {
    const response = await fetch(`/api/session/model?session_id=${sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: modelName })
    });
    
    return response.ok;
  } catch (error) {
    console.warn('[SESSION] Error updating session model:', error);
    return false;
  }
}

// Set up periodic session check
setInterval(async () => {
  if (sessionId && (Date.now() - sessionLastChecked >= SESSION_CHECK_INTERVAL)) {
    console.log('[SESSION] Performing periodic session refresh');
    await refreshSession();
  }
}, 60000); // Check every minute

// Try to restore session on page load
(async function() {
  await initializeSession();
})();