import { showNotification } from '/static/js/ui/notificationManager.js';

export let sessionId = null;
export let lastUserMessage = '';

export async function initializeSession() {
    try {
        const response = await fetch('/api/session/create', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        
        const data = await response.json();
        if (!data.session_id) {
            throw new Error('Invalid session response: missing session_id');
        }
        
        sessionId = data.session_id;
        console.log('Session initialized successfully:', sessionId);
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