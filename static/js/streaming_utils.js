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
 * FIXED: Now correctly creates or finds the LATEST assistant message container,
 * instead of selecting the first one which causes message ordering issues.
 *
 * @returns {HTMLElement|null} The message container element or null if not found.
 */
export function ensureMessageContainer() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return null;

  // Check for an assistant message with data-streaming attribute, which
  // we use to track the active streaming container
  let messageContainer = chatHistory.querySelector('.assistant-message[data-streaming="true"]');

  // If no active streaming container, create a new one at the END of chat history
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.className = 'message assistant-message';
    messageContainer.setAttribute('role', 'log');
    messageContainer.setAttribute('aria-live', 'polite');
    messageContainer.setAttribute('data-streaming', 'true');

    // Add timestamp to ensure proper ordering when conversations are loaded
    messageContainer.dataset.timestamp = Date.now();

    // Append to the END of chat history to maintain proper message order
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
 * Finalizes a streaming message, removing the streaming flag
 * to prevent it from being reused for future responses.
 * 
 * @param {HTMLElement} container - The container to finalize.
 */
export function finalizeStreamingContainer(container) {
  if (container && container.hasAttribute('data-streaming')) {
    container.removeAttribute('data-streaming');
  }
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

  // Only add the error notice if we don't already have a streaming-error-note
  if (parentContainer && !parentContainer.querySelector('.streaming-error-note')) {
    const errorNotice = document.createElement('div');

    // Check if this is a DeepSeek service unavailability error
    const errorMessage = error?.message?.toLowerCase() || '';
    const isServiceUnavailable = (
      errorMessage.includes('no healthy upstream') ||
      errorMessage.includes('failed dependency') ||
      errorMessage.includes('deepseek service')
    );

    errorNotice.className = 'streaming-error-note py-2 px-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded mt-2';

    if (isServiceUnavailable) {
      errorNotice.textContent = '⚠️ The AI service is temporarily unavailable. Please try again later or switch to a different model.';
    } else {
      errorNotice.textContent = '⚠️ The response was interrupted. The content above may be incomplete.';
    }

    parentContainer.appendChild(errorNotice);

    // Finalize the container to prevent reuse
    finalizeStreamingContainer(parentContainer);
  }

  if (typeof showNotification === 'function') {
    if (!navigator.onLine) {
      showNotification('Network connection lost.', 'error');
    } else {
      const errorMessage = error?.message || 'An unexpected error occurred.';
      const isDeepSeekError = errorMessage.toLowerCase().includes('deepseek') ||
        errorMessage.toLowerCase().includes('no healthy upstream') ||
        errorMessage.toLowerCase().includes('failed dependency');

      if (isDeepSeekError) {
        // Don't show another notification since streaming.js already handles this with buttons
        // The error notice in the message is sufficient
        return;
      }

      showNotification(errorMessage, 'error');
    }
  }
}