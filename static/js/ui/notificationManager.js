// notificationManager.js
// Enhanced notification and error handling system

let typingState = {
  active: false,
  element: null,
  timeoutId: null,
  animationFrame: null
};

const INDICATOR_TIMEOUT = 30000; // 30s fallback
const MODAL_CONTAINER = document.getElementById('modal-container');
const MODAL_CONTENT = document.getElementById('modal-content');

// Track recent notifications to prevent duplicates
const recentNotifications = new Set();
const NOTIFICATION_DEDUP_WINDOW = 2000; // 2 seconds

/**
 * Centralized application-level error handler
 * @param {Error} error - The error object
 * @param {string} context - Context where the error occurred
 */
export function handleApplicationError(error, context = 'application') {
  console.error(`${context} error:`, error);

  // Centralized error classification
  const errorData = classifyError(error);
  
  // For severe errors, show a modal dialog
  if (errorData.severity === 'severe') {
    showErrorModal(errorData.title, errorData.message, errorData.actions);
  } else {
    // For non-severe errors, show a notification
    showNotification(errorData.message, 'error', errorData.duration || 10000);
  }
}

/**
 * Specialized error handler for chat messages with improved UX.
 * 
 * @param {Error} error - The error that occurred
 */
export async function handleMessageError(error) {
  console.error('[handleMessageError]', error);
  
  // Remove typing indicator if it's still showing
  removeTypingIndicator();
  
  // Classify and extract structured error data
  const errorData = await extractErrorData(error);
  
  // Rate limit errors - offer retry with backoff
  if (errorData.type === 'rate_limit') {
    handleRateLimitError(errorData);
    return;
  }
  
  // Timeout errors - offer guidance on reasoning settings
  if (errorData.type === 'timeout') {
    handleTimeoutError(errorData);
    return;
  }
  
  // Authentication errors - provide login prompt
  if (errorData.type === 'auth') {
    handleAuthError(errorData);
    return;
  }
  
  // For other errors, show general error message with actionable advice
  showNotification(errorData.message || 'An unexpected error occurred', 'error', 8000);
}

/**
 * Shows a floating notification message with improved design and accessibility.
 * 
 * @param {string} message - The message to display
 * @param {string} type - Notification type (info, success, warning, error)
 * @param {number} duration - Milliseconds to show the notification
 * @param {Array} actions - Optional array of action buttons
 */
export function showNotification(message, type = 'info', duration = 5000, actions = []) {
  // Skip duplicate notifications within the deduplication window
  const notificationKey = `${type}:${message}`;
  if (recentNotifications.has(notificationKey)) {
    console.debug('Skipping duplicate notification:', message);
    return;
  }
  
  // Add to recent notifications and remove after the window
  recentNotifications.add(notificationKey);
  setTimeout(() => {
    recentNotifications.delete(notificationKey);
  }, NOTIFICATION_DEDUP_WINDOW);
  
  // Create container if it doesn't exist
  const container = document.getElementById('notification-container') || createNotificationContainer();
  
  // Check for duplicate notifications already showing the same message
  const existingNotifications = container.querySelectorAll('.notification');
  
  // Skip if the same message is already being shown
  for (const existing of existingNotifications) {
    const existingText = existing.querySelector('p')?.textContent;
    if (existingText === message) {
      console.debug('Skipping duplicate notification:', message);
      return;
    }
  }
  
  const notification = createNotificationElement(message, type, actions);
  container.appendChild(notification);

  // Provide haptic feedback on supported devices
  if (navigator.vibrate && (type === 'error' || type === 'warning')) {
    navigator.vibrate(type === 'error' ? [100, 50, 100] : [50]);
  }

  // Announce to screen readers
  const ariaLive = type === 'error' ? 'assertive' : 'polite';
  notification.setAttribute('aria-live', ariaLive);

  // Trigger CSS animation
  requestAnimationFrame(() => {
    // Animate in
    notification.classList.add('opacity-100', 'translate-y-0');
    notification.classList.remove('opacity-0', 'translate-y-4');
  });

  // Set unique ID for notification
  const notificationId = `notification-${Date.now()}`;
  notification.id = notificationId;

  // Remove after duration, if specified
  if (duration > 0) {
    setTimeout(() => {
      removeNotification(notificationId);
    }, duration);
  }

  return notificationId;
}

