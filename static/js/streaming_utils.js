/**
 * streaming_utils.js
 * 
 * A helper module that provides reusable functions for:
 *  - chunk processing
 *  - managing thinking blocks
 *  - rendering content
 *  - basic error handling
 */

/**
 * Processes an incoming data chunk from the server, updating main/thinking buffers,
 * chunkBuffer, and isThinking state.
 * 
 * @param {Object} data - Parsed JSON chunk from SSE (e.g., data.choices).
 * @param {string} chunkBuffer - Accumulated leftover text not yet assigned to main or thinking buffer.
 * @param {string} mainTextBuffer - The main text buffer for displayed output.
 * @param {string} thinkingTextBuffer - Hidden or "thinking" text buffer.
 * @param {boolean} isThinking - Whether to append to the "thinking" text instead of the main text.
 * @param {Object} deepSeekProcessor - Object with methods for parsing deep-seek logic and “chain-of-thought”.
 * @returns {Object} { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking }
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
    // If there’s token content
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

      // Re-check if leftover chunk data remains
      if (result.remainingChunk) {
        chunkBuffer = result.remainingChunk;
        processDataChunk(
          { choices: [{ delta: { content: '' } }] },
          chunkBuffer,
          mainTextBuffer,
          thinkingTextBuffer,
          isThinking,
          deepSeekProcessor
        );
      }
    }

    // If the server signals finishing
    if (choice.finish_reason) {
      if (chunkBuffer) {
        // Possibly finalize or sanitize leftover content
        mainTextBuffer = deepSeekProcessor.processDeepSeekResponse(mainTextBuffer + chunkBuffer);
        chunkBuffer = '';
      }
      // End “thinking” mode
      isThinking = false;
    }
  });

  return { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking };
}

/**
 * If no message container exists, create it. 
 * @returns {HTMLElement|null} The main message container element or null if #chat-history not found.
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
 * Creates or updates the “thinking” container if needed.
 *
 * @param {HTMLElement} parentContainer - The parent element (message container).
 * @param {string} thinkingText - The text for the thinking container.
 * @param {Object} deepSeekProcessor - The object that handles “thinking” HTML markup or toggles.
 * @returns {HTMLElement|null} The thinking container element or null if parentContainer not found.
 */
export function ensureThinkingContainer(parentContainer, thinkingText, deepSeekProcessor) {
  if (!parentContainer) return null;

  let thinkingContainer = parentContainer.querySelector('.thinking-pre');
  if (!thinkingContainer) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = deepSeekProcessor.createThinkingBlockHTML(thinkingText);
    parentContainer.appendChild(wrapper.firstElementChild);

    thinkingContainer = parentContainer.querySelector('.thinking-pre');

    // Attach toggle logic if a toggle button exists
    const toggleButton = parentContainer.querySelector('.thinking-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', function() {
        const expanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', !expanded);
        const content = this.closest('.thinking-process').querySelector('.thinking-content');
        content.classList.toggle('hidden', expanded);
        this.querySelector('.toggle-icon').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    }
  }

  if (thinkingContainer && thinkingText) {
    thinkingContainer.textContent = thinkingText;
  }

  return thinkingContainer;
}

/**
 * Finalize the “thinking” container once we’re done receiving chain-of-thought text.
 * 
 * @param {HTMLElement} parentContainer - The parent .assistant-message container.
 * @param {string} thinkingTextBuffer - Final “thinking” text to render before removing references.
 */
export function finalizeThinkingContainer(parentContainer, thinkingTextBuffer) {
  if (!parentContainer) return;
  const thinkingContainer = parentContainer.querySelector('.thinking-pre');
  if (!thinkingContainer) return;

  thinkingContainer.textContent = thinkingTextBuffer;

  // If the text is short, remove the gradient overlay
  const gradientOverlay = parentContainer.querySelector('.thinking-content > div:last-child');
  if (thinkingContainer.scrollHeight <= thinkingContainer.clientHeight && gradientOverlay) {
    gradientOverlay.remove();
  }
}

/**
 * Determines whether enough time has passed since last render to perform a new one.
 * 
 * @param {number} lastRenderTimestamp - The last time (ms since epoch) content was rendered.
 * @param {number} intervalMs - Minimum interval between renders.
 * @returns {boolean} True if we should render now, false otherwise.
 */
export function shouldRenderNow(lastRenderTimestamp, intervalMs = 50) {
  const now = Date.now();
  return (now - lastRenderTimestamp >= intervalMs);
}

/**
 * Shows or updates a “streaming in progress” indicator in the parent container.
 * 
 * @param {HTMLElement} parentContainer - The element to which the progress indicator will be appended.
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
 * Removes the “streaming progress” element if it exists in the DOM.
 */
export function removeStreamingProgressIndicator() {
  const progressIndicator = document.getElementById('streaming-progress');
  if (progressIndicator) progressIndicator.remove();
}

/**
 * Displays a UI error indicator in the message container, e.g. if the stream was interrupted.
 * 
 * @param {Error} error - The error object caught from streaming or SSE.
 * @param {Function} showNotification - Callback for user-facing notifications.
 * @param {HTMLElement} parentContainer - The container in which to display an error notice.
 */
export function handleStreamingError(error, showNotification, parentContainer) {
  console.error('[streaming_utils] handleStreamingError:', error);

  if (parentContainer) {
    const errorNotice = document.createElement('div');
    errorNotice.className = 'py-2 px-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded mt-2';
    errorNotice.textContent = '⚠️ The response was interrupted. The content above may be incomplete.';
    parentContainer.appendChild(errorNotice);
  }

  // Possibly show a user-friendly notification
  if (typeof showNotification === 'function') {
    const userFriendlyMessage = !navigator.onLine
      ? 'Network connection lost.'
      : error.message || 'An unexpected error occurred.';
    showNotification(userFriendlyMessage, 'error');
  }
}
