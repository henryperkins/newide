/* static/js/config.js */

// getCurrentConfig fetches the app configuration.
// In a real implementation, this could fetch live data from the backend.
export function initializeConfig() {
    // Configuration initialization logic
    console.log('Config system initialized');
    return { initialized: true }; // Add return value
}

/**
 * Get current application configuration with validation
 * @returns {Object} Validated configuration object
 */
export function getCurrentConfig() {
    // Get stored configuration from localStorage
    const storedConfig = localStorage.getItem('appConfig');
    const defaultConfig = {
        reasoningEffort: "medium",
        developerConfig: "Formatting re-enabled - use markdown code blocks",
        includeFiles: false,
        selectedModel: "o1" // Default model
    };

    // Merge stored config with defaults
    const config = storedConfig ? 
        {...defaultConfig, ...JSON.parse(storedConfig)} :
        defaultConfig;

    // Validate and ensure required fields
    if (!['low', 'medium', 'high'].includes(config.reasoningEffort)) {
        console.warn('Invalid reasoning effort, defaulting to medium');
        config.reasoningEffort = 'medium';
    }
    
    return config;
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

// Returns current model settings.
// In production, these settings should be loaded from the backend capabilities endpoint.
export function getModelSettings() {
    return {
        name: "default",
        capabilities: {
            supports_streaming: true,
            supports_vision: false,
            max_tokens: 4096,
            api_version: "2023-12-01"
        }
    };
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
