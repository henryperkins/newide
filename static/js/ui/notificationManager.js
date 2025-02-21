export default class NotificationManager {
    constructor() {
        this.container = document.createElement('div');
        this.container.className = 'notification-container';
        document.body.appendChild(this.container);
    }

    show(message, type = 'info', duration = 3000) {
        try {
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.textContent = message;
            notification.setAttribute('role', 'alert');
            notification.setAttribute('aria-live', 'polite');
            
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

// Named export
export function showNotification(message, type = 'info', duration = 3000) {
    new NotificationManager().show(message, type, duration);
}
