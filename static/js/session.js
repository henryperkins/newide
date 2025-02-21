import { showNotification } from './ui/notificationManager.js';

let sessionId = null;

export async function initializeSession() {
    try {
        const response = await fetch('/api/session/create', {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        sessionId = data.session_id;
        
        return true;
    } catch (error) {
        console.error('Session initialization error:', error);
        showNotification('Failed to initialize session', 'error');
        return false;
    }
}

export function getSessionId() {
    return sessionId;
}
