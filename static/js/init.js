import { initializeSession } from '/static/js/session.js';
import { initializeFileManager } from '/static/js/fileManager.js';
import { initializeConfig, updateReasoningEffortDisplay, getCurrentConfig, getModelSettings, updateModelSpecificUI, switchTab, updateConfig } from '/static/js/config.js';
import { showNotification } from '/static/js/ui/notificationManager.js';
import { sendMessage, regenerateResponse } from '/static/js/messageHandler.js';
import { configureMarkdown, injectMarkdownStyles } from '/static/js/ui/markdownParser.js';
import { setupDragAndDrop, loadFilesList } from '/static/js/fileManager.js';

window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize core components first
        await initializeMarkdownSupport();
        await initializeSessionHandling();
        await initializeConfig();
        
        // Initialize UI components
        await initializeUIEventHandlers();
        await initializeFileHandling();

        console.log(`Application initialized successfully at ${new Date().toISOString()}`);
    } catch (error) {
        handleInitializationError(error);
    }
});

async function initializeMarkdownSupport() {
    if (!configureMarkdown()) {
        showNotification(
            "Markdown support limited - required libraries not loaded",
            "warning",
            8000
        );
    }
    injectMarkdownStyles();
}

async function initializeUIEventHandlers() {
    // Configuration sync helper
    const syncConfigToStorage = async () => {
        const config = {
            developerConfig: document.getElementById('developer-config')?.value || '',
            reasoningEffort: ['low', 'medium', 'high'][
                (document.getElementById('reasoning-effort-slider')?.value || 2) - 1
            ],
            includeFiles: document.getElementById('use-file-search')?.checked || false,
            selectedModel: document.getElementById('model-selector')?.value || 'o1model-east2'
        };
        localStorage.setItem('appConfig', JSON.stringify(config));
        await updateConfig(config);
    };

    // Model selector handler with error handling
    const modelSelector = document.getElementById('model-selector');
    if (modelSelector) {
        modelSelector.addEventListener('change', async (e) => {
            try {
                await syncConfigToStorage();
                showNotification(`Switched to ${e.target.value} model`, 'info', 2000);
                await updateModelSpecificUI(e.target.value);
            } catch (error) {
                console.error('Model switch error:', error);
                showNotification('Failed to switch model', 'error');
            }
        });

        // Initialize model-specific UI
        try {
            const config = await getCurrentConfig();
            await updateModelSpecificUI(config.selectedModel);
        } catch (error) {
            console.error('Failed to initialize model UI:', error);
            showNotification('Failed to initialize model UI', 'error');
        }
    }

    // Message sending handlers
    const sendButton = document.getElementById('send-button');
    const userInput = document.getElementById('user-input');

    if (sendButton) {
        sendButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await syncConfigToStorage();
            await sendMessage();
        });
    }

    if (userInput) {
        userInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                await syncConfigToStorage();
                await sendMessage();
            }
        });
    }

    // Reasoning effort slider with validation
    const slider = document.getElementById('reasoning-effort-slider');
    if (slider) {
        slider.addEventListener('input', updateReasoningEffortDisplay);
        // Ensure valid initial value
        slider.value = Math.max(1, Math.min(3, parseInt(slider.value) || 2));
        updateReasoningEffortDisplay();
    }

    // Regeneration handler
    const regenerateButton = document.getElementById('regenerate-button');
    if (regenerateButton) {
        regenerateButton.addEventListener('click', regenerateResponse);
    }

    // Tab switching with accessibility support
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.targetTab;
            if (tabId) {
                switchTab(tabId);
                // Update URL hash for deep linking
                window.location.hash = tabId;
            }
        });

        // Keyboard navigation
        button.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                button.click();
            }
        });
    });

    // Handle deep linking on page load
    if (window.location.hash) {
        const tabId = window.location.hash.slice(1);
        const tabButton = document.querySelector(`[data-target-tab="${tabId}"]`);
        if (tabButton) {
            tabButton.click();
        }
    }
}

async function initializeSessionHandling() {
    const sessionInitialized = await initializeSession();
    if (!sessionInitialized) {
        throw new Error("Failed to initialize session");
    }
}

async function initializeFileHandling() {
    setupDragAndDrop();
    try {
        await loadFilesList();
    } catch (error) {
        console.error("File list load failed:", error);
        showNotification("Failed to load file list", "error");
    }
}

function handleInitializationError(error) {
    console.error("Critical initialization error:", error);
    showNotification(
        `Failed to initialize application: ${error.message}`,
        "error",
        10000
    );
    const chatInterface = document.getElementById('chat-interface');
    const errorDisplay = document.getElementById('error-display');
    
    if (chatInterface) chatInterface.style.display = 'none';
    if (errorDisplay) errorDisplay.style.display = 'block';
}
