import { initializeSession } from '/static/js/session.js';
import { initializeConfig } from '/static/js/config.js';
import { initializeFileManager } from '/static/js/fileManager.js';
import { showNotification } from '/static/js/ui/notificationManager.js';
import { configureMarkdown, injectMarkdownStyles } from '/static/js/ui/markdownParser.js';

// Main application entry point
async function initializeAzureConfig() {
    try {
        const response = await fetch('/api/config/');
        const config = await response.json();
        console.log("[initializeAzureConfig] Config response:", config);

        if (!config.deploymentName) {
            throw new Error("No deployment name found in config");
        }

        if (!config.models?.[config.deploymentName]) {
            throw new Error(`No model configuration found for deployment: ${config.deploymentName}`);
        }

        const modelConfig = config.models[config.deploymentName];
        if (!modelConfig.api_key) {
            throw new Error(`No API key found for deployment: ${config.deploymentName}`);
        }

        window.azureOpenAIConfig = {
            endpoint: modelConfig.endpoint || "https://o1models.openai.azure.com",
            apiKey: modelConfig.api_key
        };

        console.log("[initializeAzureConfig] Successfully initialized with deployment:", config.deploymentName);
    } catch (error) {
        console.error("[initializeAzureConfig] Failed to initialize:", error);
        showNotification(`Azure OpenAI configuration error: ${error.message}`, "error", 10000);
        throw error;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize core components
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
