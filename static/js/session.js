import { showNotification } from '/static/js/ui/notificationManager.js';

export let sessionId = null;
let _lastUserMessage = '';

export async function initializeSession() {
    try {
        const modelConfig = await getModelSettings();
        const response = await fetch(`/api/session/create?api-version=${modelConfig.api_version}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Model-Type': modelConfig.name
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

export function setLastUserMessage(message) {
    _lastUserMessage = message;
}

export function getLastUserMessage() {
    return _lastUserMessage;
}
