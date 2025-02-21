export class NotificationManager {
    constructor() {
        this.container = document.createElement('div');
        this.container.className = 'notification-container';
        document.body.appendChild(this.container);
    }

    show(message, type = 'info', duration = 3000, actions = null) {
        try {
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.innerHTML = `
                <div class="notification-message">${message}</div>
                ${actions ? `<div class="notification-actions">
                    ${actions.map(a => `<button class="notification-action">${a.label}</button>`).join('')}
                </div>` : ''}
            `;
            notification.setAttribute('role', 'alert');
            notification.setAttribute('aria-live', 'polite');

            if (actions) {
                notification.querySelectorAll('.notification-action').forEach((button, index) => {
                    button.addEventListener('click', () => {
                        notification.remove();
                        actions[index].action();
                    });
                });
            }
            
            this.container.appendChild(notification);
            setTimeout(() => {
                try {
                    notification.remove();
                } catch (e) {
                    console.error('Error removing notification:', e);
                }
            }, duration);
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }
}

// Named exports
export function showNotification(message, type = 'info', duration = 3000) {
    new NotificationManager().show(message, type, duration);
}

export function removeTypingIndicator() {
    const indicators = document.querySelectorAll('.typing-indicator');
    indicators.forEach(indicator => indicator.remove());
}

export function showTypingIndicator(effortLevel = 'medium') {
    const existing = document.querySelector('.typing-indicator');
    if (existing) existing.remove();

    const typingIndicator = document.createElement('div');
    typingIndicator.className = `typing-indicator ${effortLevel}`;
    typingIndicator.setAttribute('aria-live', 'polite');
    typingIndicator.innerHTML = `
        <div class="dots-container">
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
        </div>
        <span class="effort-text">${effortLevel} reasoning effort</span>
    `;

    const notificationManager = new NotificationManager();
    notificationManager.container.prepend(typingIndicator);
    
    return typingIndicator;
}
