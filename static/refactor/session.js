import { showNotification } from '../ui/notificationManager.js';

// Session state management
export let sessionId = null;
export let lastUserMessage = null;

export async function initializeSession() {
    try {
        const response = await fetch('/new_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.session_id) {
            throw new Error("Invalid session ID received");
        }

        sessionId = data.session_id;
        console.log("Session initialized with ID:", sessionId);
        return true;
    } catch (error) {
        console.error('Error initializing session:', error);
        showNotification('Failed to initialize session: ' + error.message, 'error');
        return false;
    }
}

export function clearSession() {
    sessionId = null;
    lastUserMessage = null;
    console.log("Session state cleared");
}

export function getSessionInfo() {
    return {
        sessionId,
        lastUserMessage,
        created: new Date().toISOString()
    };
}
