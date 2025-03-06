class NotificationStack {
  constructor() {
    this.notifications = [];
    this.container = null;
  }
  
  addNotification(notification) {
    this.notifications.push(notification);
    if (!this.container) {
      this.container = document.getElementById('notification-container') || createNotificationContainer();
    }
    this.container.appendChild(notification);
  }
  
  removeNotification(id) {
    const notification = document.getElementById(id);
    if (notification) {
      notification.classList.remove('opacity-100', 'translate-y-0');
      notification.classList.add('opacity-0', 'translate-y-4');
      setTimeout(() => notification.remove(), 300);
      this.notifications = this.notifications.filter(n => n.id !== id);
    }
  }
}

const typingStates = new WeakMap(); // Use WeakMap for automatic cleanup
let typingInstanceId = 0;

const TYPING_INDICATOR_Z_INDEX = 60; // Above modals (50) and sidebar (50)
const FADE_DURATION = 300; // Match CSS transition duration

// Increase timeout to 2 minutes (120s) to accommodate longer model responses
const INDICATOR_TIMEOUT = 120000; // Changed from 30000 (30s) to 120000 (120s)
const MODAL_CONTAINER = document.getElementById('modal-container');
const MODAL_CONTENT = document.getElementById('modal-content');
const recentNotifications = new Map();
const NOTIFICATION_DEDUP_WINDOW = 5000;

export function handleApplicationError(error, context = 'application') {
  console.error(`${context} error:`, error);
  const errorData = classifyError(error);
  if (errorData.severity === 'severe') {
    showErrorModal(errorData.title, errorData.message, errorData.actions);
  } else {
    showNotification(errorData.message, 'error', errorData.duration || 10000);
  }
}

