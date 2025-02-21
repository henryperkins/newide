/* static/js/config.js */

const fallbackConfig = {
    reasoningEffort: "medium",
    developerConfig: "Formatting re-enabled - use markdown code blocks",
    includeFiles: false,
    selectedModel: "o1"
};

/**
 * Get current application configuration from server
 * @returns {Object} Validated configuration object
 */
let cachedConfig = null;
let lastFetchTime = 0;

export async function getCurrentConfig() {
    try {
        // Cache config for 5 minutes
        if (!cachedConfig || Date.now() - lastFetchTime > 300000) {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Config load failed');
            cachedConfig = { ...fallbackConfig, ...await response.json() };
            lastFetchTime = Date.now();
        }
        return cachedConfig;
    } catch (error) {
        console.error('Using fallback config:', error);
        return fallbackConfig;
    }
}

export async function updateConfig(key, value) {
    const response = await fetch(`/api/config/${key}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ value })
    });
    return response.ok;
}


/**
 * Get timeout durations for different reasoning levels
 * @returns {Object} Timeouts in milliseconds for low/medium/high effort
 */
export function getTimeoutDurations() {
    return {
        low: 15000,    // 15 seconds
        medium: 30000, // 30 seconds
        high: 60000    // 60 seconds
    };
}

import { MODEL_CONFIG } from './models.js';

// Returns current model settings from centralized config
export function getModelSettings() {
    const config = getCurrentConfig();
    return MODEL_CONFIG[config.selectedModel] || MODEL_CONFIG["deepseek-r1"];
}

// Get safety configuration for current model
export function getSafetyConfig() {
    const modelConfig = getModelSettings();
    return modelConfig.safety_config || {};
}

// Get response formatting tags
export function getResponseFormatting() {
    const modelConfig = getModelSettings();
    return modelConfig.response_format || {};
}

// Update UI display for reasoning effort selection
export function updateReasoningEffortDisplay() {
    const slider = document.getElementById('reasoning-effort-slider');
    const effortDisplay = document.getElementById('reasoning-effort-display');
    if (!slider || !effortDisplay) return;

    const effortLevels = ['low', 'medium', 'high'];
    const selectedEffort = effortLevels[slider.value - 1];
    effortDisplay.textContent = selectedEffort.charAt(0).toUpperCase() + selectedEffort.slice(1);
}
