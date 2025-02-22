/* static/js/config.js */

const fallbackConfig = {
    reasoningEffort: "medium",
    developerConfig: "Formatting re-enabled - use markdown code blocks",
    includeFiles: false,
    selectedModel: "o1model-east2", 
    deploymentName: "o1model-east2",
    azureOpenAI: {
        apiKey: "",  // Will be populated from server response
        endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
        deploymentName: "o1hp",
        apiVersion: "2025-01-01-preview"
    }
};

let cachedConfig = null;
let lastFetchTime = 0;

const REASONING_EFFORT_CONFIG = Object.freeze({
    SLIDER_ID: 'reasoning-effort-slider',
    DISPLAY_ID: 'reasoning-effort-display',
    LEVEL_VALUES: Object.freeze({
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3
    })
});

function getValidatedElement(elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn(`UI Element not found: ${elementId}`);
        return null;
    }
    return element;
}

export async function initializeConfig() {
    try {
        const appConfig = await getCurrentConfig();
        updateReasoningEffortDisplay();
        await updateModelSpecificUI(appConfig.selectedModel);
    } catch (error) {
        console.error('Failed to initialize UI elements:', error);
    }
}

export async function getCurrentConfig() {
    try {
        if (!cachedConfig?.azureOpenAI?.apiKey || Date.now() - lastFetchTime > 300000) {
            console.debug('Fetching config from /api/config/');
            const response = await fetch('/api/config/');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const responseData = await response.json();
            cachedConfig = { ...fallbackConfig, ...responseData };
            lastFetchTime = Date.now();
        }
        return cachedConfig;
    } catch (error) {
        console.error('Using fallback config. Error details:', error);
        return fallbackConfig;
    }
}

export async function updateConfig(key, value) {
    // Handle bulk updates if an object is passed
    if (typeof key === 'object' && key !== null) {
        const updates = key;
        let allSuccess = true;
        
        for (const [k, v] of Object.entries(updates)) {
            try {
                if (typeof k !== 'string' || !k.trim()) {
                    console.error('updateConfig: Invalid config key in bulk update:', k);
                    allSuccess = false;
                    continue;
                }
                
                // Format value based on config key
                let formattedValue = v;
                if (k === 'reasoningEffort') {
                    formattedValue = String(v).toLowerCase();
                    if (!['low', 'medium', 'high'].includes(formattedValue)) {
                        throw new Error('reasoningEffort must be one of: low, medium, high');
                    }
                } else if (k === 'includeFiles') {
                    formattedValue = Boolean(v);
                } else if (k === 'selectedModel' || k === 'developerConfig') {
                    formattedValue = String(v);
                }
                
                const response = await fetch(`/api/config/${k}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        value: formattedValue,
                        description: '',
                        is_secret: false
                    })
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail || 'Failed to update config');
                }
            } catch (error) {
                console.error('Failed to update config key:', k, error);
                allSuccess = false;
            }
        }
        return allSuccess;
    }

    // Single key update logic
    try {
        if (typeof key !== 'string' || !key.trim()) {
            throw new Error('Invalid config key');
        }

        // Format value based on config key
        let formattedValue = value;
        if (key === 'reasoningEffort') {
            formattedValue = String(value).toLowerCase();
            if (!['low', 'medium', 'high'].includes(formattedValue)) {
                throw new Error('reasoningEffort must be one of: low, medium, high');
            }
        } else if (key === 'includeFiles') {
            formattedValue = Boolean(value);
        } else if (key === 'selectedModel' || key === 'developerConfig') {
            formattedValue = String(value);
        }
        
        const response = await fetch(`/api/config/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                value: formattedValue,
                description: '',
                is_secret: false
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update config');
        }
        
        return true;
    } catch (error) {
        console.error('Failed to update config:', error);
        return false;
    }
}

export async function getTimeoutDurations() {
    const modelConfig = await getModelSettings();
    const isDeepSeek = modelConfig.name.includes('DeepSeek');

    // DeepSeek models need longer timeouts due to reasoning complexity
    if (isDeepSeek) {
        return {
            low: 30000,     // 30s
            medium: 60000,  // 60s
            high: 120000    // 120s
        };
    }

    // Standard timeouts for other models
    return {
        low: 15000,    // 15s
        medium: 30000, // 30s
        high: 60000    // 60s
    };
}

export async function getModelSettings() {
    try {
        const current = await getCurrentConfig();
        return {
            name: current.selectedModel,
            api_version: current.azureOpenAI.apiVersion,
            capabilities: {
                requires_reasoning_effort: true,
                supports_streaming: current.supportsStreaming,
                supports_vision: current.supportsVision,
                max_completion_tokens: current.maxCompletionTokens,
                fixed_temperature: current.fixedTemperature
            }
        };
    } catch (error) {
        console.error('Failed to get model settings:', error);
        return {
            name: "o1model-east2",
            api_version: "2025-01-01-preview",
            capabilities: {
                requires_reasoning_effort: true,
                supports_streaming: false,
                supports_vision: false,
                max_completion_tokens: 4096,
                fixed_temperature: 0.7
            }
        };
    }
}

export async function getSafetyConfig() {
    const modelCfg = await getModelSettings();
    return modelCfg.safety_config || {};
}

export async function getResponseFormatting() {
    const modelCfg = await getModelSettings();
    return modelCfg.response_format || {};
}

export function updateReasoningEffortDisplay() {
    const slider = getValidatedElement(REASONING_EFFORT_CONFIG.SLIDER_ID);
    const effortDisplay = getValidatedElement(REASONING_EFFORT_CONFIG.DISPLAY_ID);

    if (!slider || !effortDisplay) {
        console.error('Reasoning effort UI elements missing');
        if (effortDisplay) effortDisplay.textContent = 'Medium';
        return;
    }

    const minValue = Math.min(...Object.values(REASONING_EFFORT_CONFIG.LEVEL_VALUES));
    const maxValue = Math.max(...Object.values(REASONING_EFFORT_CONFIG.LEVEL_VALUES));
    const clampedValue = Math.max(minValue, Math.min(maxValue, parseInt(slider.value, 10)));
    if (clampedValue !== parseInt(slider.value, 10)) {
        slider.value = clampedValue;
    }

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

    effortDisplay.textContent =
        selectedLabel.charAt(0).toUpperCase() + selectedLabel.slice(1);

    slider.setAttribute('aria-valuenow', slider.value);
    slider.setAttribute('aria-valuetext', selectedLabel);
}

export async function updateModelSpecificUI(model) {
    const modelCfg = await getModelSettings();
    const reasoningControls = document.getElementById('reasoning-controls');
    const streamingToggle = document.getElementById('streaming-toggle');

    const requiresEffort = modelCfg.capabilities?.requires_reasoning_effort ?? true;
    if (reasoningControls) {
        reasoningControls.style.display = requiresEffort ? 'block' : 'none';
    }

    if (streamingToggle) {
        streamingToggle.disabled = !(modelCfg.capabilities?.supports_streaming ?? false);
    }
}

export function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
        button.setAttribute('aria-selected', 'false');
    });

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

export const config = {
    azureOpenAI: {
        apiKey: "",  // Will be populated from server response
        endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
        deploymentName: "o1hp",
        apiVersion: "2025-01-01-preview"
    },
    appSettings: {
        maxTokenLimit: 4096,
        responseTimeout: 30000,
        enableTelemetry: true
    }
};

export const CONFIG_VERSION = '1.0.0';
