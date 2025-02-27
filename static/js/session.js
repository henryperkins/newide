import { showNotification } from '/static/js/ui/notificationManager.js';
import { getModelSettings } from '/static/js/config.js';

export let sessionId = null;
let _lastUserMessage = '';

export async function initializeSession() {
    // If we already have a sessionId, don't reinitialize
    if (sessionId) {
        console.log('[DEBUG] Session already initialized:', sessionId);
        return true;
    }
    
    console.log('[DEBUG] Initializing session...');
    try {
        const modelConfig = await getModelSettings();
        console.log('[DEBUG] Model config:', modelConfig);
        
        // First, check if valid session exists
        try {
            const checkResponse = await fetch('/api/session');
            if (checkResponse.ok) {
                const sessionData = await checkResponse.json();
                if (sessionData.id) {
                    sessionId = sessionData.id;
                    console.log('[DEBUG] Found existing session:', sessionId);
                    localStorage.setItem('current_session_id', sessionId);
                    return true;
                }
            }
        } catch (error) {
            console.log('[DEBUG] No active session found, creating new one:', error);
        }
        
        // Add retry logic for session creation
        let retries = 3;
        let success = false;
        let lastError = null;
        
        while (retries > 0 && !success) {
            try {
                const response = await fetch(`/api/session/create`, {
                    method: 'POST', // Changed from GET to POST
                    headers: {
                        'x-api-version': modelConfig.api_version || '2025-01-01-preview',
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'X-Model-Type': modelConfig.name || 'DeepSeek-R1' // Fallback to DeepSeek-R1 if no model specified
                    }
                });
                console.log('[DEBUG] Session response status:', response.status);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                }
                
                const data = await response.json();
                console.log('[DEBUG] Session response data:', data);
                if (!data.session_id) {
                    throw new Error('Invalid session response: missing session_id');
                }
                
                sessionId = data.session_id;
                console.log('[DEBUG] Session initialized successfully:', sessionId);
                
                // Store session ID in localStorage for persistence
                localStorage.setItem('current_session_id', sessionId);
                
                success = true;
                return true;
            } catch (error) {
                lastError = error;
                console.warn(`Session initialization attempt failed (${retries} retries left):`, error);
                retries--;
                // Wait before retrying
                if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        // If we get here, all retries failed
        throw lastError || new Error('Failed to initialize session after multiple attempts');
    } catch (error) {
        console.error('Session initialization error:', error);
        showNotification('Failed to initialize session', 'error');
        return false;
    }
}

// Try to restore session from localStorage on page load
(function restoreSession() {
    const savedSessionId = localStorage.getItem('current_session_id');
    if (savedSessionId) {
        console.log('[DEBUG] Restoring session from localStorage:', savedSessionId);
        sessionId = savedSessionId;
    }
})();

export function getSessionId() {
    return sessionId;
}

export function setLastUserMessage(message) {
    _lastUserMessage = message;
}

export function getLastUserMessage() {
    return _lastUserMessage;
}
