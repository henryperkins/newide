/**
 * Centralized error handling for the application
 * @param {Error} error - The error object to handle
 * @param {string} context - Context where the error occurred
 */
export function handleApplicationError(error, context = 'application') {
    console.error(`${context} error:`, error);
    
    let errorMessage = "An unexpected error occurred";
    let duration = 10000;

    if (error.name === "AbortError") {
        errorMessage = "Request timed out. Consider using lower reasoning effort.";
    } else if (error.message) {
        errorMessage = error.message;
    }

    showNotification(
        `Failed to ${context}: ${errorMessage}`,
        "error",
        duration
    );

    const chatInterface = document.getElementById('chat-interface');
    const errorDisplay = document.getElementById('error-display');
    
    if (chatInterface) chatInterface.style.display = 'none';
    if (errorDisplay) errorDisplay.style.display = 'block';
}

/**
 * Shows a notification message to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of notification (info, success, warning, error)
 * @param {number} duration - How long to show the notification in milliseconds
 */
export function showNotification(message, type = 'info', duration = 5000) {
    const container = document.getElementById('notification-container') || createNotificationContainer();
    const notification = createNotificationElement(message, type);
    
    container.appendChild(notification);
    
    // Trigger animation
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });
    
    // Remove after duration
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

let typingState = {
    active: false,
    element: null,
    timeoutId: null,
    animationFrame: null
};

const INDICATOR_TIMEOUT = 30000; // 30s safety timeout

/**
 * Shows the typing indicator with state management and accessibility
 */
export function showTypingIndicator() {
    if (typingState.active) return;
    
    // Create element
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.innerHTML = `
        <div class="typing-content">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="sr-only">AI is generating response...</span>
        </div>
    `;

    // State management
    typingState = {
        active: true,
        element: indicator,
        timeoutId: setTimeout(() => {
            console.warn('Typing indicator timeout');
            removeTypingIndicator();
        }, INDICATOR_TIMEOUT),
        animationFrame: requestAnimationFrame(() => {
            const chatHistory = document.getElementById('chat-history');
            if (chatHistory) {
                chatHistory.appendChild(indicator);
                indicator.classList.add('visible');
                indicator.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
        })
    };
}

/**
 * Removes typing indicator with cleanup and smooth transition
 */
export function removeTypingIndicator() {
    if (!typingState.active) return;

    // Cleanup
    clearTimeout(typingState.timeoutId);
    cancelAnimationFrame(typingState.animationFrame);

    if (typingState.element) {
        // Animated removal
        typingState.element.classList.add('fading-out');
        
        setTimeout(() => {
            typingState.element.remove();
            typingState = {
                active: false,
                element: null,
                timeoutId: null,
                animationFrame: null
            };
        }, 300); // Match CSS transition duration
    }
}

// Private helper functions

function createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    document.body.appendChild(container);
    return container;
}

function createNotificationElement(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.setAttribute('role', 'alert');
    
    // Add icon based on type
    const icon = getNotificationIcon(type);
    
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${icon}</span>
            <span class="notification-message">${message}</span>
        </div>
    `;
    
    return notification;
}

function getNotificationIcon(type) {
    switch (type) {
        case 'success': return '✓';
        case 'error': return '⚠';
        case 'warning': return '!';
        default: return 'ℹ';
    }
}
