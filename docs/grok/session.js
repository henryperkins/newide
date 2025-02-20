// session.js
import { setSessionId } from './state.js';
import { showNotification } from './ui.js';

export async function initializeSession() {
    try {
        const response = await fetch('/new_session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.session_id) {
            throw new Error("Invalid session ID received");
        }

        setSessionId(data.session_id);
        console.log("Session initialized with ID:", data.session_id);
        return true;
    } catch (error) {
        console.error('Error initializing session:', error);
        showNotification('Failed to initialize session: ' + error.message, 'error');
        return false;
    }
}