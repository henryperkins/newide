/**
 * streaming.js
 *
 * Manages the SSE connection to your chat endpoint, receiving tokens in real time,
 * assembling them into main or thinking text, handling errors and retries.
 */

import { getSessionId } from './session.js';
import { updateTokenUsage, fetchWithRetry, retry, eventBus } from './utils/helpers.js';
import { showNotification, handleMessageError, removeTypingIndicator } from './ui/notificationManager.js';
import { processDeepSeekResponse, deepSeekProcessor } from './ui/deepseekProcessor.js';

// Import from our new streaming utilities
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

let mainTextBuffer = '';
let thinkingTextBuffer = '';
let messageContainer = null;
let thinkingContainer = null;
let isThinking = false;
let lastRenderTimestamp = 0;
let animationFrameId = null;
let isProcessing = false;
let errorState = false;
let chunkBuffer = '';

const RENDER_INTERVAL_MS = 50;
const BASE_CONNECTION_TIMEOUT_MS = 90000; // 90s
const MAX_CONNECTION_TIMEOUT_MS = 360000; // 6 minutes
const MAX_RETRY_ATTEMPTS = 3;
const CONNECTION_CHECK_INTERVAL_MS = 15000; // 15s

/**
 * Dynamically calculates a connection timeout based on model type, reasoning effort, and message length.
 * 
 * @param {string} modelName
 * @param {string} reasoningEffort - 'low', 'medium', or 'high'
 * @param {number} messageLength
 * @returns {number} Timeout in ms, capped by MAX_CONNECTION_TIMEOUT_MS.
 */
function calculateConnectionTimeout(modelName, reasoningEffort, messageLength) {
  let timeout = BASE_CONNECTION_TIMEOUT_MS;
  const normalizedModelName = modelName ? modelName.toLowerCase() : '';

  // Adjust for known model types
  if (normalizedModelName.includes('o1') || normalizedModelName.includes('o3')) {
    timeout *= 3.5; 
  } else if (normalizedModelName.includes('claude')) {
    timeout *= 2.5;
  } else if (normalizedModelName.includes('deepseek')) {
    timeout *= 2.0;
  }

  // Adjust for reasoning effort
  if (reasoningEffort === 'high') {
    timeout *= 2.5;
  } else if (reasoningEffort === 'medium') {
    timeout *= 1.8;
  } // low => no multiplier

  // Adjust for message length
  if (messageLength > 1000) {
    timeout *= 1 + (messageLength / 8000);
  }

  // Cap at maximum
  return Math.min(timeout, MAX_CONNECTION_TIMEOUT_MS);
}

/**
 * Main function to stream chat response via SSE. Returns a Promise that resolves when streaming completes or fails.
 * 
 * @param {string} messageContent
 * @param {string} sessionId
 * @param {string} modelName
 * @param {string} developerConfig
 * @param {string} reasoningEffort
 * @param {AbortSignal} signal
 * @returns {Promise<boolean>}
 */
