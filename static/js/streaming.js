import { getSessionId } from './session.js';
import { updateTokenUsage, fetchWithRetry, retry, eventBus } from './utils/helpers.js';
import { showNotification, handleMessageError, removeTypingIndicator } from './ui/notificationManager.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';
import {
  processDataChunk,
  ensureMessageContainer,
  ensureThinkingContainer,
  finalizeThinkingContainer,
  shouldRenderNow,
  showStreamingProgressIndicator,
  removeStreamingProgressIndicator,
  handleStreamingError as utilsHandleStreamingError
} from './streaming_utils.js';

// --- Global state variables ---
let mainTextBuffer = '';
let thinkingTextBuffer = '';
let chunkBuffer = '';
let messageContainer = null;
let thinkingContainer = null;
let isThinking = false;
let lastRenderTimestamp = 0;
let animationFrameId = null;
let errorState = false;
let connectionTimeoutId = null;
let connectionCheckIntervalId = null;

// --- Constants ---
const RENDER_INTERVAL_MS = 50;
const BASE_CONNECTION_TIMEOUT_MS = 90000; // 90 seconds
const MAX_CONNECTION_TIMEOUT_MS = 360000; // 6 minutes
const MAX_RETRY_ATTEMPTS = 3;
const CONNECTION_CHECK_INTERVAL_MS = 15000; // 15 seconds

/**
 * Dynamically calculates a connection timeout based on model type and message length.
 */
function calculateConnectionTimeout(modelName, messageLength) {
  let timeout = BASE_CONNECTION_TIMEOUT_MS;
  const normalizedModelName = modelName ? modelName.toLowerCase() : '';
  if (normalizedModelName.includes('o1') || normalizedModelName.includes('o3')) {
    timeout *= 3.5;
  } else if (normalizedModelName.includes('claude')) {
    timeout *= 2.5;
  } else if (normalizedModelName.includes('deepseek')) {
    timeout *= 2.0;
  }
  if (messageLength > 1000) {
    timeout *= 1 + (messageLength / 8000);
  }
  return Math.min(timeout, MAX_CONNECTION_TIMEOUT_MS);
}

/**
 * Resets the local streaming state.
 */
function resetStreamingState() {
  mainTextBuffer = '';
  thinkingTextBuffer = '';
  chunkBuffer = '';
  messageContainer = null;
  thinkingContainer = null;
  isThinking = false;
  lastRenderTimestamp = 0;
  errorState = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
  if (connectionCheckIntervalId) {
    clearInterval(connectionCheckIntervalId);
    connectionCheckIntervalId = null;
  }
}

/**
 * Main function to stream chat response via SSE.
 * @param {string} messageContent - User's message.
 * @param {string} sessionId - Session identifier.
 * @param {string} modelName - Name of the model to use.
 * @param {AbortSignal} signal - Optional signal to abort the request.
 * @returns {Promise<boolean>} Resolves when streaming completes.
 */
