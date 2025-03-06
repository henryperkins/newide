// streaming.js
// Remove references to ensureThinkingContainer/finalizeThinkingContainer from streaming_utils
// and use deepSeekProcessor.renderThinkingContainer instead.

import { getSessionId } from './session.js';
import { updateTokenUsage, fetchWithRetry, retry, eventBus } from './utils/helpers.js';
import { showNotification, handleMessageError } from './ui/notificationManager.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';
import {
  ensureMessageContainer,
  shouldRenderNow,
  showStreamingProgressIndicator,
  removeStreamingProgressIndicator,
  handleStreamingError as utilsHandleStreamingError
} from './streaming_utils.js';
import { renderContentEfficiently, renderThinkingContainer } from './streamingRenderer.js';

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
let streamStartTime = 0;
let firstTokenTime = 0;
let tokenCount = 0;

// --- Constants ---
const RENDER_INTERVAL_MS = 50;
const BASE_CONNECTION_TIMEOUT_MS = 60000; // Increased from 30000 to 60 seconds
const MAX_CONNECTION_TIMEOUT_MS = 180000; // Increased from 120000 to 180 seconds
const MAX_RETRY_ATTEMPTS = 3;
const CONNECTION_CHECK_INTERVAL_MS = 5000; // 5 seconds

/**
 * Calculates tokens per second based on usage data and streaming duration
 * @param {Object} usage - The token usage data
 * @returns {number} - Tokens per second rate
 */
function calculateTokensPerSecond(usage) {
  if (!usage || !streamStartTime) return 0;
  
  const elapsedMs = performance.now() - streamStartTime;
  if (elapsedMs <= 0) return 0;
  
  const totalTokens = usage.completion_tokens || 0;
  const tokensPerSecond = (totalTokens / elapsedMs) * 1000;
  
  return Math.min(tokensPerSecond, 1000); // Cap at 1000 t/s for reasonable display
}

/**
 * Dynamically calculates a connection timeout based on model type and message length.
 */
