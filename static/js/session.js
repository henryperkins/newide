import { showNotification } from '/static/js/ui/notificationManager.js';
import { getModelSettings } from '/static/js/config.js';

export let sessionId = null;
let _lastUserMessage = '';

export async function initializeSession() {
    console.log('[DEBUG] Initializing session...');
    try {
        const modelConfig = await getModelSettings();
        console.log('[DEBUG] Model config:', modelConfig);
        const response = await fetch(`/api/session/create`, {
            method: 'GET',
            headers: {
                'x-api-version': modelConfig.api_version,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Model-Type': modelConfig.name
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
        console.log('[DEBUG] Stored sessionId:', sessionId);
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
