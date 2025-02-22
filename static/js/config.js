/* static/js/config.js */

const fallbackConfig = {
    reasoningEffort: "medium",
    developerConfig: "Formatting re-enabled - use markdown code blocks",
    includeFiles: false,
    selectedModel: "o1model-east2",
    deploymentName: "o1model-east2",
    azureOpenAI: {
        apiKey: window.azureOpenAIConfig?.apiKey || "",
        endpoint: window.azureOpenAIConfig?.endpoint || "",
        deploymentName: window.azureOpenAIConfig?.deploymentName || "",
        apiVersion: window.azureOpenAIConfig?.apiVersion || "2025-01-01-preview"
    }
};

/**
 * Caches the fetched configuration for 5 minutes.
 */
let cachedConfig = null;
let lastFetchTime = 0;

/**
 * UI Configuration Constants - Frozen to prevent accidental mutation
 * @typedef {Object} ReasoningEffortConfig
 * @property {string} SLIDER_ID - Slider element ID
 * @property {string} DISPLAY_ID - Display element ID
 * @property {Object<String, number>} LEVEL_VALUES - Effort level mappings
 */

/**
 * Centralized configuration for reasoning effort UI elements and values
 * @type {Readonly<ReasoningEffortConfig>}
 */
const REASONING_EFFORT_CONFIG = Object.freeze({
    SLIDER_ID: 'reasoning-effort-slider',
    DISPLAY_ID: 'reasoning-effort-display',
    LEVEL_VALUES: Object.freeze({
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3
    })
});

/**
 * Safely gets DOM element with validation
 * @param {string} elementId
 * @returns {HTMLElement|null}
 */
function getValidatedElement(elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn(`UI Element not found: ${elementId}`);
        return null;
    }
    return element;
}

/**
 * Initialize configuration-dependent UI elements and tab switching.
 */
export async function initializeConfig() {
    try {
        const config = await getCurrentConfig();
        updateReasoningEffortDisplay();
        await updateModelSpecificUI(config.selectedModel);
    } catch (error) {
        console.error('Failed to initialize UI elements:', error);
    }

    // Tab switching functionality
    const configTab = document.getElementById('config-tab');
    const filesTab = document.getElementById('files-tab');
    const configContent = document.getElementById('config-content');
    const filesContent = document.getElementById('files-content');

    if (configTab && filesTab && configContent && filesContent) {
        function switchTab(selectedTab, selectedContent) {
            // Update tab buttons
            [configTab, filesTab].forEach(tab => {
                tab.classList.remove('active');
                tab.setAttribute('aria-selected', 'false');
                tab.setAttribute('tabindex', '-1');
            });
            selectedTab.classList.add('active');
            selectedTab.setAttribute('aria-selected', 'true');
            selectedTab.setAttribute('tabindex', '0');

            // Update tab content
            [configContent, filesContent].forEach(content => {
                content.classList.remove('active');
                content.setAttribute('aria-hidden', 'true');
            });
            selectedContent.classList.add('active');
            selectedContent.setAttribute('aria-hidden', 'false');
        }

        // Set initial active state
        configTab.classList.add('active');
        configContent.classList.add('active');

        // Add event listeners for tab switching
        configTab.addEventListener('click', () => switchTab(configTab, configContent));
        filesTab.addEventListener('click', () => switchTab(filesTab, filesContent));
    }
}

/**
 * Get current application configuration from server.
 * Caches the configuration for 5 minutes.
 * @returns {Promise<Object>} Validated configuration object.
 */
