/**
 * streaming_utils.js
 * 
 * A helper module that provides reusable functions for:
 *  - Chunk processing of incoming SSE data
 *  - Managing “thinking” UI blocks
 *  - Rendering content with throttling
 *  - Basic error handling and displaying UI error indicators
 */

/**
 * Processes an incoming data chunk from the server, updating the main text buffer,
 * thinking text buffer, and the leftover chunk buffer while managing the "thinking" mode.
 * 
 * @param {Object} data - Parsed JSON chunk from SSE (e.g., { choices: [...] }).
 * @param {string} chunkBuffer - Accumulated leftover text not yet assigned.
 * @param {string} mainTextBuffer - Main text buffer for displayed output.
 * @param {string} thinkingTextBuffer - Text buffer for "thinking" content.
 * @param {boolean} isThinking - Flag indicating if we are in "thinking" mode.
 * @param {Object} deepSeekProcessor - Object with methods for parsing deep-seek logic.
 * @returns {Object} An object with updated { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking }.
 */
export function processDataChunk(
  data,
  chunkBuffer,
  mainTextBuffer,
  thinkingTextBuffer,
  isThinking,
  deepSeekProcessor
) {
  if (!data.choices || data.choices.length === 0) {
    return { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking };
  }

  data.choices.forEach(choice => {
    // Process token content if available
    if (choice.delta && choice.delta.content) {
      const text = choice.delta.content;
      chunkBuffer += text;

      const result = deepSeekProcessor.processStreamingChunk(
        chunkBuffer,
        isThinking,
        mainTextBuffer,
        thinkingTextBuffer
      );
      mainTextBuffer = result.mainBuffer;
      thinkingTextBuffer = result.thinkingBuffer;
      isThinking = result.isThinking;
      chunkBuffer = result.remainingChunk;

      // Re-check for leftover data: if any remains, process it recursively with an empty content chunk.
      // Removed recursive call to processDataChunk for remainingChunk
    }

    // If the server signals finishing (via finish_reason), finalize the content.
    if (choice.finish_reason) {
      if (chunkBuffer) {
        mainTextBuffer += chunkBuffer;
        chunkBuffer = '';
      }
      // Turn off "thinking" mode
      isThinking = false;
    }
  });

  return { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking };
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
 * Creates or updates a "thinking" container within the parent container.
 * The container is used to display chain-of-thought details.
 *
 * @param {HTMLElement} parentContainer - The parent message container.
 * @param {string} thinkingText - The text to display in the thinking block.
 * @param {Object} deepSeekProcessor - Provides a method to generate HTML for the thinking block.
 * @returns {HTMLElement|null} The thinking container element or null if not found.
 */
export function ensureThinkingContainer(parentContainer, thinkingText, deepSeekProcessor) {
  if (!parentContainer) return null;

  let thinkingContainer = parentContainer.querySelector('.thinking-pre');
  if (!thinkingContainer) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = deepSeekProcessor.createThinkingBlockHTML(thinkingText);
    parentContainer.appendChild(wrapper.firstElementChild);

    thinkingContainer = parentContainer.querySelector('.thinking-pre');

    // Let deepseekProcessor.initializeExistingBlocks handle toggles.
  }

  if (thinkingContainer && thinkingText) {
    thinkingContainer.textContent = thinkingText;
  }

  return thinkingContainer;
}

/**
 * Finalizes the "thinking" container by updating its text content.
 * Also removes any gradient overlay if the text fits the container.
 *
 * @param {HTMLElement} parentContainer - The parent assistant-message container.
 * @param {string} thinkingTextBuffer - Final "thinking" text to be rendered.
 */
export function finalizeThinkingContainer(parentContainer, thinkingTextBuffer) {
  if (!parentContainer) return;
  const thinkingContainer = parentContainer.querySelector('.thinking-pre');
  if (!thinkingContainer) return;

  thinkingContainer.textContent = thinkingTextBuffer;

  // Remove gradient overlay if content is short
  const gradientOverlay = parentContainer.querySelector('.thinking-content > div:last-child');
  if (thinkingContainer.scrollHeight <= thinkingContainer.clientHeight && gradientOverlay) {
    gradientOverlay.remove();
  }
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
