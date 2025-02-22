import { initializeSession } from '/static/js/session.js';
import { initializeConfig } from '/static/js/config.js';
import { initializeFileManager } from '/static/js/fileManager.js';
import { showNotification } from '/static/js/ui/notificationManager.js';
import { configureMarkdown, injectMarkdownStyles } from '/static/js/ui/markdownParser.js';

// Main application entry point
async function initializeAzureConfig(retryCount = 3, retryDelay = 1000) {
    try {
        let lastError = null;
        
        for (let attempt = 1; attempt <= retryCount; attempt++) {
            try {
                const response = await fetch('/api/config/', {
                
                    headers: { 'Accept': 'application/json' }
                });
                
                if (response.status === 422) {
                    const errorData = await response.json();
                    console.error("[initializeAzureConfig] Validation error:", errorData);
                    throw new Error(`Config validation failed: ${errorData.detail || 'Unknown validation error'}`);
                }
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const config = await response.json();
                console.log("[initializeAzureConfig] Config response:", config);

               // Validate required fields
                const requiredFields = {
                    deploymentName: "deployment name",
                    'models': "model configuration",
                    'azureOpenAI.apiKey': "API key"
                };

                for (const [field, label] of Object.entries(requiredFields)) {
                    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
                    if (!value) {
                        throw new Error(`Missing ${label} in configuration`);
                    }
                }

               if (!config.models?.[config.deploymentName]) {
                    throw new Error(`No model configuration found for deployment: ${config.deploymentName}`);
                }

                const modelConfig = config.models[config.deploymentName];
                
                window.azureOpenAIConfig = {
                    endpoint: modelConfig.endpoint || "https://o1models.openai.azure.com",
                    apiKey: config.azureOpenAI.apiKey,
                    deploymentName: config.deploymentName
                };

                console.log("[initializeAzureConfig] Successfully initialized with deployment:", config.deploymentName);
                return true;
                
            } catch (error) {
                lastError = error;
                console.warn(`[initializeAzureConfig] Attempt ${attempt}/${retryCount} failed:`, error);
                
                if (error.message.includes('validation failed') || error.message.includes('422')) {
                    // Don't retry validation errors
                    break;
                }
                
                if (attempt < retryCount) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                }
            }
        }
        
        // If we get here, all attempts failed
        throw lastError || new Error('Failed to initialize Azure configuration');
    } catch (error) {
        handleInitializationError(error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize core components
        initializeTabSystem();
        await initializeMarkdownSupport();
        await initializeAzureConfig();
        await initializeConfig();
        await initializeSession();
        await initializeFileManager();

        console.log(`Application initialized successfully at ${new Date().toISOString()}`);
    } catch (error) {
        handleInitializationError(error);
    }
});

/**
 * Initialize tab system with click handlers
 */
function initializeTabSystem() {
    const tabs = document.querySelectorAll('[role="tab"]');
    const panels = document.querySelectorAll('[role="tabpanel"]');
    
    // Hide all panels initially except the first one
    panels.forEach((panel, index) => {
        if (index !== 0) {
            panel.style.display = 'none';
        }
    });
    
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Deactivate all tabs
            tabs.forEach(t => {
                t.setAttribute('aria-selected', 'false');
                t.classList.remove('active');
            });
            
            // Hide all panels
            panels.forEach(p => {
                p.style.display = 'none';
                p.classList.remove('active');
            });
            
            // Activate clicked tab
            const clickedTab = e.currentTarget;
            clickedTab.setAttribute('aria-selected', 'true');
            clickedTab.classList.add('active');
            
            // Show corresponding panel
            const panelId = clickedTab.getAttribute('aria-controls');
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.style.display = 'block';
                panel.classList.add('active');
            }
        });
    });
}

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

function handleInitializationError(error) {
    console.error("[handleInitializationError] Critical error:", error);

    let errorMessage = "Failed to initialize application";
    
    if (error.message.includes('validation failed')) {
        errorMessage = error.message;
    } else if (error.message.includes('API key')) {
        errorMessage = "Azure OpenAI API key is missing or invalid. Please check your configuration.";
    } else {
        errorMessage = `${errorMessage}: ${error.message}`;
    }

    const chatInterface = document.getElementById('chat-interface');
    const errorDisplay = document.getElementById('error-display');
    
    showNotification(errorMessage, "error", 10000);
    
    if (chatInterface) chatInterface.style.display = 'none';
    if (errorDisplay) {
        errorDisplay.style.display = 'block';
        errorDisplay.textContent = errorMessage;
    }
}
