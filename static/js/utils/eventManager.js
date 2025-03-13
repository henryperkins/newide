/**
 * Centralized event registration system to prevent duplicate handlers
 */
const registeredHandlers = new Map();

/**
 * Register an event handler with automatic duplicate prevention
 * @param {string} elementId - ID of the DOM element
 * @param {string} eventType - Event type (e.g., 'click')
 * @param {string} handlerName - Unique name for this handler
 * @param {Function} handler - Event handler function
 * @returns {boolean} - Whether registration was successful
 */
export function registerEventHandler(elementId, eventType, handlerName, handler) {
  const element = document.getElementById(elementId);
  if (!element) return false;
  
  // Create unique key for this handler
  const handlerKey = `${elementId}:${eventType}:${handlerName}`;
  
  // Remove existing handler if present
  if (registeredHandlers.has(handlerKey)) {
    const oldHandler = registeredHandlers.get(handlerKey);
    element.removeEventListener(eventType, oldHandler);
  }
  
  // Add new handler
  element.addEventListener(eventType, handler);
  registeredHandlers.set(handlerKey, handler);
  
  return true;
}

/**
 * Remove a registered event handler
 * @param {string} elementId - ID of the DOM element
 * @param {string} eventType - Event type (e.g., 'click')
 * @param {string} handlerName - Unique name for this handler
 * @returns {boolean} - Whether removal was successful
 */
export function removeEventHandler(elementId, eventType, handlerName) {
  const handlerKey = `${elementId}:${eventType}:${handlerName}`;
  
  if (registeredHandlers.has(handlerKey)) {
    const element = document.getElementById(elementId);
    if (element) {
      element.removeEventListener(eventType, registeredHandlers.get(handlerKey));
    }
    registeredHandlers.delete(handlerKey);
    return true;
  }
  
  return false;
}

/**
 * Get all registered handlers for an element
 * @param {string} elementId - ID of the DOM element
 * @returns {Array} - Array of handler keys
 */
export function getRegisteredHandlers(elementId) {
  return Array.from(registeredHandlers.keys())
    .filter(key => key.startsWith(`${elementId}:`));
}

/**
 * Safely add event listener ensuring no duplicates
 * @param {Element} element - DOM element to attach listener to
 * @param {string} eventType - Event type (e.g., 'click')
 * @param {string} handlerName - Unique name for this handler
 * @param {Function} handler - Event handler function
 * @param {Object} options - addEventListener options
 */
export function safeAddEventListener(element, eventType, handlerName, handler, options = {}) {
  if (!element) return false;

  // Store event handlers on the element
  if (!element._eventHandlers) {
    element._eventHandlers = {};
  }

  // Create a unique key for this handler
  const handlerKey = `${eventType}_${handlerName}`;

  // If handler with this key exists, remove it first
  if (element._eventHandlers[handlerKey]) {
    element.removeEventListener(
      eventType,
      element._eventHandlers[handlerKey].fn,
      element._eventHandlers[handlerKey].options
    );
  }

  // Store reference to handler
  element._eventHandlers[handlerKey] = {
    fn: handler,
    options
  };

  // Add the event listener
  element.addEventListener(eventType, handler, options);
  return true;
}