export function streamChatResponse(
  messageContent,
  sessionId,
  modelName = 'DeepSeek-R1',
  signal
) {
  resetStreamingState();
  return new Promise(async (resolve, reject) => {
    if (!sessionId) {
      reject(new Error('Invalid sessionId: Session ID is required for streaming'));
      return;
    }
    const validModelName = (modelName || 'DeepSeek-R1').toLowerCase();
    if (!validModelName || typeof validModelName !== 'string') {
      reject(new Error('Invalid model name'));
      return;
    }

    // Build query parameters without the reasoning_effort parameter
    const params = new URLSearchParams();
    params.append('model', validModelName);
    params.append('message', messageContent || '');

    // For DeepSeek-R1, enable thinking mode.
    if (validModelName.includes('deepseek')) {
      params.append('enable_thinking', 'true');
      console.log('DeepSeek model detected, enabling thinking mode');
    } else {
      console.warn('DeepSeek thinking mode not enabled for model:', validModelName);
    }

    const apiUrl = `${window.location.origin}/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    // Include developerConfig if available
    if (typeof developerConfig === 'string' && developerConfig.trim()) {
      params.append('developer_config', developerConfig.trim());
    }
    const fullUrl = `${apiUrl}&${params.toString()}`;

    // Create EventSource for SSE
    const eventSource = new EventSource(fullUrl);
    const connectionTimeoutMs = calculateConnectionTimeout(validModelName, messageContent.length);
    console.log(`Setting connection timeout to ${connectionTimeoutMs}ms for ${validModelName}`);

    // Set initial connection timeout
    connectionTimeoutId = setTimeout(() => {
      if (eventSource.readyState !== EventSource.CLOSED) {
        console.warn(`Connection timed out after ${connectionTimeoutMs}ms`);
        eventSource.close();
        handleStreamingError(new Error('Connection timeout'));
      }
    }, connectionTimeoutMs);

    // Periodic connection check
    connectionCheckIntervalId = setInterval(() => {
      if (eventSource.readyState === EventSource.CLOSED) {
        clearInterval(connectionCheckIntervalId);
      }
    }, CONNECTION_CHECK_INTERVAL_MS);

    // Handle abort signal
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);
        eventSource.close();
      }, { once: true });
    }

    // Register a single ping event listener
    eventSource.addEventListener('ping', () => {
      console.debug('[SSE Ping] keep-alive event received');
    });

    eventSource.onopen = () => {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = setTimeout(() => {
        if (eventSource.readyState !== EventSource.CLOSED) {
          console.warn(`Stream stalled after ${connectionTimeoutMs * 1.5}ms`);
          eventSource.close();
          handleStreamingError(new Error('Stream stalled'));
        }
      }, connectionTimeoutMs * 1.5);
      eventBus.publish('streamingStarted', { modelName: validModelName });
    };

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.choices && data.choices[0]?.delta?.content?.includes('<think>')) {
          console.log('Thinking block detected in streaming chunk:', data.choices[0].delta.content);
        }
        processDataChunkWrapper(data);
        scheduleRender();
      } catch (err) {
        console.error('[streamChatResponse] Error processing message:', err);
        if (mainTextBuffer || thinkingTextBuffer) {
          forceRender();
        }
      }
    };

    eventSource.onerror = (e) => {
      if (signal?.aborted) return;
      clearTimeout(connectionTimeoutId);
      clearInterval(connectionCheckIntervalId);
      eventSource.close();
      let errorMsg = 'Connection failed (EventSource closed)';
      if (e && e.status) {
        errorMsg = `Connection failed with status: ${e.status}`;
      }
      handleStreamingError(new Error(errorMsg));
      if (navigator.onLine) {
        showNotification('Connection failed. Would you like to retry?', 'error', 0, [{
          label: 'Retry',
          onClick: () => attemptErrorRecovery(messageContent, new Error(errorMsg))
        }]);
      } else {
        window.addEventListener('online', () => {
          showNotification('Connection restored. Retrying...', 'info');
          attemptErrorRecovery(messageContent, new Error(errorMsg));
        }, { once: true });
      }
    };

    // Listen for the server's "complete" event
    eventSource.addEventListener('complete', async (e) => {
      try {
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);
        if (e.data) {
          const completionData = JSON.parse(e.data);
          if (completionData.usage) {
            console.log("Received token usage data:", completionData.usage);
            updateTokenUsage(completionData.usage);
            if (!window.tokenUsageHistory) window.tokenUsageHistory = {};
            window.tokenUsageHistory[validModelName] = completionData.usage;
          }
          eventBus.publish('streamingCompleted', {
            modelName: validModelName,
            usage: completionData.usage
          });
        }
        forceRender();
        eventSource.close();
      } catch (err) {
        console.error('[streamChatResponse] Error handling completion:', err);
      } finally {
        await cleanupStreaming(validModelName);
        resolve(true);
      }
    });
  });
}

/**
 * Handles streaming errors by logging, updating the UI, and notifying global listeners.
 */
function handleStreamingError(error) {
  console.error('[handleStreamingError]', error);
  if (!errorState) {
    errorState = true;
    if (mainTextBuffer || thinkingTextBuffer) {
      forceRender();
    }
    utilsHandleStreamingError(error, showNotification, messageContainer);
    removeTypingIndicator();
    removeStreamingProgressIndicator();
    eventBus.publish('streamingError', {
      error,
      recoverable: error.recoverable || false
    });
  }
}

/**
 * Attempts to recover from a streaming error by retrying the connection using exponential backoff.
 */
async function attemptErrorRecovery(messageContent, error) {
  if (!navigator.onLine) {
    showNotification('Waiting for internet connection...', 'warning', 0);
    return new Promise(resolve => {
      window.addEventListener('online', async () => {
        showNotification('Connection restored. Retrying...', 'info', 3000);
        try {
          const sessionId = await getSessionId();
          if (!sessionId) {
            showNotification('Could not retrieve session ID', 'error');
            resolve(false);
            return;
          }
          const modelSelect = document.getElementById('model-select');
          let modelName = (modelSelect && modelSelect.value) ? modelSelect.value : 'DeepSeek-R1';
          try {
            const success = await retry(
              () => streamChatResponse(messageContent, sessionId, modelName),
              MAX_RETRY_ATTEMPTS
            );
            resolve(success);
          } catch {
            showNotification('Recovery failed', 'error');
            resolve(false);
          }
        } catch (err) {
          console.error('Error retrieving session ID:', err);
          showNotification('Could not retrieve session ID', 'error');
          resolve(false);
        }
      }, { once: true });
    });
  }

  // Only do exponential backoff if it's a known connection-type error
  if (
    error.recoverable ||
    ['ConnectionError', 'NetworkError', 'TimeoutError'].includes(error.name)
  ) {
    showNotification('Retrying connection...', 'info', 3000);
    await new Promise(r => setTimeout(r, 2000));
    try {
      const sessionId = await getSessionId();
      if (!sessionId) {
        showNotification('Could not retrieve session ID', 'error');
        return false;
      }
      const modelSelect = document.getElementById('model-select');
      let modelName = (modelSelect && modelSelect.value) ? modelSelect.value : 'DeepSeek-R1';
      try {
        return await retry(
          () => streamChatResponse(messageContent, sessionId, modelName),
          MAX_RETRY_ATTEMPTS,
          {
            backoff: true,
            initialDelay: 1000,
            maxDelay: 10000
          }
        );
      } catch {
        showNotification('Recovery failed', 'error');
        return false;
      }
    } catch (err) {
      console.error('Error retrieving session ID:', err);
      showNotification('Could not retrieve session ID', 'error');
      return false;
    }
  }
  showNotification('Cannot retry - please refresh and try again', 'error');
  return false;
}

/**
 * Wrapper around processDataChunk to update local streaming state.
 */
function processDataChunkWrapper(data) {
  const result = processDataChunk(
    data,
    chunkBuffer,
    mainTextBuffer,
    thinkingTextBuffer,
    isThinking,
    deepSeekProcessor
  );
  mainTextBuffer = result.mainTextBuffer;
  thinkingTextBuffer = result.thinkingTextBuffer;
  chunkBuffer = result.chunkBuffer;
  isThinking = result.isThinking;
  if (isThinking && thinkingTextBuffer) {
    const container = ensureMessageContainer();
    thinkingContainer = ensureThinkingContainer(
      container,
      thinkingTextBuffer,
      deepSeekProcessor
    );
  }
}

/**
 * Schedules a DOM render if enough time has passed.
 */
function scheduleRender() {
  if (shouldRenderNow(lastRenderTimestamp, RENDER_INTERVAL_MS)) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(() => {
      renderBufferedContent();
      showStreamingProgressIndicator(messageContainer);
      lastRenderTimestamp = Date.now();
      animationFrameId = null;
    });
  }
}

/**
 * Immediately flushes buffered content to the DOM.
 */
function forceRender() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  renderBufferedContent();
  lastRenderTimestamp = Date.now();
}

/**
 * Renders main and thinking buffers into the DOM.
 */
function renderBufferedContent() {
  try {
    // Ensure containers exist
    messageContainer = ensureMessageContainer();
    thinkingContainer = ensureThinkingContainer(messageContainer, thinkingTextBuffer, deepSeekProcessor);

    // Process and separate buffers
    const { mainContent, thinkingContent } = deepSeekProcessor.separateContentBuffers(
      mainTextBuffer,
      thinkingTextBuffer
    );

    // Update main content with incremental rendering
    if (mainContent) {
      if (!messageContainer.__previousHtml) {
        messageContainer.__previousHtml = "";
      }
      
      const processedMain = deepSeekProcessor.processDeepSeekResponse(mainContent);
      const oldMain = messageContainer.__previousHtml;
      
      // Append only new content to reduce flicker
      if (processedMain.startsWith(oldMain)) {
        const remainder = processedMain.slice(oldMain.length);
        if (remainder) {
          messageContainer.insertAdjacentHTML('beforeend', remainder);
        }
      } else {
        messageContainer.innerHTML = processedMain;
      }
      messageContainer.__previousHtml = processedMain;
    }

    // Update thinking container with proper toggle support
    if (thinkingContent) {
      const thinkingHTML = `
        <div class="thinking-container collapsible collapsed">
          <div class="thinking-header">
            <span class="toggle-icon">▶</span>
            Chain of Thought
          </div>
          <div class="thinking-content" style="display: none;">
            ${deepSeekProcessor.markdownToHtml(thinkingContent || '')}
          </div>
        </div>
      `;
      
      // Only replace thinking container if new content exists
      if (thinkingContainer.innerHTML !== thinkingHTML) {
        thinkingContainer.innerHTML = thinkingHTML;
        // Initialize toggle functionality
        deepSeekProcessor.initializeThinkingToggle(thinkingContainer);
      }
    }

    // Scroll to bottom if not in error state
    if (!errorState) {
      messageContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      if (thinkingContainer) {
        thinkingContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  } catch (err) {
    console.error('[renderBufferedContent] Error:', err);
  }
}

/**
 * Cleans up streaming state and stores the final assistant message.
 */
async function cleanupStreaming(modelName) {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  try {
    removeTypingIndicator();
    removeStreamingProgressIndicator();
  } finally {
    document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
    document.querySelectorAll('.streaming-progress').forEach(el => el.remove());
  }
  if (mainTextBuffer && messageContainer) {
    try {
      const sessionId = await getSessionId();
      if (!sessionId) {
        console.error('No valid session ID found — cannot store message.');
      } else {
        await fetchWithRetry(
          `${window.location.origin}/api/chat/conversations/store`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              role: 'assistant',
              content: mainTextBuffer,
              model: modelName || 'DeepSeek-R1'
            })
          }
        ).catch(err => console.warn('Failed to store message:', err));
      }
    } catch (e) {
      console.warn('Failed to store message:', e);
    }
  }
}

/**
 * Determines the reasoning effort setting from a UI slider.
 * (Note: This function is kept for backward compatibility but its value is no longer sent to the API.)
 * @returns {string} 'low', 'medium', or 'high'
 */
function getReasoningEffortSetting() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) {
    const value = parseInt(slider.value, 10);
    return value === 1 ? 'low' : value === 3 ? 'high' : 'medium';
  }
  return 'medium';
}
