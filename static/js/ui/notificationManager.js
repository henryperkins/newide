export function showNotification(message, type = 'info', duration = 5000) {
    const container = ensureNotificationContainer();
    const notification = createNotificationElement(message, type);
    
    container.appendChild(notification);
    animateNotificationEntrance(notification);
    scheduleNotificationDismissal(notification, duration);
}

export function showTypingIndicator(reasoningEffort = 'medium') {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant-message typing-indicator';
    
    typingDiv.innerHTML = `
        <div class="dots-container">
            ${Array(3).fill().map((_, i) => 
                `<span style="animation-delay: ${i * 0.15}s"></span>`
            ).join('')}
        </div>
        <div class="typing-time-info">
            <small>Processing with ${reasoningEffort} reasoning (est. ${getTimeEstimate(reasoningEffort)})</small>
        </div>
    `;

    document.getElementById('chat-history').appendChild(typingDiv);
    typingDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    injectTypingStyles();
}

export function removeTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) indicator.remove();
}

// Helper functions
function ensureNotificationContainer() {
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
    return container;
}

function createNotificationElement(message, type) {
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${icons[type] || icons.info}</span>
        <span class="notification-message">${message}</span>
        <button class="notification-close">×</button>
    `;

    notification.querySelector('.notification-close').onclick = () => {
        animateNotificationDismissal(notification);
    };

    return notification;
}

function animateNotificationEntrance(notification) {
    requestAnimationFrame(() => {
        notification.style.transform = 'translateX(0)';
        notification.style.opacity = '1';
    });
}

function scheduleNotificationDismissal(notification, duration) {
    setTimeout(() => {
        animateNotificationDismissal(notification);
    }, duration);
}

function animateNotificationDismissal(notification) {
    notification.style.transform = 'translateX(100%)';
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
}

function getTimeEstimate(effort) {
    return {
        high: '2-5 minutes',
        medium: '1-3 minutes',
        low: '30-60 seconds'
    }[effort] || '1-3 minutes';
}

function injectTypingStyles() {
    if (document.getElementById('typing-styles')) return;

    const style = document.createElement('style');
    style.id = 'typing-styles';
    style.textContent = `
        .typing-indicator {
            opacity: 0.7;
            padding: 1rem;
            margin: 0.5rem 0;
        }
        .dots-container span {
            display: inline-block;
            width: 8px;
            height: 8px;
            margin-right: 3px;
            background: #3b82f6;
            border-radius: 50%;
            animation: dot-pulse 1.4s infinite;
        }
        @keyframes dot-pulse {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }
        .typing-time-info {
            color: #6b7280;
            margin-top: 0.5rem;
            font-size: 0.9em;
        }
    `;
    document.head.appendChild(style);
}
