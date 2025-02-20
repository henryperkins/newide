import { showNotification } from '../ui/notificationManager.js';

// Configuration state and utilities
const effortMap = ['low', 'medium', 'high'];
const descMap = [
    'Low: Faster responses (30-60s) with basic reasoning. Best for simple queries.',
    'Medium: Balanced processing time (1-3min) and quality. Suitable for most queries.',
    'High: Extended reasoning (2-5min) for complex problems. Expect longer wait times.'
];

export function initializeConfig() {
    const slider = document.getElementById('reasoning-effort-slider');
    if (!slider) {
        showNotification('Missing configuration elements in DOM', 'error');
        return;
    }

    // Set initial values
    slider.value = 0;
    updateReasoningEffortDisplay();

    // Set up event listeners
    slider.addEventListener('input', updateReasoningEffortDisplay);
    console.log("Configuration system initialized");
}

export function updateReasoningEffortDisplay() {
    const slider = document.getElementById('reasoning-effort-slider');
    const effortDisplay = document.getElementById('effort-display');
    const descriptionText = document.getElementById('effort-description-text');

    if (!slider || !effortDisplay || !descriptionText) {
        console.error("Missing configuration DOM elements");
        return;
    }

    const value = parseInt(slider.value);
    effortDisplay.textContent = ['Low', 'Medium', 'High'][value];
    descriptionText.textContent = descMap[value];
}

export function getCurrentConfig() {
    return {
        reasoningEffort: getReasoningEffort(),
        developerConfig: getDeveloperConfig(),
        modelSettings: getModelSettings()
    };
}

export function getReasoningEffort() {
    const slider = document.getElementById('reasoning-effort-slider');
    return effortMap[slider?.value || 0];
}

export function getDeveloperConfig() {
    const configEl = document.getElementById('developer-config');
    return configEl?.value.trim() || '';
}

export function getModelSettings() {
    return {
        supportsVision: window.modelName?.includes('o1') || false,
        supportsStreaming: window.modelName?.includes('o3-mini') || false
    };
}

export function getTimeoutDurations() {
    return {
        low: 120000,    // 2 minutes
        medium: 240000, // 4 minutes
        high: 360000    // 6 minutes
    };
}