function calculateConnectionTimeout(modelName, messageLength) {
  let timeout = BASE_CONNECTION_TIMEOUT_MS;
  const normalizedModelName = modelName ? modelName.toLowerCase() : '';
  
  // Add debug logging to help troubleshoot timeout issues
  console.log(`[calculateConnectionTimeout] Starting with base timeout: ${timeout}ms`);
  
  // Reasonable timeout multipliers for different model types
  if (normalizedModelName.indexOf('o1') !== -1 || normalizedModelName.indexOf('o3') !== -1) {
    timeout *= 2.5; // Increased from 2.0
    console.log(`[calculateConnectionTimeout] O-series model detected, timeout now: ${timeout}ms`);
  } else if (normalizedModelName.indexOf('claude') !== -1) {
    timeout *= 2.0; // Increased from 1.5
    console.log(`[calculateConnectionTimeout] Claude model detected, timeout now: ${timeout}ms`);
  } else if (normalizedModelName.indexOf('deepseek') !== -1) {
    timeout *= 2.0; // Increased from 1.5
    console.log(`[calculateConnectionTimeout] DeepSeek model detected, timeout now: ${timeout}ms`);
  }
  
  // More reasonable scaling based on message length
  if (messageLength > 1000) {
    const lengthFactor = 1 + (messageLength / 10000);
    timeout *= lengthFactor;
    console.log(`[calculateConnectionTimeout] Applied message length factor: ${lengthFactor}, timeout now: ${timeout}ms`);
  }
  
  const finalTimeout = Math.min(timeout, MAX_CONNECTION_TIMEOUT_MS);
  console.log(`[calculateConnectionTimeout] Final timeout: ${finalTimeout}ms`);
  return finalTimeout;
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
  streamStartTime = 0;
  firstTokenTime = 0;
  tokenCount = 0;
  
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
 * @param {string} devConfigToUse - Developer config for model.
 * @param {string} reasoningEffort - Reasoning effort level (low, medium, high).
 * @param {AbortSignal} signal - Optional signal to abort the request.
 * @param {Array} fileIds - Optional file IDs to include.
 * @param {boolean} useFileSearch - Whether to use file search.
 * @returns {Promise<boolean>} Resolves when streaming completes.
 */
export function streamChatResponse(
  messageContent,
  sessionId,
  modelName = 'DeepSeek-R1',
  devConfigToUse = '',
  reasoningEffort = 'medium',
  signal,
  fileIds = [],
  useFileSearch = false
) {
  resetStreamingState();
  // Set streamStartTime at the beginning of the streaming process
  streamStartTime = performance.now();
  
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

    // Build query parameters
    const params = new URLSearchParams();
    params.append('model', validModelName);
    params.append('message', messageContent || '');
    
    if (validModelName.indexOf('o1') !== -1 || validModelName.indexOf('o3') !== -1) {
      params.append('reasoning_effort', reasoningEffort || 'medium');
      params.append('response_format', 'json_schema');
      console.log(`[streamChatResponse] Using o1 model with reasoning_effort=${reasoningEffort || 'medium'}`);
    } else if (reasoningEffort && validModelName.indexOf('deepseek') === -1) {
      // For non-o1 and non-deepseek models, include it if provided but it might be ignored by the backend
      params.append('reasoning_effort', reasoningEffort);
    }
    
    // Add file context parameters
    if (fileIds && fileIds.length > 0) {
      params.append('include_files', 'true');
      fileIds.forEach(fileId => {
        params.append('file_ids', fileId);
      });
      
      if (useFileSearch) {
        params.append('use_file_search', 'true');
      }
    }

    // For DeepSeek models, only enable thinking mode for specific user preference
    const thinkingModeEnabled = localStorage.getItem('enableThinkingMode') === 'true';
    if (validModelName.indexOf('deepseek') !== -1 && thinkingModeEnabled) {
      params.append('enable_thinking', 'true');
      console.log('DeepSeek model with thinking mode enabled');
    } else {
      console.log('Thinking mode not enabled for model:', validModelName);
    }

    const apiUrl = window.location.origin + '/api/chat/sse?session_id=' + encodeURIComponent(sessionId);
    if (typeof devConfigToUse === 'string' && devConfigToUse.trim()) {
      params.append('developer_config', devConfigToUse.trim());
    }
    const fullUrl = apiUrl + '&' + params.toString();

    // Create EventSource
    const eventSource = new EventSource(fullUrl);
    const connectionTimeoutMs = calculateConnectionTimeout(validModelName, messageContent.length);
    console.log('Setting connection timeout to ' + connectionTimeoutMs + 'ms for ' + validModelName);

    // Set initial connection timeout
    connectionTimeoutId = setTimeout(() => {
      if (eventSource.readyState !== EventSource.CLOSED) {
        console.warn('Connection timed out after ' + connectionTimeoutMs + 'ms');
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

    // Abort signal
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);
        eventSource.close();
      }, { once: true });
    }

    eventSource.addEventListener('ping', () => {
      console.debug('[SSE Ping] keep-alive event received');
    });

    eventSource.onopen = () => {
      clearTimeout(connectionTimeoutId);
      connectionTimeoutId = setTimeout(() => {
        if (eventSource.readyState !== EventSource.CLOSED) {
          console.warn('Stream stalled after ' + (connectionTimeoutMs * 1.5) + 'ms');
          eventSource.close();
          handleStreamingError(new Error('Stream stalled'));
        }
      }, connectionTimeoutMs * 1.5);
      eventBus.publish('streamingStarted', { modelName: validModelName });
    };

    eventSource.onmessage = (e) => {
      try {
        console.log('Received SSE chunk from server');
        clearTimeout(connectionTimeoutId);
        connectionTimeoutId = setTimeout(() => {
          if (eventSource.readyState !== EventSource.CLOSED) {
            console.warn('Stream stalled after ' + (connectionTimeoutMs * 1.5) + 'ms');
            eventSource.close();
            handleStreamingError(new Error('Stream stalled'));
          }
        }, connectionTimeoutMs * 1.5);

        const data = JSON.parse(e.data);
        // Avoid optional chaining
        if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
          if (data.choices[0].delta.content.indexOf('<think>') !== -1) {
            console.log('Thinking block detected in streaming chunk:', data.choices[0].delta.content);
          }
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

    eventSource.onerror = async (e) => {
      if (signal && signal.aborted) return;
      clearTimeout(connectionTimeoutId);
      clearInterval(connectionCheckIntervalId);
      eventSource.close();
      
      // Try to get more detailed error information
      let errorMsg = 'Connection failed (EventSource closed)';
      let errorCode = 0;
      let isServerUnavailable = false;
      
      // Check for specific error conditions
      if (e && e.status) {
        errorMsg = 'Connection failed with status: ' + e.status;
        errorCode = e.status;
      }
      
      // Check if it's the common "no healthy upstream" DeepSeek error
      try {
        const responseText = e?.target?.responseText;
        if (responseText && responseText.includes('no healthy upstream')) {
          errorMsg = 'DeepSeek service is currently unavailable (no healthy upstream)';
          isServerUnavailable = true;
          console.warn('[DeepSeek Error] No healthy upstream detected.');
        } else if (responseText && responseText.includes('Failed Dependency')) {
          errorMsg = 'DeepSeek service dependency failure';
          isServerUnavailable = true;
          console.warn('[DeepSeek Error] Failed Dependency detected.');
        }
      } catch (err) {
        // Ignore error parsing response text
        console.debug('Could not parse error response text:', err);
      }
      
      // Create error object with additional properties
      const error = new Error(errorMsg);
      error.code = errorCode;
      error.recoverable = !isServerUnavailable;
      error.isTimeout = isTimeout;
      
      // For timeout errors, try a single auto-retry with increased timeout
      if (isTimeout && !error.retried) {
        error.retried = true;
        console.log('[streamChatResponse] Automatically retrying after timeout...');
        
        // Wait a moment before retrying
        await new Promise(r => setTimeout(r, 1000));
        
        try {
          // Try again with the same parameters but longer timeout
          const currentModelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
          window.serverCalculatedTimeout = (BASE_CONNECTION_TIMEOUT_MS * 3); // Force a much longer timeout
          
          // Re-attempt the streaming with original parameters
          await streamChatResponse(
            messageContent,
            sessionId,
            modelName,
            devConfigToUse,
            reasoningEffort,
            null, // New signal
            fileIds,
            useFileSearch
          );
          
          return; // If successful, don't show error
        } catch (retryError) {
          console.error('[streamChatResponse] Retry after timeout also failed:', retryError);
          // Continue to error handling
        } finally {
          window.serverCalculatedTimeout = undefined; // Clear the override
        }
      }
      
      handleStreamingError(error);
      
      if (!navigator.onLine) {
        // Handle offline case
        window.addEventListener(
          'online',
          () => {
            showNotification('Connection restored. Retrying...', 'info');
            attemptErrorRecovery(messageContent, error);
          },
          { once: true }
        );
        return;
      }
      
      // Handle content safety filtering
      if (errorCode === 400 && error.message.includes('content_filtered')) {
        showNotification(
          'Response blocked by content safety system',
          'error',
          5000
        );
      } else if (isServerUnavailable) {
        // Special handling for DeepSeek service unavailability
        showNotification(
          'AI service is temporarily unavailable. Please try again later or switch models.',
          'error',
          0,
          [
            {
              label: 'Switch Model',
              onClick: () => {
                const modelSelect = document.getElementById('model-select');
                if (modelSelect) {
                  modelSelect.focus();
                  showNotification('Please select a different model', 'info', 3000);
                }
              }
            },
            {
              label: 'Retry Anyway',
              onClick: () => attemptErrorRecovery(messageContent, error)
            }
          ]
        );
      } else {
        // Regular connection failure
        showNotification(
          'Connection failed. Would you like to retry?',
          'error',
          0,
          [
            {
              label: 'Retry',
              onClick: () => attemptErrorRecovery(messageContent, error)
            }
          ]
        );
      }
    };

    // "complete" event
    eventSource.addEventListener('complete', async (e) => {
      try {
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);
        if (e.data) {
          const completionData = JSON.parse(e.data);
          if (completionData.usage) {
            console.log('Received token usage data:', completionData.usage);
            
            // Enhance the token usage data with any timing metrics
            const enhancedUsage = {
              ...completionData.usage,
              // Include streaming performance metrics if available
              latency: (performance.now() - streamStartTime).toFixed(0),
              tokens_per_second: calculateTokensPerSecond(completionData.usage)
            };
            
            console.log('Enhanced token usage with timing metrics:', enhancedUsage);
            updateTokenUsage(enhancedUsage);
            
            // Store in token usage history
            if (!window.tokenUsageHistory) {
              window.tokenUsageHistory = {};
            }
            window.tokenUsageHistory[validModelName] = enhancedUsage;
          }
          eventBus.publish('streamingCompleted', {
            modelName: validModelName,
            usage: completionData.usage
          });
          
          // Update the stats display with the final usage data
          if (completionData.usage) {
          import('./ui/statsDisplay.js').then(({ updateStatsDisplay }) => {
            updateStatsDisplay(completionData.usage);
          }).catch(error => {
            console.error('Failed to load stats display module:', error);
          });
          }
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
    
    // If we have partial content, add a note explaining it's incomplete
    if (mainTextBuffer && messageContainer) {
      const errorNote = document.createElement('div');
      errorNote.className = 'streaming-error-note text-sm text-red-600 dark:text-red-400 mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded';
      errorNote.textContent = '⚠️ The response was interrupted and is incomplete due to a connection error.';
      messageContainer.appendChild(errorNote);
    }
    
    utilsHandleStreamingError(error, showNotification, messageContainer);
    removeStreamingProgressIndicator();
    eventBus.publish('streamingError', {
      error: error,
      recoverable: error.recoverable || false,
      modelName: document.getElementById('model-select')?.value || null
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

  // Check if the error mentions "no healthy upstream" - DeepSeek service issue
  const errorStr = error?.message?.toLowerCase() || '';
  const isServiceUnavailable = (
    errorStr.includes('no healthy upstream') || 
    errorStr.includes('failed dependency') ||
    errorStr.includes('deepseek service')
  );
  
  // If it's a DeepSeek service issue and user didn't explicitly request retry
  if (isServiceUnavailable && error.userRequestedRetry !== true) {
    showNotification('Service unavailable. Consider switching models.', 'warning', 5000);
    return false;
  }

  // Set a flag if this was a user-requested retry
  if (isServiceUnavailable) {
    error.userRequestedRetry = true;
  }

  // Only do exponential backoff if it's a known connection-type error or explicitly recoverable
  if (
    error.recoverable === true ||
    error.name === 'ConnectionError' ||
    error.name === 'NetworkError' ||
    error.name === 'TimeoutError' ||
    error.userRequestedRetry === true
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
      
      // If this is a DeepSeek error, try a different model if available
      if (isServiceUnavailable && modelName.toLowerCase().includes('deepseek')) {
        // Look for any non-DeepSeek model
        const options = modelSelect?.options || [];
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          if (option && option.value && !option.value.toLowerCase().includes('deepseek')) {
            modelName = option.value;
            console.log(`Switching from DeepSeek to available model: ${modelName}`);
            showNotification(`Switching to ${modelName} due to DeepSeek unavailability`, 'info', 5000);
            if (modelSelect) modelSelect.value = modelName;
            break;
          }
        }
      }
      
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
  const result = deepSeekProcessor.processChunkAndUpdateBuffers(
    data,
    chunkBuffer,
    mainTextBuffer,
    thinkingTextBuffer,
    isThinking
  );
  mainTextBuffer = result.mainTextBuffer;
  thinkingTextBuffer = result.thinkingTextBuffer;
  chunkBuffer = result.chunkBuffer;
  isThinking = result.isThinking;

  if (isThinking && thinkingTextBuffer) {
    const container = ensureMessageContainer();
    thinkingContainer = deepSeekProcessor.renderThinkingContainer(container, thinkingTextBuffer);
  }
}

/**
 * Schedules a DOM render if enough time has passed.
 */
function scheduleRender() {
  if (shouldRenderNow(lastRenderTimestamp, RENDER_INTERVAL_MS)) {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
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
    messageContainer = ensureMessageContainer();

    // Instead of ensureThinkingContainer, we rely on deepSeekProcessor.renderThinkingContainer
    thinkingContainer = deepSeekProcessor.renderThinkingContainer(
      messageContainer,
      thinkingTextBuffer
    );

    const separated = deepSeekProcessor.separateContentBuffers(mainTextBuffer, thinkingTextBuffer);
    const mainContent = separated.mainContent;
    const thinkingContent = separated.thinkingContent;

    // Update main content
    if (mainContent) {
      const processedMain = deepSeekProcessor.processDeepSeekResponse(mainContent);
      renderContentEfficiently(messageContainer, processedMain, {
        scroll: !errorState,
        scrollOptions: { behavior: 'smooth' }
      });
    }

    // Update chain-of-thought
    if (thinkingContent) {
      deepSeekProcessor.renderThinkingContainer(thinkingContainer, thinkingContent);
      // Don't scroll the thinking container separately, let the main scroll happen once
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
    import('./ui/notificationManager.js').then(module => {
      module.removeTypingIndicator();
    });
    removeStreamingProgressIndicator();
  } finally {
    document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
    document.querySelectorAll('.streaming-progress').forEach(el => el.remove());
  }
  if (mainTextBuffer && messageContainer) {
    try {
      const conversationId = await getSessionId(); // TODO: Update to get actual conversation ID when available
      if (!conversationId) {
        console.error('No valid conversation ID found — cannot store message.');
      } else {
        await fetchWithRetry(
          window.location.origin + `/api/chat/conversations/${conversationId}/messages`,
          {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
 * (Note: This is kept for backward compatibility but is no longer sent to the API.)
 * @returns {string} 'low', 'medium', or 'high'
 */
function getReasoningEffortSetting() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) {
    const value = parseInt(slider.value, 10);
    if (value === 1) return 'low';
    if (value === 3) return 'high';
    return 'medium';
  }
  return 'medium';
}
