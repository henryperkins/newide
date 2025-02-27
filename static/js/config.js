/* static/js/config.js */

import { modelManager } from './models.js';

const fallbackConfig = {
    reasoningEffort: "medium",
    developerConfig: "Formatting re-enabled - use markdown code blocks",
    includeFiles: false,
    selectedModel: "o1hp",
    deploymentName: "o1hp",
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

/**
 * Get the current configuration from the server
 */
export async function getCurrentConfig() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`Failed to load config: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading config:', error);
        return {
            selectedModel: 'o1hp',
            reasoningEffort: 'medium'
        };
    }
}

/**
 * Initialize config-related UI elements
 */
export async function initializeConfig() {
    try {
        const appConfig = await getCurrentConfig();
        updateReasoningEffortDisplay();
        await updateModelSpecificUI(appConfig.selectedModel);

        // Attach a change listener to the model-select dropdown
        const modelSelectEl = document.getElementById('model-select');
        if (modelSelectEl) {
            modelSelectEl.addEventListener('change', async (e) => {
                const newModel = e.target.value;

                // Use ModelManager to switch model
                const success = await modelManager.switchModel(newModel);

                if (!success) {
                    // Revert to previous selection if switch failed
                    modelSelectEl.value = appConfig.selectedModel;
                    console.error('Failed to switch model, reverting selection');
                }
            });
        }
    } catch (error) {
        console.error('Failed to initialize UI elements:', error);
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


// Add methods to get model configurations
export async function getModelConfigurations() {
    try {
        const response = await fetch('/api/config/models');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching model configurations:', error);
        return {};
    }
}

export async function getModelConfiguration(modelId) {
    try {
        const response = await fetch(`/api/config/models/${modelId}`);
        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching configuration for model ${modelId}:`, error);
        return null;
    }
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
            name: "o1hp",
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

/**
 * Update the reasoning effort display based on slider value
 */
function updateReasoningEffortDisplay() {
    const slider = document.getElementById('reasoning-effort-slider');
    const display = document.getElementById('reasoning-effort-display');
    const description = document.getElementById('effort-description-text');

    if (slider && display) {
        const updateDisplay = () => {
            const value = parseInt(slider.value);
            let text, desc;

            switch (value) {
                case 1:
                    text = 'Low';
                    desc = 'Low: Faster responses (30-60s) with less depth';
                    break;
                case 3:
                    text = 'High';
                    desc = 'High: Thorough processing (4-7min) for complex problems';
                    break;
                default:
                    text = 'Medium';
                    desc = 'Medium: Balanced processing time (1-3min) and quality';
            }

            display.textContent = text;
            if (description) description.textContent = desc;
        };

        updateDisplay();
        slider.addEventListener('input', updateDisplay);
    }
}

/**
 * Update model-specific UI elements based on the selected model
 */
export async function updateModelSpecificUI(modelName) {
    try {
        // Normalize model name for case-insensitive comparison
        const normalizedModelName = modelName.toLowerCase();
        
        // Find the model in configurations (case-insensitive)
        const matchingModelId = Object.keys(modelManager.modelConfigs).find(
            id => id.toLowerCase() === normalizedModelName
        );
        
        // If model not found, create it based on known types
        if (!matchingModelId) {
            console.log(`Model ${modelName} not found in configurations, attempting to create it`);
            
            // Special handling for o1hp model
            if (normalizedModelName === "o1hp") {
                console.log("Creating o1hp model configuration");
                
                // Create o1hp model configuration based on documentation
                const o1Model = {
                    name: "o1hp",
                    description: "Advanced reasoning model for complex tasks",
                    azure_endpoint: "https://aoai-east-2272068338224.cognitiveservices.azure.com",
                    api_version: "2025-01-01-preview",
                    max_tokens: 200000, // Based on o1 documentation (input context window)
                    max_completion_tokens: 5000,
                    supports_temperature: false, // o1 doesn't support temperature
                    supports_streaming: false, // o1 doesn't support streaming (only o3-mini does)
                    supports_vision: true, // o1 supports vision
                    requires_reasoning_effort: true, // o1 supports reasoning effort
                    reasoning_effort: "medium",
                    base_timeout: 120.0,
                    max_timeout: 300.0,
                    token_factor: 0.05
                };
                
                // Add the model to modelConfigs
                modelManager.modelConfigs["o1hp"] = o1Model;
                console.log("Created o1hp model configuration:", o1Model);
            }
            // Special handling for DeepSeek-R1 model
            else if (normalizedModelName === "deepseek-r1" || normalizedModelName === "deepseek_r1") {
                console.log("Creating DeepSeek-R1 model configuration");
                
                // Create DeepSeek-R1 model configuration based on documentation
                const deepseekModel = {
                    name: "DeepSeek-R1",
                    description: "Model that supports chain-of-thought reasoning with <think> tags",
                    azure_endpoint: "https://DeepSeek-R1D2.eastus2.models.ai.azure.com",
                    api_version: "2024-05-01-preview",
                    max_tokens: 32000,
                    supports_temperature: true,
                    supports_streaming: true,
                    supports_json_response: false,
                    base_timeout: 120.0,
                    max_timeout: 300.0,
                    token_factor: 0.05
                };
                
                // Add the model to modelConfigs
                modelManager.modelConfigs["DeepSeek-R1"] = deepseekModel;
                console.log("Created DeepSeek-R1 model configuration:", deepseekModel);
            }
        }
        
        // Use the matching model ID with correct case, or fall back to the original
        const actualModelName = matchingModelId || modelName;
        
        // Check if model exists in configurations after potential creation
        if (!modelManager.modelConfigs[actualModelName]) {
            console.warn(`Model ${modelName} not found in model configurations and could not be created`);
            return; // If we still don't have config, no further updates
        }

        const modelConfig = modelManager.modelConfigs[actualModelName];
        const isOSeries = actualModelName.toLowerCase().startsWith('o1') || actualModelName.toLowerCase().startsWith('o3');

        // Update reasoning controls visibility
        const reasoningControls = document.getElementById('reasoning-controls');
        if (reasoningControls) {
            if (isOSeries) {
                reasoningControls.classList.remove('hidden');
            } else {
                reasoningControls.classList.add('hidden');
            }
        }

        // Update streaming toggle based on model capability
        const streamingToggle = document.getElementById('enable-streaming');
        if (streamingToggle) {
            streamingToggle.disabled = !modelConfig.supports_streaming;
            if (!modelConfig.supports_streaming) {
                streamingToggle.checked = false;
            }
        }

        // Update model info text
        const modelInfoSection = document.querySelector('.hidden.md\\:block.text-sm.text-gray-600');
        if (modelInfoSection) {
            const modelFeatures = [];
            if (isOSeries) modelFeatures.push('advanced reasoning');
            if (modelConfig.supports_streaming) modelFeatures.push('streaming');
            if (modelConfig.supports_vision) modelFeatures.push('vision');

            const featuresText = modelFeatures.length > 0 ? `with ${modelFeatures.join(' & ')}` : '';

            modelInfoSection.innerHTML = `
                <p><strong>Model Info:</strong> Using ${actualModelName} model ${featuresText}</p>
            `;
        }

        // Update any other UI elements that depend on model configuration
    } catch (error) {
        console.error('Error updating model-specific UI:', error);
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

// Initialize config when DOM is ready
document.addEventListener('DOMContentLoaded', initializeConfig);
