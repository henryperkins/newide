import { initializeSession } from '/static/js/session.js';
import { initializeFileManager } from '/static/js/fileManager.js';
import { initializeConfig } from '/static/js/config.js';
import { showNotification } from '/static/js/ui/notificationManager.js';
import { sendMessage } from '/static/js/messageHandler.js';

window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize session first
        const sessionInitialized = await initializeSession();
        if (!sessionInitialized) {
            showNotification("Failed to initialize session", "error");
            return;
        }
        
        // Initialize file management system
        await initializeFileManager();
        
        // Initialize configuration
        const config = initializeConfig();
        if (!config?.initialized) {
            throw new Error('Configuration initialization failed');
        }

        // Add send button handler
        document.getElementById('send-button').addEventListener('click', sendMessage);
        
        // Add enter key handler
        document.getElementById('user-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

    } catch (error) {
        console.error('Initialization error:', error);
        showNotification("Failed to initialize application", "error");
    }
});