export async function getCurrentConfig() {
    try {
        // Cache config for 5 minutes (300,000 milliseconds)
        if (!cachedConfig || Date.now() - lastFetchTime > 300000) {
            console.debug('Fetching config from /api/config/ endpoint');
            const timeoutDuration = 5000; // 5 seconds
            const maxRetries = 2;
            let response;
            let responseData;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
                    
                    response = await fetch('/api/config/', {
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    console.debug(`Config response status: ${response.status}`);
                    
                    if (response.status >= 500) { // Server errors
                        console.warn(`Server error (${response.status}), using fallback config`);
                        throw new Error("Server error: Unable to fetch configuration");
                    }
                    
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    
                    responseData = await response.json();
                    // Validate minimum required config
                    if (!responseData.selectedModel || !responseData.reasoningEffort || !responseData.deploymentName) {
                        throw new Error('Invalid config structure: missing required fields (selectedModel, reasoningEffort, or deploymentName)');
                    }
                    break;
                    
                } catch (error) {
                    if (attempt === maxRetries) throw error;
                    console.warn(`Config fetch failed (attempt ${attempt}), retrying...`, error);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
            console.debug('Received config:', responseData);
            cachedConfig = { ...fallbackConfig, ...responseData };
            lastFetchTime = Date.now();
        }
        return cachedConfig;
    } catch (error) {
        console.error('Using fallback config. Error details:', {
            error: error.message,
            stack: error.stack
        });
        // Return fallback config instead of throwing error
        return fallbackConfig;
    }
}

/**
 * Update a specific configuration key with a new value.
 * @param {string} key - The configuration key to update.
 * @param {*} value - The new value for the key.
 * @returns {Promise<boolean>} True if update was successful.
 */
export async function updateConfig(key, value) {
    // Ensure key is a valid non-empty string and not the string "[object Object]"
    if (typeof key !== 'string' || key.trim() === "" || key === "[object Object]") {
        console.error('updateConfig: Invalid configuration key. Expected a valid string key but received:', key);
        return false;
    }
    try {
        const response = await fetch(`/api/config/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value })
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to update config:', error);
        return false;
    }
}

/**
 * Get timeout durations for different reasoning levels.
 * @returns {Object} Timeouts in milliseconds for low/medium/high effort.
 */
export function getTimeoutDurations() {
    return {
        low: 15000,    // 15 seconds
        medium: 30000, // 30 seconds
        high: 60000    // 60 seconds
    };
}

import { MODEL_CONFIG } from './models.js';

/**
 * Returns current model settings from centralized configuration.
 * @returns {Promise<Object>} The model configuration.
 */
export async function getModelSettings() {
    try {
        const config = await getCurrentConfig();
        const modelConfig = MODEL_CONFIG[config.selectedModel] || MODEL_CONFIG["o1model-east2"];
        return {
            name: config.selectedModel || "o1model-east2",
            ...modelConfig,
            capabilities: {
                requires_reasoning_effort: true,
                max_completion_tokens: modelConfig.capabilities.max_completion_tokens,
                fixed_temperature: modelConfig.capabilities.fixed_temperature,
                ...(modelConfig?.capabilities || {})
            }
        };
    } catch (error) {
        console.error('Failed to get model settings:', error);
        return {
            ...MODEL_CONFIG["o1model-east2"],
            capabilities: {
                requires_reasoning_effort: true,
                ...(MODEL_CONFIG["o1model-east2"]?.capabilities || {})
            }
        };
    }
}

/**
 * Get safety configuration for the current model.
 * @returns {Promise<Object>} The safety configuration.
 */
export async function getSafetyConfig() {
    const modelConfig = await getModelSettings();
    return modelConfig.safety_config || {};
}

/**
 * Get response formatting tags for the current model.
 * @returns {Promise<Object>} The response formatting configuration.
 */
export async function getResponseFormatting() {
    const modelConfig = await getModelSettings();
    return modelConfig.response_format || {};
}

/**
 * Updates the reasoning effort display using centralized configuration
 * and validation checks.
 */
export function updateReasoningEffortDisplay() {
    // Safely get elements with fallbacks
    const slider = getValidatedElement(REASONING_EFFORT_CONFIG.SLIDER_ID);
    const effortDisplay = getValidatedElement(REASONING_EFFORT_CONFIG.DISPLAY_ID);
    
    // Validate core elements exist
    if (!slider || !effortDisplay) {
        console.error('Reasoning effort UI elements missing:', {
            sliderExists: !!slider,
            displayExists: !!effortDisplay,
            config: REASONING_EFFORT_CONFIG
        });
        if (effortDisplay) {
            effortDisplay.textContent = 'Medium'; // Default visible state
        }
        return;
    }

    // Validate slider value boundaries
    const minValue = Math.min(...Object.values(REASONING_EFFORT_CONFIG.LEVEL_VALUES));
    const maxValue = Math.max(...Object.values(REASONING_EFFORT_CONFIG.LEVEL_VALUES));
    const clampedValue = Math.max(minValue, Math.min(maxValue, parseInt(slider.value, 10)));
    if (clampedValue !== parseInt(slider.value, 10)) {
        slider.value = clampedValue;
    }

    // Get labels with fallback
    const effortLabels = Object.keys(REASONING_EFFORT_CONFIG.LEVEL_VALUES).length > 0
        ? Object.keys(REASONING_EFFORT_CONFIG.LEVEL_VALUES)
        : ['low', 'medium', 'high'];
    const valueIndex = Math.max(
        0,
        Math.min(
            parseInt(slider.value, 10) - REASONING_EFFORT_CONFIG.LEVEL_VALUES.LOW,
            effortLabels.length - 1
        )
    );
    
    const selectedLabel = effortLabels[valueIndex];
    effortDisplay.textContent = selectedLabel.charAt(0).toUpperCase() + selectedLabel.slice(1);
    
    // Update slider accessibility attributes
    slider.setAttribute('aria-valuenow', slider.value);
    slider.setAttribute('aria-valuetext', selectedLabel);
}

/**
 * Updates UI elements based on selected model capabilities
 * @param {string} model - The selected model identifier
 */
export async function updateModelSpecificUI(model) {
    const modelConfig = await getModelSettings();
    const reasoningControls = document.getElementById('reasoning-controls');
    const streamingToggle = document.getElementById('streaming-toggle');

    // Toggle reasoning controls with null safety
    const requiresEffort = modelConfig.capabilities?.requires_reasoning_effort ?? true;
    if (reasoningControls) {
        reasoningControls.style.display = requiresEffort ? 'block' : 'none';
    }
        
    // Toggle streaming availability with null safety
    if (streamingToggle) {
        streamingToggle.disabled = !(modelConfig.capabilities?.supports_streaming ?? false);
    }
    
    // Update temperature display
    const tempElement = document.getElementById('temperature-value');
    if (tempElement && modelConfig.capabilities?.default_temperature !== undefined) {
        tempElement.textContent = modelConfig.capabilities.default_temperature;
    }
        
    // Update token counter limits
    const maxTokensElement = document.getElementById('max-tokens');
    if (maxTokensElement && modelConfig.capabilities?.max_tokens) {
        maxTokensElement.dataset.max = modelConfig.capabilities.max_tokens;
    }
}

/**
 * Switches between tabs in the UI
 * @param {string} tabId - The ID of the tab to switch to
 */
export function switchTab(tabId) {
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

/**
 * Checks and returns model capabilities with safe defaults
 * @param {Object} modelConfig - The model configuration object
 * @returns {Object} Object containing model capabilities with safe defaults
 */
export function checkModelCapabilities(modelConfig) {
    return {
        supportsStreaming: modelConfig.capabilities?.supports_streaming ?? false,
        supportsVision: modelConfig.capabilities?.supports_vision ?? false,
        requiresReasoning: modelConfig.capabilities?.requires_reasoning_effort ?? true,
        maxTokens: modelConfig.capabilities?.max_tokens ?? 4096,
        temperature: modelConfig.capabilities?.fixed_temperature,
        isO1Series: modelConfig.name.includes('o1')
    };
}
