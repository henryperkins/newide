import { showNotification } from '/static/js/ui/notificationManager.js';

let config = {
    reasoningEffort: 1, // Default to medium
    developerConfig: ''
};

export function initializeConfig() {
    setupEffortSlider();
    setupDeveloperConfig();
}

export function getConfig() {
    return { ...config };
}

function setupEffortSlider() {
    const slider = document.getElementById('reasoning-effort-slider');
    const display = document.getElementById('effort-display');
    const description = document.getElementById('effort-description-text');
    
    // Set initial display
    updateEffortDisplay(slider.value);
    
    slider.addEventListener('input', (e) => {
        updateEffortDisplay(e.target.value);
    });
    
    slider.addEventListener('change', (e) => {
        const value = parseInt(e.target.value);
        config.reasoningEffort = value;
        showNotification('Reasoning effort updated', 'info');
    });
}

function updateEffortDisplay(value) {
    const display = document.getElementById('effort-display');
    const description = document.getElementById('effort-description-text');
    
    const efforts = ['Low', 'Medium', 'High'];
    const descriptions = [
        'Low: Faster processing (30-60s) but may miss nuances.',
        'Medium: Balanced processing time (1-3min) and quality. Suitable for most queries.',
        'High: Thorough processing (3-5min) for complex tasks.'
    ];
    
    display.textContent = efforts[value];
    description.textContent = descriptions[value];
}

function setupDeveloperConfig() {
    const input = document.getElementById('developer-config');
    
    // Set initial value
    config.developerConfig = input.value;
    
    input.addEventListener('change', (e) => {
        config.developerConfig = e.target.value;
        showNotification('Developer configuration updated', 'info');
    });
}
