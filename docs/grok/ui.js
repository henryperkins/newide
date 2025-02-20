// ui.js
export function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), duration);
}

export function switchTab(tabId) {
    const targetButton = document.querySelector(`[data-target-tab="${tabId}"]`);
    const targetContent = document.getElementById(tabId);
    if (targetButton && targetContent) {
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        targetButton.classList.add('active');
        targetContent.classList.add('active');
    }
}

export function updateReasoningEffortDescription() {
    const slider = document.getElementById('reasoning-effort-slider');
    const effortDisplay = document.getElementById('effort-display');
    const descMap = [
        'Low: Faster responses (30-60s).',
        'Medium: Balanced (1-3min).',
        'High: Extended reasoning (2-5min).'
    ];
    effortDisplay.textContent = ['Low', 'Medium', 'High'][slider.value];
    document.getElementById('effort-description-text').textContent = descMap[slider.value];
}

export function showTypingIndicator(reasoningEffort = 'medium') {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant-message typing-indicator';
    typingDiv.innerHTML = `<div>Typing...</div>`;
    document.getElementById('chat-history').appendChild(typingDiv);
}

export function removeTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) indicator.remove();
}

export function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (dropZone && fileInput) {
        dropZone.addEventListener('dragover', e => e.preventDefault());
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            handleFileUpload(e.dataTransfer.files[0]);
        });
    }
}