import { initializeSession } from '/static/js/session.js';
import { initializeFileManager } from '/static/js/fileManager.js';
import { initializeConfig, updateReasoningEffortDisplay } from '/static/js/config.js';
import { showNotification } from '/static/js/ui/notificationManager.js';
import { sendMessage, regenerateResponse } from '/static/js/messageHandler.js';
import { configureMarkdown, injectMarkdownStyles } from '/static/js/ui/markdownParser.js';
import { setupDragAndDrop, loadFilesList } from '/static/js/fileManager.js';

window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize core components first
        await initializeMarkdownSupport();
        await initializeSessionHandling();
        
        // Initialize UI components
        initializeUIEventHandlers();
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

function initializeUIEventHandlers() {
    // Add configuration sync
    const syncConfigToStorage = () => {
        const config = {
            developerConfig: document.getElementById('developer-config').value,
            reasoningEffort: ['low', 'medium', 'high'][document.getElementById('reasoning-effort-slider').value - 1],
            includeFiles: document.getElementById('use-file-search').checked,
            selectedModel: document.getElementById('model-selector').value
        };
        localStorage.setItem('appConfig', JSON.stringify(config));
    };

    // Model selector handler
    document.getElementById('model-selector').addEventListener('change', (e) => {
        syncConfigToStorage();
        showNotification(`Switched to ${e.target.value} model`, 'info', 2000);
        updateModelSpecificUI(e.target.value);
    });

    // Initialize model-specific UI
    const initialModel = getCurrentConfig().selectedModel;
    updateModelSpecificUI(initialModel);

    // Send button handler
    document.getElementById('send-button')?.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        syncConfigToStorage();
        await sendMessage();
    });

    // Enter key handler
    document.getElementById('user-input')?.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            syncConfigToStorage();
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
    const sessionInitialized = await initializeSession();
    if (!sessionInitialized) {
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

function updateModelSpecificUI(model) {
    const reasoningControls = document.getElementById('reasoning-controls');
    const streamingToggle = document.getElementById('streaming-toggle');
    
    if (model === 'o1') {
        reasoningControls.style.display = 'block';
        if (streamingToggle) streamingToggle.disabled = true;
    } else {
        reasoningControls.style.display = 'none';
        if (streamingToggle) streamingToggle.disabled = false;
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