export function streamChatResponse(
  messageContent,
  sessionId,
  modelName = 'DeepSeek-R1',
  developerConfig = '',
  reasoningEffort = 'medium',
  signal
) {
  resetStreamingState();
  isProcessing = true;
  let connectionTimeoutId = null;
  let connectionCheckIntervalId = null;

  return new Promise((resolve, reject) => {
    if (!sessionId) {
      reject(new Error('Invalid sessionId: Session ID is required for streaming'));
      return;
    }

    // Ensure valid model name
    const validModelName = modelName || 'DeepSeek-R1';
    const normalizedModelName = validModelName.toLowerCase();

    // Construct SSE URL
    const apiUrl = `${window.location.origin}/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    const params = new URLSearchParams({
      model: validModelName,
      message: messageContent || '',
      reasoning_effort: reasoningEffort || 'medium'
    });
    if (developerConfig) params.append('developer_config', developerConfig);

    // If using DeepSeek, enable thinking
    if (normalizedModelName.includes('deepseek')) {
      params.append('enable_thinking', 'true');
      console.log('DeepSeek model detected, enabling thinking mode');
    }

    const fullUrl = `${apiUrl}&${params.toString()}`;
    console.log(`Connecting to streaming endpoint with model: ${validModelName}`);

    const eventSource = new EventSource(fullUrl);

    // Dynamic timeout
    const connectionTimeoutMs = calculateConnectionTimeout(validModelName, reasoningEffort, messageContent.length);
    console.log(`Setting connection timeout to ${connectionTimeoutMs}ms for ${validModelName}`);

    // Initial connection timeout
    connectionTimeoutId = setTimeout(() => {
      if (eventSource && eventSource.readyState !== 2) { // 2 => CLOSED
        console.warn(`Connection timed out after ${connectionTimeoutMs}ms`);
        eventSource.close();
        handleStreamingError(Object.assign(new Error('Connection timeout'), {
          name: 'TimeoutError',
          modelName: validModelName,
          reasoningEffort,
          recoverable: true
        }));
      }
    }, connectionTimeoutMs);

    // Periodic check
    connectionCheckIntervalId = setInterval(() => {
      if (eventSource.readyState === 2) { // CLOSED
        clearInterval(connectionCheckIntervalId);
      }
    }, CONNECTION_CHECK_INTERVAL_MS);

    // If an AbortSignal is supplied, handle early abort
    if (signal) {
      signal.addEventListener('abort', () => {
        if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
        if (connectionCheckIntervalId) clearInterval(connectionCheckIntervalId);
        eventSource.close();
      }, { once: true });
    }

    let connectionClosed = false;

    eventSource.onopen = () => {
      // Clear initial timeout, set a longer stall timeout
      if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
      connectionTimeoutId = setTimeout(() => {
        if (eventSource && eventSource.readyState !== 2) {
          console.warn(`Stream stalled after ${connectionTimeoutMs * 1.5}ms`);
          eventSource.close();
          handleStreamingError(Object.assign(new Error('Stream stalled'), {
            name: 'TimeoutError',
            modelName: validModelName,
            reasoningEffort,
            recoverable: true
          }));
        }
      }, connectionTimeoutMs * 1.5);
      eventBus.publish('streamingStarted', { modelName: validModelName });
    };

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        processDataChunkWrapper(data);
        scheduleRender();
      } catch (err) {
        console.error('[streamChatResponse] Error processing message:', err);
        if (mainTextBuffer || thinkingTextBuffer) {
          forceRender();
        }
      }
      eventSource.addEventListener('ping', () => {
        console.debug('[SSE Ping] keep-alive event received');
      });
    };

    eventSource.onerror = (e) => {
      // Check if the abort was intentional
      if (signal?.aborted) {
        return;
      }

      if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
      if (connectionCheckIntervalId) clearInterval(connectionCheckIntervalId);

      if (!connectionClosed) {
        connectionClosed = true;
        eventSource.close();

        // Offline check
        if (!navigator.onLine) {
          handleStreamingError(Object.assign(new Error('Network offline'), {
            name: 'NetworkError',
            recoverable: true
          }));
          return;
        }

        // If server returned an error payload
        if (e.data && typeof e.data === 'string') {
          try {
            const errorData = JSON.parse(e.data);
            const errorMessage = errorData.error?.message || errorData.message || errorData.detail || 'Server error';
            handleStreamingError(Object.assign(new Error(errorMessage), {
              name: 'ServerError',
              data: errorData,
              recoverable: true
            }));
            return;
          } catch {
            handleStreamingError(new Error(`Server sent invalid response: ${String(e.data).substring(0, 100)}`));
            return;
          }
        }

        // Generic connection error
        if (!errorState) {
          errorState = true;
          if (mainTextBuffer || thinkingTextBuffer) {
            forceRender();
          }

          const err = new Error(
            !navigator.onLine
              ? 'Internet connection lost'
              : (e.status ? `Connection failed with status: ${e.status}` : 'Connection failed (EventSource closed)')
          );
          err.name = !navigator.onLine ? 'NetworkError' : 'ConnectionError';
          err.recoverable = true;

          if (e.target && e.target.readyState === EventSource.CLOSED) {
            err.message += ' (EventSource connection closed)';
          }
          if (e.target && e.target.url) {
            err.message += ` (URL: ${e.target.url})`;
          }

          handleMessageError(err);

          if (navigator.onLine) {
            showNotification('Connection failed. Would you like to retry?', 'error', 0, [{
              label: 'Retry',
              onClick: () => attemptErrorRecovery(messageContent, err)
            }]);
          } else {
            window.addEventListener('online', () => {
              showNotification('Connection restored. Retrying...', 'info');
              attemptErrorRecovery(messageContent, err);
            }, { once: true });
          }
        }
      }
    };

    // Custom event from server indicating completion
    eventSource.addEventListener('complete', async (e) => {
      try {
        if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
        if (connectionCheckIntervalId) clearInterval(connectionCheckIntervalId);

        if (e.data) {
          const completionData = JSON.parse(e.data);
          if (completionData.usage) updateTokenUsage(completionData.usage);
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
 * A simplified reconnect approach, e.g., when the connection is dropped, 
 * we wait 3s and then reconnect, or wait for `online` event.
 */
export function attemptReconnect(messageContent, sessionId, modelName, developerConfig, reasoningEffort) {
  const validModelName = modelName || 'DeepSeek-R1';
  console.warn(`[streaming.js] Attempting SSE reconnect in 3 seconds for model ${validModelName}...`);
  
  showNotification(`Connection lost. Attempting to reconnect in 3 seconds...`, 'warning');
  
  setTimeout(() => {
    if (navigator.onLine) {
      console.log(`[streaming.js] Reconnecting with model: ${validModelName}`);
      streamChatResponse(messageContent, sessionId, validModelName, developerConfig, reasoningEffort);
    } else {
      console.warn('[streaming.js] Cannot reconnect - still offline');
      showNotification('Network is offline. Waiting for connection...', 'error');
      window.addEventListener('online', () => {
        console.log(`[streaming.js] Network restored, reconnecting with model: ${validModelName}`);
        showNotification('Connection restored. Reconnecting...', 'info');
        streamChatResponse(messageContent, sessionId, validModelName, developerConfig, reasoningEffort);
      }, { once: true });
    }
  }, 3000);
}

/**
 * Attempts to recover from a streaming error by retrying or switching to a lower reasoning effort.
 */
async function attemptErrorRecovery(messageContent, error) {
  if (!navigator.onLine) {
    showNotification('Waiting for internet connection...', 'warning', 0);
    return new Promise(resolve => {
      window.addEventListener('online', async () => {
        await new Promise(r => setTimeout(r, 1500));
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
          const developerConfig = document.getElementById('developer-config')?.value || '';
          
          let reasoningEffort = getReasoningEffortSetting();
          if (error.name === 'TimeoutError' && reasoningEffort !== 'low') {
            reasoningEffort = 'low';
            showNotification('Retrying with lower reasoning effort', 'info', 3000);
          }
          
          try {
            const success = await retry(
              () => streamChatResponse(messageContent, sessionId, modelName, developerConfig, reasoningEffort),
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

  if (error.recoverable || ['ConnectionError', 'NetworkError', 'TimeoutError'].includes(error.name)) {
    showNotification('Retrying connection...', 'info', 3000);
    await new Promise(r => setTimeout(r, 2000));
    try {
      const sessionId = await getSessionId();
      if (!sessionId) {
        showNotification('Could not retrieve session ID', 'error');
        return false;
      }

      const modelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
      const developerConfig = document.getElementById('developer-config')?.value || '';

      let reasoningEffort = getReasoningEffortSetting();
      if (error.name === 'TimeoutError' && reasoningEffort !== 'low') {
        reasoningEffort = 'low';
        showNotification('Retrying with lower reasoning effort', 'info', 3000);
      }

      try {
        return await retry(
          () => streamChatResponse(messageContent, sessionId, modelName, developerConfig, reasoningEffort),
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
 * Wraps processDataChunk(...) with local state in streaming.js
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

  // If now in "thinking" mode, ensure UI for it
  if (isThinking && thinkingTextBuffer) {
    const container = ensureMessageContainer();
    thinkingContainer = ensureThinkingContainer(container, thinkingTextBuffer, deepSeekProcessor);
  }
}

/**
 * Schedule a DOM render if enough time has passed.
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
 * Immediately render any buffered content.
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
 * Renders the main and thinking buffers into the DOM.
 */
function renderBufferedContent() {
  try {
    // Ensure main container
    if (!messageContainer) {
      messageContainer = ensureMessageContainer();
    }
    if (messageContainer) {
      // If you have a more sophisticated function: window.renderAssistantMessage(...)
      // you could replace these lines with that call
      messageContainer.innerHTML = mainTextBuffer;
      messageContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      deepSeekProcessor.initializeExistingBlocks(); // e.g. if needed

      // If there's a thinking block
      if (thinkingContainer && thinkingTextBuffer) {
        thinkingContainer.textContent = thinkingTextBuffer;
        thinkingContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  } catch (err) {
    console.error('[renderBufferedContent] Error:', err);
  }
}

/**
 * Clean up the SSE streaming state after completion.
 * Optionally store the final assistant message.
 */
async function cleanupStreaming(modelName) {
  isProcessing = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  removeTypingIndicator();
  removeStreamingProgressIndicator();

  if (mainTextBuffer && messageContainer) {
    try {
      const sessionId = await getSessionId();
      if (!sessionId) {
        console.error('No valid session ID found — cannot store message.');
      } else if (!mainTextBuffer) {
        console.error('Missing assistant content — cannot store message.');
      } else {
        await fetchWithRetry(`${window.location.origin}/api/chat/conversations/store`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            role: 'assistant',
            content: mainTextBuffer,
            model: modelName || 'DeepSeek-R1' 
          })
        }).catch(err => console.warn('Failed to store message:', err));
      }
    } catch (e) {
      console.warn('Failed to store message:', e);
    }
  }
}

/**
 * Reset local streaming state so new requests start fresh.
 */
function resetStreamingState() {
  mainTextBuffer = '';
  thinkingTextBuffer = '';
  messageContainer = null;
  thinkingContainer = null;
  isThinking = false;
  lastRenderTimestamp = 0;
  chunkBuffer = '';
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  errorState = false;
}

/**
 * Our local error handler wrapper around the utilities function.
 */
function handleStreamingError(error) {
  console.error('[handleStreamingError]', error);
  if (!errorState) {
    errorState = true;
    // Flush partial content
    if (mainTextBuffer || thinkingTextBuffer) {
      forceRender();
    }
    // Show a user-facing message about interruption
    utilsHandleStreamingError(error, showNotification, messageContainer);

    removeTypingIndicator();
    removeStreamingProgressIndicator();

    // Fire an event for higher-level or global listeners
    eventBus.publish('streamingError', {
      error,
      recoverable: error.recoverable || false
    });
  }
}

/**
 * Determines whether to use 'low', 'medium', or 'high' reasoning based on a slider in your UI.
 */
function getReasoningEffortSetting() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) {
    const value = parseInt(slider.value, 10);
    return value === 1 ? 'low' : value === 3 ? 'high' : 'medium';
  }
  return 'medium';
}