/**
 * Remove a specific notification by ID
 * 
 * @param {string} id - The notification ID to remove
 */
export function removeNotification(id) {
  const notification = document.getElementById(id);
  if (notification) {
    notification.classList.remove('opacity-100', 'translate-y-0');
    notification.classList.add('opacity-0', 'translate-y-4');
    setTimeout(() => notification.remove(), 300);
  }
}

/**
 * Displays a modal dialog for critical errors or confirmations
 * 
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {Array} actions - Array of {label, action, variant} objects
 */
export function showErrorModal(title, message, actions = []) {
  if (!MODAL_CONTAINER || !MODAL_CONTENT) return;
  
  MODAL_CONTENT.innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-semibold text-dark-900 dark:text-dark-100 mb-2">${title}</h3>
      <p class="text-dark-700 dark:text-dark-300">${message}</p>
      
      <div class="flex justify-end space-x-3 mt-6">
        ${actions.map(action => `
          <button class="btn ${action.variant || 'btn-secondary'}">${action.label}</button>
        `).join('')}
        ${actions.length === 0 ? '<button class="btn btn-primary">Dismiss</button>' : ''}
      </div>
    </div>
  `;
  
  // Add event listeners to buttons
  const buttons = MODAL_CONTENT.querySelectorAll('button');
  buttons.forEach((button, index) => {
    if (actions[index] && actions[index].action) {
      button.addEventListener('click', () => {
        hideModal();
        actions[index].action();
      });
    } else {
      button.addEventListener('click', hideModal);
    }
  });
  
  // Show the modal
  MODAL_CONTAINER.classList.remove('hidden');
  
  // Focus the first button for keyboard accessibility
  if (buttons.length > 0) {
    buttons[0].focus();
  }
}

/**
 * Hide the modal dialog
 */
export function hideModal() {
  if (MODAL_CONTAINER) {
    MODAL_CONTAINER.classList.add('hidden');
  }
}

/**
 * Show a dialog to confirm an action
 * 
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {Function} onConfirm - Function to call when confirmed
 * @param {Function} onCancel - Function to call when cancelled
 */
export function showConfirmDialog(title, message, onConfirm, onCancel) {
  const actions = [
    {
      label: 'Cancel',
      variant: 'btn-secondary',
      action: onCancel || (() => {})
    },
    {
      label: 'Confirm',
      variant: 'btn-primary',
      action: onConfirm
    }
  ];
  
  showErrorModal(title, message, actions);
}

/**
 * Displays a "typing..." indicator in the chat UI with improved animation
 * and accessibility.
 */
export function showTypingIndicator() {
  if (typingState.active) return;

  // Create element
  const indicator = document.createElement('div');
  // Use consistent classes
  indicator.className = 'flex items-center space-x-1 opacity-0 transition-opacity duration-300 my-2';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.innerHTML = `
    <div class="flex items-center space-x-1 bg-dark-100 dark:bg-dark-800 py-2 px-3 rounded-md">
      <span class="h-2 w-2 rounded-full bg-primary-500 dark:bg-primary-400 animate-pulse"></span>
      <span class="h-2 w-2 rounded-full bg-primary-500 dark:bg-primary-400 animate-pulse delay-75"></span>
      <span class="h-2 w-2 rounded-full bg-primary-500 dark:bg-primary-400 animate-pulse delay-150"></span>
      <span class="ml-2 text-xs text-dark-500 dark:text-dark-400">Generating response...</span>
      <span class="sr-only">AI is generating response</span>
    </div>
  `;

  // State management
  typingState = {
    active: true,
    element: indicator,
    timeoutId: setTimeout(() => {
      console.warn('Typing indicator timeout');
      removeTypingIndicator();
      showNotification('The response is taking longer than expected. The model may be busy.', 'warning');
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
      if (typingState.element && typingState.element.parentNode) {
        typingState.element.parentNode.removeChild(typingState.element);
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

/**
 * Safely enables interactive elements like buttons with proper error handling
 * @param {string} elementId - The ID of the element to enable
 * @param {Function} clickHandler - The function to call when the element is clicked
 */
export function enableInteractiveElement(elementId, clickHandler) {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`Element not found: ${elementId}`);
      return false;
    }
    
    // Remove any existing click listeners to prevent duplicates
    const newElement = element.cloneNode(true);
    element.parentNode.replaceChild(newElement, element);
    
    // Add the click handler
    newElement.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        clickHandler(e);
      } catch (error) {
        console.error(`Error in click handler for ${elementId}:`, error);
        showNotification(`An error occurred: ${error.message}`, 'error');
      }
    });
    
    // Also handle Enter key for accessibility
    newElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        try {
          clickHandler(e);
        } catch (error) {
          console.error(`Error in keydown handler for ${elementId}:`, error);
          showNotification(`An error occurred: ${error.message}`, 'error');
        }
      }
    });
    
    // Ensure the element is not disabled
    newElement.disabled = false;
    
    // Add visual feedback for touch devices
    newElement.addEventListener('touchstart', () => {
      newElement.classList.add('active');
    }, { passive: true });
    
    newElement.addEventListener('touchend', () => {
      newElement.classList.remove('active');
    }, { passive: true });
    
    return true;
  } catch (error) {
    console.error(`Failed to enable interactive element ${elementId}:`, error);
    return false;
  }
}

/* ---------- Private Helper Functions ---------- */

/**
 * Creates notification container if it doesn't exist
 * @returns {HTMLElement} The notification container
 */
function createNotificationContainer() {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'fixed right-4 top-4 z-50 flex flex-col gap-2 max-w-md';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Creates a notification element with proper styling and icon.
 * @param {string} message - The message to display
 * @param {string} type - Notification type (info, success, warning, error)
 * @param {Array} actions - Optional array of action buttons
 * @returns {HTMLElement} The notification element
 */
function createNotificationElement(message, type, actions) {
  const typeData = getNotificationTypeData(type);
  const notification = document.createElement('div');
  notification.className = `notification flex items-start p-4 mb-2 rounded-lg shadow-lg border transition-all duration-300 transform opacity-0 translate-y-4 ${typeData.bgClass} ${typeData.borderClass} ${typeData.textClass}`;
  
  notification.innerHTML = `
    <div class="flex-1 flex items-center gap-2">
      ${typeData.icon}
      <p class="text-sm font-medium">${message}</p>
      <div class="actions mt-2 flex gap-2"></div>
    </div>
    <button class="ml-3 text-gray-400 hover:text-gray-600" aria-label="Close notification">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    </button>
  `;
  
  // Add action buttons if provided
  if (actions && actions.length) {
    const actionsContainer = notification.querySelector('.actions');
    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = 'text-sm px-2 py-1 rounded bg-white border shadow-sm hover:bg-gray-50';
      btn.textContent = action.label;
      btn.onclick = action.onClick;
      actionsContainer.appendChild(btn);
    });
  }
  
  // Add close button event
  const closeBtn = notification.querySelector('button');
  closeBtn.addEventListener('click', () => removeNotification(notification.id));
  
  return notification;
}

/**
 * Returns styling and icon data based on notification type.
 * @param {string} type - Notification type (info, success, warning, error)
 * @returns {Object} An object containing bgClass, borderClass, textClass, and icon HTML.
 */
function getNotificationTypeData(type) {
  switch (type) {
    case 'success':
      return {
        bgClass: 'bg-green-50',
        borderClass: 'border-green-200',
        textClass: 'text-green-800',
        icon: '<svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 10-1.414-1.414L9 10.586l-1.293-1.293a1 1 0 10-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>'
      };
    case 'error':
      return {
        bgClass: 'bg-red-50',
        borderClass: 'border-red-200',
        textClass: 'text-red-800',
        icon: '<svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>'
      };
    case 'warning':
      return {
        bgClass: 'bg-yellow-50',
        borderClass: 'border-yellow-200',
        textClass: 'text-yellow-800',
        icon: '<svg class="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>'
      };
    default: // info
      return {
        bgClass: 'bg-blue-50',
        borderClass: 'border-blue-200',
        textClass: 'text-blue-800',
        icon: '<svg class="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9zM9 5a1 1 0 112 0 1 1 0 01-2 0z" clip-rule="evenodd"></path></svg>'
      };
  }
}

/**
 * Classify and normalize errors for consistent user experience.
 * @param {Error} error - The error to classify
 * @return {Object} Structured error data
 */
function classifyError(error) {
  const errorData = {
    type: 'unknown',
    severity: 'normal',
    title: 'Error',
    message: 'An unexpected error occurred',
    duration: 8000,
    actions: []
  };
  
  // Check for network errors
  if (error.name === 'NetworkError' || error.message.includes('network') || error.message.includes('Failed to fetch')) {
    errorData.type = 'network';
    errorData.severity = 'normal';
    errorData.title = 'Network Error';
    errorData.message = 'Unable to connect to the server. Please check your internet connection.';
    errorData.actions = [
      {
        label: 'Retry',
        variant: 'btn-primary',
        action: () => window.location.reload()
      }
    ];
    return errorData;
  }
  
  // Check for timeout errors
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message.includes('timeout')) {
    errorData.type = 'timeout';
    errorData.severity = 'normal';
    errorData.title = 'Request Timeout';
    errorData.message = 'The request took too long to complete. Try adjusting reasoning effort or using a simpler prompt.';
    return errorData;
  }
  
  // Check for authentication errors
  if (error.status === 401 || error.status === 403 || error.message.includes('authentication') || error.message.includes('unauthorized')) {
    errorData.type = 'auth';
    errorData.severity = 'severe';
    errorData.title = 'Authentication Error';
    errorData.message = 'Your session has expired or you are not authorized to access this resource.';
    errorData.actions = [
      {
        label: 'Login',
        variant: 'btn-primary',
        action: () => window.location.href = '/login'
      }
    ];
    return errorData;
  }
  
  // Check for rate limit errors
  if (error.status === 429 || error.message.includes('rate limit') || error.message.includes('too many requests')) {
    errorData.type = 'rate_limit';
    errorData.severity = 'normal';
    errorData.title = 'Rate Limit Exceeded';
    errorData.message = 'You have exceeded the rate limit. Please wait a moment and try again.';
    return errorData;
  }
  
  // If none of the above, try to extract information from the error object
  if (error.message) {
    errorData.message = error.message;
  }
  
  if (error.name) {
    errorData.title = error.name;
  }
  
  return errorData;
}

/**
 * Extract structured error data from a response error.
 * @param {Error|Response} error - The error object or response
 * @return {Promise<Object>} Structured error data
 */
async function extractErrorData(error) {
  let errorData = {
    type: 'unknown',
    message: 'An unexpected error occurred',
    status: null,
    retryAfter: null
  };
  
  try {
    // If error is a Response object
    if (error.status && error.json) {
      errorData.status = error.status;
      
      // Check for rate limiting headers
      const retryAfter = error.headers.get('retry-after');
      if (retryAfter) {
        errorData.retryAfter = parseInt(retryAfter, 10);
      }
      
      try {
        const data = await error.json();
        if (data.error) {
          errorData.message = data.error.message || data.error;
        } else if (data.message) {
          errorData.message = data.message;
        }
      } catch (e) {
        const text = await error.text();
        errorData.message = text.slice(0, 200);
      }
      
      if (error.status === 429) {
        errorData.type = 'rate_limit';
      } else if (error.status === 401 || error.status === 403) {
        errorData.type = 'auth';
      } else if (error.status === 404) {
        errorData.type = 'not_found';
      } else if (error.status >= 500) {
        errorData.type = 'server';
      }
    } 
    // If error is a DOMException (e.g., AbortError)
    else if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        errorData.type = 'timeout';
        errorData.message = 'Request was aborted due to timeout. Try reducing reasoning effort or simplifying your request.';
      }
    }
    // General Error object
    else if (error instanceof Error) {
      errorData.message = error.message;
      if (error.message.includes('timeout') || error.message.includes('exceeded time limit')) {
        errorData.type = 'timeout';
      } else if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorData.type = 'rate_limit';
      }
    }
  } catch (e) {
    console.error('Error parsing error data:', e);
  }
  
  return errorData;
}

/**
 * Handle rate limit errors with retry functionality.
 * @param {Object} errorData - Structured error data 
 */
function handleRateLimitError(errorData) {
  const retryDelay = errorData.retryAfter || 5;
  
  const actions = [
    {
      label: `Retry in ${retryDelay}s`,
      variant: 'btn-primary',
      onClick: (e) => {
        const button = e.target;
        button.disabled = true;
        button.textContent = 'Retrying...';
        
        setTimeout(() => {
          if (window.sendMessage) {
            window.sendMessage();
          }
          const notification = button.closest('.notification');
          if (notification) {
            notification.remove();
          }
        }, retryDelay * 1000);
      }
    }
  ];
  
  showNotification(
    errorData.message || 'Rate limit exceeded. Please wait before trying again.',
    'warning',
    0, // Don't auto-dismiss
    actions
  );
}

/**
 * Handle timeout errors with helpful suggestions.
 * @param {Object} errorData - Structured error data
 */
function handleTimeoutError(errorData) {
  const actions = [
    {
      label: 'Reduce Reasoning',
      variant: 'btn-secondary',
      onClick: (e) => {
        const slider = document.getElementById('reasoning-effort-slider');
        if (slider) {
          slider.value = Math.max(1, parseInt(slider.value, 10) - 1);
          slider.dispatchEvent(new Event('input'));
        }
        
        const configTab = document.getElementById('config-tab');
        if (configTab) {
          configTab.click();
        }
        
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('translate-x-full')) {
          const sidebarToggle = document.getElementById('sidebar-toggle');
          if (sidebarToggle) {
            sidebarToggle.click();
          }
        }
        
        const notification = e.target.closest('.notification');
        if (notification) {
          notification.remove();
        }
      }
    },
    {
      label: 'Try Again',
      variant: 'btn-primary',
      onClick: (e) => {
        if (window.sendMessage) {
          window.sendMessage();
        }
        const notification = e.target.closest('.notification');
        if (notification) {
          notification.remove();
        }
      }
    }
  ];
  
  showNotification(
    errorData.message || 'The request timed out. Try reducing reasoning effort or simplifying your message.',
    'warning',
    0, // Don't auto-dismiss
    actions
  );
}

/**
 * Handle authentication errors.
 * @param {Object} errorData - Structured error data
 */
function handleAuthError(errorData) {
  showErrorModal(
    'Authentication Required',
    errorData.message || 'Please log in to continue.',
    [
      {
        label: 'Cancel',
        variant: 'btn-secondary',
        action: () => {}
      },
      {
        label: 'Login',
        variant: 'btn-primary',
        action: () => {
          window.location.href = '/login';
        }
      }
    ]
  );
}