export async function handleMessageError(error) {
  console.error('[handleMessageError]', error);
  // removeTypingIndicator();  // Removed to rely on state-managed logic
  
  // Check if this error has already been processed (to prevent duplicates)
  if (error.hasBeenProcessed) {
    console.log('[handleMessageError] Skipping already processed error:', error.message);
    return;
  }
  
  // Mark this error as processed to prevent duplicates
  error.hasBeenProcessed = true;
  
  let errorData;
  try {
    errorData = await extractErrorData(error);
    
    // Add unique error ID if not already present
    if (!errorData.errorId && !error.errorId) {
      errorData.errorId = `error-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    } else if (error.errorId) {
      errorData.errorId = error.errorId;
    }
    
    // Log more details about server errors
    if (errorData.type === 'server' || error.message?.includes('500')) {
      console.error('[handleMessageError] Server error details:', {
        message: error.message,
        status: errorData.status,
        errorType: errorData.type,
        errorDetails: errorData.message,
        errorId: errorData.errorId
      });
    }
    
    // Track handled error IDs in session storage to prevent duplicates across handlers
    const handledErrors = JSON.parse(sessionStorage.getItem('handled_errors') || '[]');
    if (handledErrors.includes(errorData.errorId)) {
      console.log(`[handleMessageError] Error ${errorData.errorId} already handled, skipping`);
      return;
    }
    handledErrors.push(errorData.errorId);
    sessionStorage.setItem('handled_errors', JSON.stringify(handledErrors.slice(-20))); // Keep last 20
    
    // Handle specific error types
    if (errorData.type === 'rate_limit') {
      handleRateLimitError(errorData);
      return;
    }
    if (errorData.type === 'timeout') {
      handleTimeoutError(errorData);
      return;
    }
    if (errorData.type === 'auth') {
      handleAuthError(errorData);
      return;
    }
    if (errorData.type === 'server') {
      // Use dedicated server error handler
      handleServerError(errorData);
      return;
    }

    // Display detailed error information in a modal
    if (error.message && error.message.includes('Connection failed')) {
      showErrorModal('Connection Error', `
        <p>${error.message}</p>
        <p><strong>Details:</strong></p>
        <ul>
          <li><strong>URL:</strong> ${error.target?.url || 'N/A'}</li>
          <li><strong>Ready State:</strong> ${error.target?.readyState || 'N/A'}</li>
        </ul>
      `, [
        {
          label: 'Retry',
          variant: 'btn-primary',
          action: () => {
            // Safer approach for retry
            const btn = document.createElement('button');
            btn.id = `retry-btn-${errorData.errorId}`;
            btn.style.display = 'none';
            document.body.appendChild(btn);
            btn.addEventListener('click', () => window.location.reload());
            setTimeout(() => btn.click(), 100);
            setTimeout(() => btn.remove(), 500);
          }
        }
      ]);
      return;
    } else if (error.message && error.message.includes('Too Many Requests')) {
      handleRateLimitError(errorData);
      return;
    }

    showNotification(errorData.message || 'An unexpected error occurred', 'error', 8000);
  } catch (parseError) {
    console.error('[handleMessageError] Error parsing error data:', parseError);
    showNotification('An unexpected error occurred while processing the request', 'error', 8000);
  }
}

export function showNotification(message, type = 'info', duration = 5000, actions = []) {
  if (!window.notificationStack) {
    window.notificationStack = new NotificationStack();
  }
  
  // Create a unique hash based on message content and error type for better deduplication
  const messageHash = `${type}:${message.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const now = Date.now();
  
  // Check both key-based and DOM-based duplicates at once
  if (recentNotifications.has(messageHash)) {
    const lastTime = recentNotifications.get(messageHash);
    if (now - lastTime < NOTIFICATION_DEDUP_WINDOW) {
      console.log(`[showNotification] Skipping duplicate notification: ${message.substring(0, 30)}...`);
      return;
    }
  }
  
  // Check and deduplicate similar messages by normalizing and comparing content
  const container = document.getElementById('notification-container') || createNotificationContainer();
  const normalizedMessage = message.trim().toLowerCase().replace(/\s+/g, ' ');
  
  for (const existing of container.querySelectorAll('.notification')) {
    const existingText = existing.querySelector('p')?.textContent || '';
    const existingNormalized = existingText.trim().toLowerCase().replace(/\s+/g, ' ');
    
    // If messages are very similar (>80% match) or exact, don't show duplicate
    if (existingNormalized === normalizedMessage || 
        (existingNormalized.length > 10 && 
         (existingNormalized.includes(normalizedMessage) || normalizedMessage.includes(existingNormalized)))) {
      console.log(`[showNotification] Similar notification already visible: ${existingText.substring(0, 30)}...`);
      return;
    }
  }
  
  // Record this notification to prevent duplicates
  recentNotifications.set(messageHash, now);
  
  // Cleanup old notifications to prevent memory leaks
  if (recentNotifications.size > 20) {
    const oldestTime = now - NOTIFICATION_DEDUP_WINDOW;
    recentNotifications.forEach((timestamp, key) => {
      if (timestamp < oldestTime) recentNotifications.delete(key);
    });
  }
  
  const notification = createNotificationElement(message, type, actions);
  const notificationId = `notification-${Date.now()}`;
  notification.id = notificationId;
  container.appendChild(notification);
  
  if (navigator.vibrate && (type === 'error' || type === 'warning')) {
    navigator.vibrate(type === 'error' ? [100, 50, 100] : [50]);
  }
  
  notification.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  requestAnimationFrame(() => {
    notification.classList.add('opacity-100', 'translate-y-0');
    notification.classList.remove('opacity-0', 'translate-y-4');
  });
  
  if (duration > 0) {
    setTimeout(() => removeNotification(notificationId), duration);
  }
  
  return notificationId;
}

export function removeNotification(id) {
  const notification = document.getElementById(id);
  if (notification) {
    notification.classList.remove('opacity-100', 'translate-y-0');
    notification.classList.add('opacity-0', 'translate-y-4');
    setTimeout(() => notification.remove(), 300);
  }
}

export function showErrorModal(title, message, actions = []) {
  if (!MODAL_CONTAINER || !MODAL_CONTENT) return;
  MODAL_CONTENT.innerHTML = `
    <div class="p-6">
      <h3 class="text-lg font-semibold text-dark-900 dark:text-dark-100 mb-2">${title}</h3>
      <p class="text-dark-700 dark:text-dark-300">${message}</p>
      <div class="flex justify-end space-x-3 mt-6">
        ${actions.map(a => `<button class="btn ${a.variant||'btn-secondary'}">${a.label}</button>`).join('')}
        ${actions.length===0?'<button class="btn btn-primary">Dismiss</button>':''}
      </div>
    </div>
  `;
  MODAL_CONTENT.querySelectorAll('button').forEach((button, i) => {
    if (actions[i] && actions[i].action) {
      button.addEventListener('click', () => { hideModal(); actions[i].action(); });
    } else button.addEventListener('click', hideModal);
  });
  MODAL_CONTAINER.classList.remove('hidden');
  const buttons = MODAL_CONTENT.querySelectorAll('button');
  if (buttons.length) buttons[0].focus();
}

export function hideModal() {
  if (MODAL_CONTAINER) MODAL_CONTAINER.classList.add('hidden');
}

export function showConfirmDialog(title, message, onConfirm, onCancel) {
  showErrorModal(title, message, [
    { label: 'Cancel', variant: 'btn-secondary', action: onCancel || (() => {}) },
    { label: 'Confirm', variant: 'btn-primary', action: onConfirm }
  ]);
}

export function showTypingIndicator() {
  const instanceId = ++typingInstanceId;
  const currentState = {
    active: true,
    element: null,
    timeoutId: null,
    animationFrame: null,
    instanceId,
    removed: false
  };

  // Create element with accessibility attributes
  const indicator = document.createElement('div');
  indicator.setAttribute('aria-live', 'polite');
  indicator.setAttribute('aria-busy', 'true');
  indicator.setAttribute('aria-atomic', 'true');
  indicator.setAttribute('role', 'status');
  // Tailwind classes for fade-in/out transitions
  indicator.className = 'flex items-center space-x-1 opacity-0 transition-opacity duration-300 my-2 fixed bottom-4 right-4';
  indicator.style.zIndex = TYPING_INDICATOR_Z_INDEX;
  indicator.dataset.typingIndicator = 'true';
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

  // Track state with instance ID
  currentState.element = indicator;
  currentState.timeoutId = setTimeout(() => {
    console.warn('Typing indicator timeout - response is taking longer than expected');
    if (indicator?.isConnected) {
      const message = document.createElement('small');
      message.className = 'text-xs text-gray-500 ml-2';
      message.textContent = 'Still generating...';
      message.setAttribute('aria-live', 'polite');
      indicator.querySelector('.flex').appendChild(message);
    }
  }, INDICATOR_TIMEOUT);
  
  currentState.animationFrame = requestAnimationFrame(() => {
    try {
      const chatHistory = document.getElementById('chat-history');
      if (chatHistory?.isConnected) {
        chatHistory.appendChild(indicator);
        requestAnimationFrame(() => {
          indicator.classList.replace('opacity-0', 'opacity-100');
        });
        // Sync with chat history aria-live region
        chatHistory.setAttribute('aria-busy', 'true');
      }
    } catch (error) {
      console.error('Error appending typing indicator:', error);
    }
  });
}

export function removeTypingIndicator() {
  const elements = document.querySelectorAll('[data-typing-indicator]');
  elements.forEach(indicator => {
    clearTimeout(indicator._typingTimeout);
    cancelAnimationFrame(indicator._typingAnimationFrame);
    
    indicator.classList.replace('opacity-100', 'opacity-0');
    indicator.setAttribute('aria-busy', 'false');
    
    const cleanup = () => {
      if (indicator.isConnected) {
        indicator.parentNode.removeChild(indicator);
      }
    };
    
    // Use CSS custom property for timing if available
    const fadeDuration = getComputedStyle(document.documentElement)
      .getPropertyValue('--typing-indicator-fade-duration') || FADE_DURATION;
    
    setTimeout(cleanup, parseInt(fadeDuration));
  });

  return elements.length > 0;
}

export function enableInteractiveElement(elementId, clickHandler) {
  try {
    const element = document.getElementById(elementId);
    if (!element) return false;
    
    // Rather than clone and replace (which loses event listeners),
    // directly modify the original element
    element.disabled = false;
    
    // Remove any existing handlers to avoid duplication
    const newElement = element;
    const newHandler = e => {
      e.preventDefault();
      try { clickHandler(e); }
      catch (err) { console.error(`Error in click handler:`, err); showNotification(`An error occurred: ${err.message}`, 'error'); }
    };
    
    // Use custom attribute to track if we've already attached handlers
    if (!element.hasAttribute('data-handler-attached')) {
      newElement.addEventListener('click', newHandler);
      newElement.addEventListener('keydown', e => {
        if (e.key==='Enter' || e.key===' ') {
          e.preventDefault();
          try { clickHandler(e); }
          catch (err) { console.error(`Error in keydown handler:`, err); showNotification(`An error occurred: ${err.message}`, 'error'); }
        }
      });
      newElement.addEventListener('touchstart', () => newElement.classList.add('active'), { passive: true });
      newElement.addEventListener('touchend', () => newElement.classList.remove('active'), { passive: true });
      
      // Mark this element as having handlers attached
      element.setAttribute('data-handler-attached', 'true');
      
      // Ensure the element is visible and has pointer events
      newElement.style.pointerEvents = 'auto';
      newElement.classList.remove('invisible', 'hidden');
    }
    
    return true;
  } catch (error) {
    console.error(`Failed to enable element ${elementId}:`, error);
    return false;
  }
}

function createNotificationContainer() {
  let c = document.getElementById('notification-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'notification-container';
    
    // Use sticky positioning as a fallback for iOS Safari
    const iOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    c.className = iOSSafari 
      ? 'sticky top-4 right-4 z-50 flex flex-col gap-2 max-w-md ml-auto mr-4 pointer-events-none'
      : 'fixed right-4 top-4 z-50 flex flex-col gap-2 max-w-md pointer-events-none';
    
    document.body.appendChild(c);
  }
  return c;
}

function createNotificationElement(message, type, actions) {
  const tData = getNotificationTypeData(type);
  const el = document.createElement('div');
  el.className = `notification flex items-start p-4 mb-2 rounded-lg shadow-lg border transition-all duration-300 transform opacity-0 translate-y-4 ${tData.bgClass} ${tData.borderClass} ${tData.textClass} pointer-events-auto`;
  el.innerHTML = `
    <div class="flex-1 flex items-center gap-2">
      ${tData.icon}
      <p class="text-sm font-medium">${message}</p>
      <div class="actions mt-2 flex gap-2 pointer-events-auto"></div>
    </div>
    <button class="ml-3 text-gray-400 hover:text-gray-600 pointer-events-auto" aria-label="Close notification">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;
  if (actions?.length) {
    const actionsContainer = el.querySelector('.actions');
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'text-sm px-2 py-1 rounded bg-white border shadow-sm hover:bg-gray-50 pointer-events-auto';
      btn.textContent = a.label;
      // Direct event assignment instead of using cloning approach
      btn.addEventListener('click', a.onClick);
      actionsContainer.appendChild(btn);
    });
  }
  const closeBtn = el.querySelector('button[aria-label="Close notification"]');
  closeBtn.addEventListener('click', () => removeNotification(el.id));
  return el;
}

function getNotificationTypeData(type) {
  switch (type) {
    case 'success':
      return {
        bgClass: 'bg-green-50',
        borderClass: 'border-green-200',
        textClass: 'text-green-800',
        icon: '<svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 10-1.414-1.414L9 10.586l-1.293-1.293a1 1 0 10-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>'
      };
    case 'error':
      return {
        bgClass: 'bg-red-50',
        borderClass: 'border-red-200',
        textClass: 'text-red-800',
        icon: '<svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>'
      };
    case 'warning':
      return {
        bgClass: 'bg-yellow-50',
        borderClass: 'border-yellow-200',
        textClass: 'text-yellow-800',
        icon: '<svg class="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>'
      };
    default:
      return {
        bgClass: 'bg-blue-50',
        borderClass: 'border-blue-200',
        textClass: 'text-blue-800',
        icon: '<svg class="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9zM9 5a1 1 0 112 0 1 1 0 01-2 0z" clip-rule="evenodd"/></svg>'
      };
  }
}

function classifyError(error) {
  const errData = {
    type: 'unknown',
    severity: 'normal',
    title: 'Error',
    message: 'An unexpected error occurred',
    duration: 8000,
    actions: []
  };
  if (
    error.name === 'NetworkError' ||
    error.message.includes('network') ||
    error.message.includes('Failed to fetch')
  ) {
    errData.type = 'network';
    errData.title = 'Network Error';
    errData.message = 'Unable to connect. Check internet connection.';
    errData.actions = [
      {
        label: 'Retry',
        variant: 'btn-primary',
        action: () => window.location.reload()
      }
    ];
    return errData;
  }
  if (
    error.name === 'TimeoutError' ||
    error.name === 'AbortError' ||
    error.message.includes('timeout')
  ) {
    errData.type = 'timeout';
    errData.title = 'Request Timeout';
    errData.message = 'The request took too long. Try reducing reasoning effort.';
    return errData;
  }
  if (
    error.status === 401 ||
    error.status === 403 ||
    error.message.includes('authentication') ||
    error.message.includes('unauthorized')
  ) {
    errData.type = 'auth';
    errData.severity = 'severe';
    errData.title = 'Authentication Error';
    errData.message = 'Session expired or not authorized.';
    errData.actions = [
      {
        label: 'Login',
        variant: 'btn-primary',
        action: () => (window.location.href = '/login')
      }
    ];
    return errData;
  }
  if (
    error.status === 429 ||
    error.message.includes('rate limit') ||
    error.message.includes('too many requests')
  ) {
    errData.type = 'rate_limit';
    errData.title = 'Rate Limit Exceeded';
    errData.message = 'Rate limit exceeded. Please wait and try again.';
    return errData;
  }
  if (error.message) errData.message = error.message;
  if (error.name) errData.title = error.name;
  return errData;
}

async function extractErrorData(error) {
  let data = { type: 'unknown', message: 'An unexpected error occurred', status: null, retryAfter: null };
  try {
    console.log('[extractErrorData] Processing error:', error);
    
    // Handle Response-like objects with status code
    if (error.status && (error.json || error.text)) {
      data.status = error.status;
      const retryAfter = error.headers?.get ? error.headers.get('retry-after') : null;
      if (retryAfter) data.retryAfter = parseInt(retryAfter, 10);
      
      try {
        // Try to get JSON content first
        if (typeof error.json === 'function') {
          const json = await error.json();
          console.log('[extractErrorData] Parsed JSON error:', json);
          
          if (json.error) {
            if (typeof json.error === 'string') {
              data.message = json.error;
            } else if (typeof json.error === 'object') {
              data.message = json.error.message || json.error.toString();
              // Extract additional details if present
              if (json.error.code) data.code = json.error.code;
              if (json.error.details) data.details = json.error.details;
            }
          } else if (json.message) {
            data.message = json.message;
          }
        }
      } catch (jsonError) {
        console.warn('[extractErrorData] Failed to parse JSON:', jsonError);
        // If JSON parsing fails, try to get text content
        try {
          if (typeof error.text === 'function') {
            const text = await error.text();
            data.message = text.slice(0, 200);
            console.log('[extractErrorData] Parsed text error:', data.message);
          }
        } catch (textError) {
          console.warn('[extractErrorData] Failed to extract error text:', textError);
        }
      }
      
      // Set appropriate error type based on status code
      if (error.status === 429) data.type = 'rate_limit';
      else if (error.status === 401 || error.status === 403) data.type = 'auth';
      else if (error.status === 404) data.type = 'not_found';
      else if (error.status >= 500) data.type = 'server';
    }
    // Handle regular Error objects including API errors in the message
    else if (error instanceof Error) {
      data.message = error.message;
      
      // Extract status code from API error messages like "API error: 500"
      const statusMatch = error.message.match(/API error: (\d+)/);
      if (statusMatch && statusMatch[1]) {
        const status = parseInt(statusMatch[1], 10);
        data.status = status;
        
        if (status === 429) data.type = 'rate_limit';
        else if (status === 401 || 403) data.type = 'auth';
        else if (status === 404) data.type = 'not_found';
        else if (status >= 500) {
          data.type = 'server';
          console.log('[extractErrorData] Identified server error from message');
        }
      }
      // Classify based on error message content if no status code found
      else if (error.message.includes('timeout')) data.type = 'timeout';
      else if (error.message.includes('rate limit') || error.message.includes('429')) data.type = 'rate_limit';
      else if (error.message.includes('500') || error.message.includes('server error')) {
        data.type = 'server';
        console.log('[extractErrorData] Identified server error from text content');
      }
    }
    // Handle DOM exceptions like AbortError
    else if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        data.type = 'timeout';
        data.message = 'Request aborted or timed out.';
      }
    }
    
    console.log('[extractErrorData] Final processed error data:', data);
  } catch (e) {
    console.error('[extractErrorData] Error while processing error:', e);
  }
  
  return data;
}

function handleRateLimitError(errorData) {
  const retryDelay = errorData.retryAfter || 5;
  const actions = [
    {
      label: `Retry in ${retryDelay}s`,
      variant: 'btn-primary',
      onClick: e => {
        e.target.disabled = true;
        e.target.textContent = 'Retrying...';
        setTimeout(() => {
          window.sendMessage?.();
          e.target.closest('.notification')?.remove();
        }, retryDelay * 1000);
      }
    }
  ];
  showNotification(errorData.message || 'Rate limit exceeded.', 'warning', 0, actions);
}

function handleTimeoutError(errorData) {
  const actions = [
    {
      label: 'Reduce Reasoning',
      variant: 'btn-secondary',
      onClick: e => {
        const slider = document.getElementById('reasoning-effort-slider');
        if (slider) {
          slider.value = Math.max(1, parseInt(slider.value, 10) - 1);
          slider.dispatchEvent(new Event('input'));
        }
        const configTab = document.getElementById('config-tab');
        if (configTab) configTab.click();
        const sidebar = document.getElementById('sidebar');
        if (sidebar?.classList.contains('translate-x-full')) {
          document.getElementById('sidebar-toggle')?.click();
        }
        e.target.closest('.notification')?.remove();
      }
    },
    {
      label: 'Try Again',
      variant: 'btn-primary',
      onClick: e => {
        window.sendMessage?.();
        e.target.closest('.notification')?.remove();
      }
    }
  ];
  showNotification(errorData.message || 'Request timed out.', 'warning', 0, actions);
}

function handleServerError(errorData) {
  // Get the current model name if available
  const modelSelect = document.getElementById('model-select');
  const currentModel = modelSelect?.value || 'unknown';
  
  const actions = [
    {
      label: 'Try Different Model',
      variant: 'btn-secondary',
      onClick: e => {
        // If we have a model select and there are other options
        if (modelSelect && modelSelect.options.length > 1) {
          // Select a different model
          let currentIndex = modelSelect.selectedIndex;
          let newIndex = (currentIndex + 1) % modelSelect.options.length;
          modelSelect.selectedIndex = newIndex;
          modelSelect.dispatchEvent(new Event('change'));
          
          // Show notification about model change
          const newModel = modelSelect.options[newIndex].value;
          showNotification(`Switched to ${newModel} model`, 'info', 3000);
        }
        e.target.closest('.notification')?.remove();
      }
    },
    {
      label: 'Try Again',
      variant: 'btn-primary',
      onClick: e => {
        window.sendMessage?.();
        e.target.closest('.notification')?.remove();
      }
    }
  ];
  
  // Provide a more helpful message for server errors
  const message = errorData.message && !errorData.message.includes("API error")
    ? errorData.message
    : `Server error occurred with model: ${currentModel}. This might be due to temporary issues with the model service. Please try again or switch to a different model.`;
  
  showNotification(message, 'error', 0, actions);
}

function handleAuthError(errorData) {
  showErrorModal('Authentication Required', errorData.message || 'Please log in.', [
    { label: 'Cancel', variant: 'btn-secondary', action: () => {} },
    {
      label: 'Login',
      variant: 'btn-primary',
      action: () => { window.location.href = '/login'; }
    }
  ]);
}
