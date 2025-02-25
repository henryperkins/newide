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
        errorMessage = await error.response.text();
      }
    } catch (parseError) {
      console.error('[handleMessageError] Error parsing error response:', parseError);
    }
  } else if (error.message) {
    errorMessage = error.message;
  }

  const fullErrorText = [errorMessage, ...errorDetails].filter(Boolean).join('\n');
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
    // Animate in
    notification.classList.add('translate-x-0', 'opacity-100');
    notification.classList.remove('translate-x-full', 'opacity-0');
  });

  // Remove after duration
  setTimeout(() => {
    notification.classList.remove('translate-x-0', 'opacity-100');
    notification.classList.add('translate-x-full', 'opacity-0');
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
  // Tailwind classes for fade-in/out transitions
  indicator.className = 'flex items-center space-x-1 opacity-0 transition-opacity duration-300 my-2';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.innerHTML = `
    <div class="flex items-center space-x-1">
      <span class="h-2 w-2 rounded-full bg-gray-500 dark:bg-gray-400 animate-pulse"></span>
      <span class="h-2 w-2 rounded-full bg-gray-500 dark:bg-gray-400 animate-pulse delay-75"></span>
      <span class="h-2 w-2 rounded-full bg-gray-500 dark:bg-gray-400 animate-pulse delay-150"></span>
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
        setTimeout(() => {
          indicator.classList.replace('opacity-0', 'opacity-100');
        }, 10);
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
    typingState.element.classList.replace('opacity-100', 'opacity-0');
    setTimeout(() => {
      if (typingState.element) {
        typingState.element.remove();
      }
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
  // Tailwind classes for positioning & spacing
  container.className = 'fixed top-4 right-4 z-50 space-y-2 pointer-events-none';
  document.body.appendChild(container);
  return container;
}

function createNotificationElement(message, type) {
  const notification = document.createElement('div');

  // Base notification styles
  // transform translate-x-full: Hide off screen initially
  // opacity-0: Hidden for fade in
  // transition-all: Animate the translate & opacity
  // pointer-events-auto: Let the user interact to close
  let baseClasses = 'max-w-sm bg-white dark:bg-gray-800 shadow-lg rounded-lg pointer-events-auto transform translate-x-full opacity-0 transition-all duration-300 ease-in-out flex';

  // Type-specific styles
  let typeClasses = '';
  let icon = '';

  switch (type) {
    case 'success':
      typeClasses = 'border-l-4 border-green-500 dark:border-green-400';
      icon = '<svg class="w-5 h-5 text-green-500 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 10-1.414-1.414L9 10.586l-1.293-1.293a1 1 0 10-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>';
      break;
    case 'error':
      typeClasses = 'border-l-4 border-red-500 dark:border-red-400';
      icon = '<svg class="w-5 h-5 text-red-500 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>';
      break;
    case 'warning':
      typeClasses = 'border-l-4 border-yellow-500 dark:border-yellow-400';
      icon = '<svg class="w-5 h-5 text-yellow-500 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>';
      break;
    default: // info
      typeClasses = 'border-l-4 border-blue-500 dark:border-blue-400';
      icon = '<svg class="w-5 h-5 text-blue-500 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9zM9 5a1 1 0 112 0 1 1 0 01-2 0z" clip-rule="evenodd"></path></svg>';
      break;
  }

  notification.className = `${baseClasses} ${typeClasses}`;
  notification.setAttribute('role', 'alert');

  notification.innerHTML = `
    <div class="p-3 flex items-start">
      <div class="flex-shrink-0">${icon}</div>
      <div class="ml-3 flex-1">
        <p class="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">${message}</p>
      </div>
      <button class="ml-3 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded">
        <span class="sr-only">Close</span>
        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 
            8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 
            10l4.293 4.293a1 1 0 01-1.414 1.414L10 
            11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 
            10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      </button>
    </div>
  `;

  // Add close button functionality
  const closeButton = notification.querySelector('button');
  closeButton.addEventListener('click', () => {
    notification.classList.remove('translate-x-0', 'opacity-100');
    notification.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => notification.remove(), 300);
  });

  return notification;
}