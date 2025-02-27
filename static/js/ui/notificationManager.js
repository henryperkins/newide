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
  const container = document.getElementById('notification-container') || createNotificationContainer();
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

/* ---------- Private Helpers ---------- */

function createNotificationContainer() {
  const container = document.createElement('div');
  container.id = 'notification-container';
  container.className = 'fixed top-4 right-4 z-50 space-y-2 flex flex-col items-end pointer-events-none max-w-sm w-full px-4 sm:px-0';
  container.setAttribute('role', 'log');
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
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

function createNotificationElement(message, type, actions = []) {
  const notification = document.createElement('div');

  // Base notification styling
  notification.className = `notification transform translate-y-4 opacity-0 transition-all duration-300 pointer-events-auto w-full`;

  // Type-specific icons and styling
  const typeData = getNotificationTypeData(type);
  
  notification.innerHTML = `
    <div class="p-3 flex items-start border-l-4 ${typeData.borderClass}">
      <div class="flex-shrink-0">
        ${typeData.icon}
      </div>
      <div class="ml-3 flex-1">
        <p class="text-sm text-dark-800 dark:text-dark-200 whitespace-pre-line">${message}</p>
        ${actions.length > 0 ? 
          `<div class="mt-2 flex space-x-2">
            ${actions.map(action => 
              `<button class="btn btn-sm ${action.variant || 'btn-secondary'}">${action.label}</button>`
            ).join('')}
          </div>` 
          : ''}
      </div>
      <button class="ml-3 text-dark-400 hover:text-dark-500 dark:hover:text-dark-300 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded">
        <span class="sr-only">Close</span>
        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      </button>
    </div>
  `;

  // Add action button event listeners
  if (actions.length > 0) {
    const actionButtons = notification.querySelectorAll('.btn');
    actionButtons.forEach((button, index) => {
      if (actions[index] && actions[index].onClick) {
        button.addEventListener('click', actions[index].onClick);
      }
    });
  }

  // Add close button functionality
  const closeButton = notification.querySelector('button:last-child');
  closeButton.addEventListener('click', () => {
    notification.classList.remove('opacity-100', 'translate-y-0');
    notification.classList.add('opacity-0', 'translate-y-4');
    setTimeout(() => notification.remove(), 300);
  });

  return notification;
}

function getNotificationTypeData(type) {
  switch (type) {
    case 'success':
      return {
        borderClass: 'border-success-500 dark:border-success-700',
        icon: '<svg class="w-5 h-5 text-success-500 dark:text-success-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 10-1.414-1.414L9 10.586l-1.293-1.293a1 1 0 10-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>'
      };
    case 'error':
      return {
        borderClass: 'border-error-500 dark:border-error-700',
        icon: '<svg class="w-5 h-5 text-error-500 dark:text-error-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>'
      };
    case 'warning':
      return {
        borderClass: 'border-warning-500 dark:border-warning-700',
        icon: '<svg class="w-5 h-5 text-warning-500 dark:text-warning-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>'
      };
    default: // info
      return {
        borderClass: 'border-primary-500 dark:border-primary-700',
        icon: '<svg class="w-5 h-5 text-primary-500 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9zM9 5a1 1 0 112 0 1 1 0 01-2 0z" clip-rule="evenodd"></path></svg>'
      };
  }
}

/**
 * Classify and normalize errors for consistent user experience
 * @param {Error} error - The error to classify
 * @return {Object} Structured error data
 */
function classifyError(error) {
  // Default error data
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
 * Extract structured error data from a response error
 * 
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
        // Try to parse JSON body
        const data = await error.json();
        if (data.error) {
          errorData.message = data.error.message || data.error;
        } else if (data.message) {
          errorData.message = data.message;
        }
      } catch (e) {
        // Not JSON, try text
        const text = await error.text();
        errorData.message = text.slice(0, 200); // Limit length
      }
      
      // Determine error type
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
      
      // Try to classify from message text
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
 * Handle rate limit errors with retry functionality
 * 
 * @param {Object} errorData - Structured error data 
 */
function handleRateLimitError(errorData) {
  const retryDelay = errorData.retryAfter || 5;
  
  const actions = [
    {
      label: `Retry in ${retryDelay}s`,
      variant: 'btn-primary',
      onClick: () => {
        const button = event.target;
        button.disabled = true;
        button.textContent = 'Retrying...';
        
        setTimeout(() => {
          if (window.sendMessage) {
            window.sendMessage();
          }
          // Remove notification after triggering retry
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
 * Handle timeout errors with helpful suggestions
 * 
 * @param {Object} errorData - Structured error data
 */
function handleTimeoutError(errorData) {
  const actions = [
    {
      label: 'Reduce Reasoning',
      variant: 'btn-secondary',
      onClick: () => {
        // Lower reasoning effort setting
        const slider = document.getElementById('reasoning-effort-slider');
        if (slider) {
          slider.value = Math.max(1, parseInt(slider.value, 10) - 1);
          // Trigger change event to update UI
          slider.dispatchEvent(new Event('input'));
        }
        
        // Switch to sidebar config tab
        const configTab = document.getElementById('config-tab');
        if (configTab) {
          configTab.click();
        }
        
        // Show sidebar if hidden on mobile
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('translate-x-full')) {
          const sidebarToggle = document.getElementById('sidebar-toggle');
          if (sidebarToggle) {
            sidebarToggle.click();
          }
        }
        
        // Remove notification
        const notification = event.target.closest('.notification');
        if (notification) {
          notification.remove();
        }
      }
    },
    {
      label: 'Try Again',
      variant: 'btn-primary',
      onClick: () => {
        if (window.sendMessage) {
          window.sendMessage();
        }
        // Remove notification
        const notification = event.target.closest('.notification');
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
 * Handle authentication errors
 * 
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
