import { initializeSession } from '/static/js/session.js';
import { initializeConfig, updateReasoningEffortDisplay } from './config.js';
import { sendMessage, regenerateResponse } from './messageHandler.js';
import { setupDragAndDrop, loadFilesList } from './fileManager.js';
import { configureMarkdown, injectMarkdownStyles } from './ui/markdownParser.js';
import { showNotification } from '/static/js/ui/notificationManager.js';

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Configure core application features
        initializeMarkdownSupport();
        await initializeUIComponents();
        await initializeSessionHandling();
        await initializeFileHandling();

        // Log successful initialization with timestamp
        console.log(`Application initialized successfully at ${new Date().toISOString()}`);
    } catch (error) {
        // Forward to centralized error handler
        handleInitializationError(error);
    }
});

function initializeMarkdownSupport() {
    if (!configureMarkdown()) {
        showNotification(
            "Markdown support limited - required libraries not loaded",
            "warning",
            8000
        );
    }
    injectMarkdownStyles();
}

function initializeUIEventHandlers() {
    // Send button handler
    document.getElementById('send-button')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await sendMessage();
    });

    // Enter key handler
    document.getElementById('user-input')?.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await sendMessage();
        }
    });

    // Reasoning effort slider
    const slider = document.getElementById('reasoning-effort-slider');
    if (slider) {
        slider.addEventListener('input', updateReasoningEffortDisplay);
        slider.value = 1; // Default to medium effort
        updateReasoningEffortDisplay();
    }

    // Regeneration handler
    document.getElementById('regenerate-button')?.addEventListener('click', regenerateResponse);

    // Tab switching
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.targetTab;
            if (tabId) switchTab(tabId);
        });
    });
}

async function initializeSessionHandling() {
    if (!await initializeSession()) {
        throw new Error("Failed to initialize session");
    }
}

function initializeFileHandling() {
    setupDragAndDrop();
    loadFilesList().catch(error => {
        console.error("File list load failed:", error);
        showNotification("Failed to load file list", "error");
    });
}

function switchTab(tabId) {
    // Hide all tab content first
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.setAttribute('aria-hidden', 'true');
    });
    
    // Deactivate all tab buttons
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
        button.setAttribute('aria-selected', 'false');
    });
    
    // Activate selected tab and its content
    const selectedContent = document.getElementById(tabId);
    const selectedTab = document.querySelector(`[data-target-tab="${tabId}"]`);
    
    if (selectedContent) {
        selectedContent.classList.add('active');
        selectedContent.setAttribute('aria-hidden', 'false');
    }
    
    if (selectedTab) {
        selectedTab.classList.add('active');
        selectedTab.setAttribute('aria-selected', 'true');
    }
}

function handleInitializationError(error) {
    console.error("Critical initialization error:", error);
    showNotification(
        `Failed to initialize application: ${error.message}`,
        "error",
        10000
    );
    document.getElementById('chat-interface').style.display = 'none';
    document.getElementById('error-display').style.display = 'block';
}
