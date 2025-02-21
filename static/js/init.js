import { initializeSession } from '/static/js/session.js';
import { loadFilesList, setupDragAndDrop } from '/static/js/fileManager.js';
import { initializeConfig } from '/static/js/config.js';
import { showNotification } from './ui/notificationManager.js';

window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize session first
        const sessionInitialized = await initializeSession();
        if (!sessionInitialized) {
            showNotification("Failed to initialize session", "error");
            return;
        }
        
        // Load initial files list
        await loadFilesList();
        
        // Set up UI components
        setupDragAndDrop();
        initializeConfig();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showNotification("Failed to initialize application", "error");
    }
});