/* static/js/config.js */

// getCurrentConfig fetches the app configuration.
// In a real implementation, this could fetch live data from the backend.
export function getCurrentConfig() {
    return {
        reasoningEffort: "medium",
        developerConfig: "",
        // Additional configuration properties can be added here.
    };
}

// Returns timeout durations (in milliseconds) based on reasoning effort.
export function getTimeoutDurations() {
    return {
        low: 15000,
        medium: 30000,
        high: 60000
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
