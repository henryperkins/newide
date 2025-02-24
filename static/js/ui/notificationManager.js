// notificationManager.js

/**
 * Manages user-facing notifications, typing indicators, and global error handling.
 */

let typingState = {
    active: false,
    element: null,
    timeoutId: null,
    animationFrame: null
  };
  
  const INDICATOR_TIMEOUT = 30000; // 30s fallback
  
  /**
   * Unified application-level error handler
   * @param {Error} error
   * @param {string} context
   */
  export function handleApplicationError(error, context = 'application') {
    console.error(`${context} error:`, error);
  
    let errorMessage = 'An unexpected error occurred';
    let duration = 10000;
  
    if (error.name === 'AbortError') {
      errorMessage = 'Request timed out. Consider using a lower reasoning effort.';
    } else if (error.message) {
      errorMessage = error.message;
    }
  
    showNotification(`Failed to ${context}: ${errorMessage}`, 'error', duration);
  
    const chatInterface = document.getElementById('chat-interface');
    const errorDisplay = document.getElementById('error-display');
  
    if (chatInterface) chatInterface.style.display = 'none';
    if (errorDisplay) errorDisplay.style.display = 'block';
  }
  
  /**
   * A more specialized error handler for chat messages.
   * (Originally from chat.js, if you want to unify them.)
   * 
   * @param {Error} error
   */
  export async function handleMessageError(error) {
    console.error('[handleMessageError]', error);
  
    let errorMessage = 'An unexpected error occurred';
    let errorDetails = [];
  
    // Distinguish timeouts/aborts
    if (
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      const reason = error.message || 'Request exceeded time limit';
      errorMessage = `Request was aborted: ${reason}. Try:
  1. Reducing reasoning effort
  2. Shortening your message
  3. Breaking your request into smaller parts
  4. The request will retry up to 3 times with exponential backoff`;
    } else if (error.response) {
      try {
        const contentType = error.response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const apiError = await error.response.json();
          errorMessage = apiError.error?.message || error.message;
          if (apiError.error?.details) {
            errorDetails.push(...apiError.error.details);
          }
        } else {
          // If the server returned something non-JSON
          errorMessage = await error.response.text();
        }
      } catch (parseError) {
        console.error('[handleMessageError] Error parsing error response:', parseError);
      }
    } else if (error.message) {
      errorMessage = error.message;
    }
  
    const fullErrorText = [errorMessage, ...errorDetails].filter(Boolean).join('\n');
  
    // Show the error text to the user
    showNotification(fullErrorText, 'error');
  }
  
  /**
   * Shows a floating notification message to the user.
   * 
   * @param {string} message - The message to display
   * @param {string} type - The type of notification (info, success, warning, error)
   * @param {number} duration - Milliseconds to show it
   */
  export function showNotification(message, type = 'info', duration = 5000) {
    const container =
      document.getElementById('notification-container') || createNotificationContainer();
    const notification = createNotificationElement(message, type);
  
    container.appendChild(notification);
  
    // Trigger CSS transition
    requestAnimationFrame(() => {
      notification.classList.add('show');
    });
  
    // Remove after duration
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }
  
  /**
   * Displays a "typing..." indicator in the chat UI
   * to show that a response is being generated.
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
   * Removes typing indicator with a fade-out transition.
   */
  export function removeTypingIndicator() {
    if (!typingState.active) return;
  
    clearTimeout(typingState.timeoutId);
    cancelAnimationFrame(typingState.animationFrame);
  
    if (typingState.element) {
      typingState.element.classList.add('fading-out');
      setTimeout(() => {
        typingState.element.remove();
        typingState = {
          active: false,
          element: null,
          timeoutId: null,
          animationFrame: null
        };
      }, 300);
    }
  }
  
  /* ---------- Private Helpers ---------- */
  
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
      case 'success':
        return '✓';
      case 'error':
        return '⚠';
      case 'warning':
        return '!';
      default:
        return 'ℹ';
    }
  }
  