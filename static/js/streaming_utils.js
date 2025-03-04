/*
 * streaming_utils.js
 *
 * A helper module that provides reusable functions for:
 *  - Basic SSE streaming utilities (now mostly delegated to deepseekProcessor for chain-of-thought)
 *  - Ensuring a message container
 *  - Rendering throttling
 *  - Error handling and UI indicators
 */

/**
 * Deprecated. Please call deepSeekProcessor.processChunkAndUpdateBuffers directly.
 */
export function processDataChunk(
  data,
  chunkBuffer,
  mainTextBuffer,
  thinkingTextBuffer,
  isThinking,
  deepSeekProcessor
) {
  console.warn('[Deprecated] processDataChunk is replaced by deepSeekProcessor.processChunkAndUpdateBuffers.');

  return deepSeekProcessor.processChunkAndUpdateBuffers(
    data,
    chunkBuffer,
    mainTextBuffer,
    thinkingTextBuffer,
    isThinking
  );
}

/**
 * Ensures that a main message container exists in the DOM.
 * If not found, creates one inside the element with the ID "chat-history".
 *
 * @returns {HTMLElement|null} The message container element or null if not found.
 */
export function ensureMessageContainer() {
  let messageContainer = document.querySelector('.assistant-message');
  if (!messageContainer) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return null;

    messageContainer = document.createElement('div');
    messageContainer.className = 'message assistant-message';
    messageContainer.setAttribute('role', 'log');
    messageContainer.setAttribute('aria-live', 'polite');
    chatHistory.appendChild(messageContainer);
  }
  return messageContainer;
}

/**
 * Determines if enough time has passed since the last render.
 * Helps throttle DOM updates.
 *
 * @param {number} lastRenderTimestamp - Last render time (ms since epoch).
 * @param {number} intervalMs - Minimum interval between renders (default 50ms).
 * @returns {boolean} True if it's time to render again.
 */
export function shouldRenderNow(lastRenderTimestamp, intervalMs = 50) {
  const now = Date.now();
  return (now - lastRenderTimestamp >= intervalMs);
}

/**
 * Adds a "streaming in progress" indicator to the parent container.
 *
 * @param {HTMLElement} parentContainer - The container to append the indicator.
 */
export function showStreamingProgressIndicator(parentContainer) {
  if (!parentContainer) return;
  let progressIndicator = document.getElementById('streaming-progress');
  if (!progressIndicator) {
    progressIndicator = document.createElement('div');
    progressIndicator.id = 'streaming-progress';
    progressIndicator.className = 'streaming-progress-indicator flex items-center text-xs text-dark-500 dark:text-dark-400 mt-2 mb-1';
    progressIndicator.innerHTML = `
      <div class="animate-pulse mr-2 h-1.5 w-1.5 rounded-full bg-primary-500"></div>
      <span>Receiving response...</span>
    `;
    parentContainer.appendChild(progressIndicator);
  }
}

/**
 * Removes the streaming progress indicator from the DOM if it exists.
 */
export function removeStreamingProgressIndicator() {
  const progressIndicator = document.getElementById('streaming-progress');
  if (progressIndicator) progressIndicator.remove();
}

/**
 * Displays an error indicator in the message container if streaming is interrupted.
 * Also calls a notification callback for user feedback.
 *
 * @param {Error} error - The error object encountered.
 * @param {Function} showNotification - Callback to display a user-friendly message.
 * @param {HTMLElement} parentContainer - The container where the error indicator will be appended.
 */
export function handleStreamingError(error, showNotification, parentContainer) {
  console.error('[streaming_utils] handleStreamingError:', error);

  if (parentContainer) {
    const errorNotice = document.createElement('div');
    errorNotice.className = 'py-2 px-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded mt-2';
    errorNotice.textContent = '⚠️ The response was interrupted. The content above may be incomplete.';
    parentContainer.appendChild(errorNotice);
  }

  if (typeof showNotification === 'function') {
    const userFriendlyMessage = !navigator.onLine
      ? 'Network connection lost.'
      : error.message || 'An unexpected error occurred.';
    showNotification(userFriendlyMessage, 'error');
  }
}
