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
let lastScrollTimestamp = 0;
let currentMessageId = null; // Track the current message ID
let thinkingContainers = {}; // Store thinking containers by message ID

// --- Constants ---
const RENDER_INTERVAL_MS = 150;  // Increased from 50ms
const SCROLL_INTERVAL_MS = 500;  // Only scroll every 500ms
const BASE_CONNECTION_TIMEOUT_MS = 60000; // 60 seconds
const MAX_CONNECTION_TIMEOUT_MS = 180000; // 3 minutes
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
  currentMessageId = Date.now().toString(); // Generate a new ID for this message
  thinkingContainers = {}; // Reset thinking containers

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
    let finalModelName = modelName;
    const isOSeries = validModelName.indexOf('o1') !== -1 || validModelName.indexOf('o3') !== -1;
    const isDeepSeek = validModelName.includes('deepseek');

    if (finalModelName.trim().toLowerCase() === 'deepseek-r1') {
      // Map user-specified 'DeepSeek-R1' to the actual Azure deployment name if needed
      finalModelName = 'DeepSeek-R1';
      params.append('temperature', '0.5');
    }

    params.append('model', finalModelName);
    params.append('message', messageContent || '');

    if (isOSeries) {
      params.append('reasoning_effort', reasoningEffort || 'medium');
      params.append('response_format', 'json_schema');
      params.append('max_completion_tokens', '100000'); // Enforce O-series token limit
    } else if (reasoningEffort && !isDeepSeek) {
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

    const apiUrl = `${window.location.origin}/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    const fullUrl = apiUrl + '&' + params.toString();

    try {
      // Prepare headers with specific DeepSeek requirements
      const headers = {
        'Content-Type': 'application/json',
      };
      // DeepSeek-R1 requires specific headers
      if (isDeepSeek) {
        headers['x-ms-thinking-format'] = "html";
        headers['x-ms-streaming-version'] = "2024-05-01-preview";
        console.log("[streamChatResponse] Adding DeepSeek-R1 required headers");
      }

      // Use fetch API with proper headers
      const response = await fetch(fullUrl, {
        headers: headers,
        signal: signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // Create a simplified event handling mechanism without object extensions
      let onMessageCallback = null;
      let onErrorCallback = null;
      let onCompleteCallback = null;

      // Internal state for timeout detection
      let isStreamActive = true;

      const connectionTimeoutMs = calculateConnectionTimeout(validModelName, messageContent.length);
      console.log('Setting connection timeout to ' + connectionTimeoutMs + 'ms for ' + validModelName);

      // Set initial connection timeout
      connectionTimeoutId = setTimeout(() => {
        if (isStreamActive) {
          console.warn('Connection timed out after ' + connectionTimeoutMs + 'ms');
          isStreamActive = false;
          handleStreamingError(new Error('Connection timeout'));
          if (reader) reader.cancel();
        }
      }, connectionTimeoutMs);

      // Periodic connection check
      connectionCheckIntervalId = setInterval(() => {
        if (!isStreamActive) {
          clearInterval(connectionCheckIntervalId);
        }
      }, CONNECTION_CHECK_INTERVAL_MS);

      // Abort signal
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => {
          clearTimeout(connectionTimeoutId);
          clearInterval(connectionCheckIntervalId);
          isStreamActive = false;
          if (reader) reader.cancel();
        }, { once: true });
      }

      // Function to handle each SSE message
      const processChunk = async () => {
        try {
          const { value, done } = await reader.read();

          if (done) {
            isStreamActive = false;
            clearTimeout(connectionTimeoutId);
            clearInterval(connectionCheckIntervalId);

            if (onCompleteCallback) {
              onCompleteCallback({ data: '' });
            }

            await cleanupStreaming(finalModelName);
            resolve(true);
            return;
          }

          const text = decoder.decode(value);
          // Accumulate partial chunks in chunkBuffer and split only on complete SSE messages
          chunkBuffer += text;
          const chunks = chunkBuffer.split('\n\n');
          // Keep the last part in chunkBuffer if it's incomplete
          chunkBuffer = chunks.pop() || '';

          for (const rawLine of chunks) {
            const line = rawLine.trim();
            if (!line) continue;

            if (line.startsWith('data:')) {
              const dataPart = line.slice(5).trim();

              if (dataPart === 'done') {
                if (onCompleteCallback) {
                  onCompleteCallback({ data: '' });
                }
                continue;
              }

              try {
                const azureData = JSON.parse(dataPart);

                // Reset connection timeout on each message
                clearTimeout(connectionTimeoutId);
                connectionTimeoutId = setTimeout(() => {
                  if (isStreamActive) {
                    console.warn('Stream stalled after ' + (connectionTimeoutMs * 1.5) + 'ms');
                    isStreamActive = false;
                    handleStreamingError(new Error('Stream stalled'));
                    if (reader) reader.cancel();
                  }
                }, connectionTimeoutMs * 1.5);

                // Azure's SSE may include a 'kind' field. Let's handle that gracefully:
                if (azureData.kind) {
                  const kindLower = azureData.kind.toLowerCase();
                  if (kindLower === 'partial') {
                    // This is a partial chunk
                    if (azureData.choices && azureData.choices[0]) {
                      // Check for partial content in delta, fallback to message content, or raw data
                      const partialContent =
                        (azureData.choices[0].delta && azureData.choices[0].delta.content) ||
                        (azureData.choices[0].message && azureData.choices[0].message.content) ||
                        dataPart;

                      if (onMessageCallback && partialContent.trim()) {
                        onMessageCallback({ data: partialContent });
                      } else {
                        console.log('[DeepSeek Partial] Received empty or whitespace-only chunk, ignoring.');
                      }
                    }
                  } else if (kindLower === 'final') {
                    // The final chunk
                    if (azureData.choices && azureData.choices[0] && azureData.choices[0].delta) {
                      const finalContent = azureData.choices[0].delta.content || '';
                      if (onMessageCallback) {
                        onMessageCallback({ data: finalContent });
                      }
                    }
                  } else {
                    // Unrecognized kind, fallback to raw chunk
                    if (onMessageCallback) {
                      onMessageCallback({ data: dataPart });
                    }
                  }
                } else {
                  // No 'kind' field; fallback to typical pattern
                  if (azureData.choices && azureData.choices[0] && azureData.choices[0].delta) {
                    const typicalContent = azureData.choices[0].delta.content || '';
                    if (onMessageCallback) {
                      onMessageCallback({ data: typicalContent });
                    }
                  } else {
                    // Just pass the raw chunk
                    if (onMessageCallback) {
                      onMessageCallback({ data: dataPart });
                    }
                  }
                }
              } catch (err) {
                console.error('Error parsing SSE data from Azure Chat Completions:', err);
              }
            } else if (line.startsWith('event: complete')) {
              if (onCompleteCallback) {
                onCompleteCallback({ data: '' });
              }
            }
          }

          // Continue reading
          processChunk();
        } catch (error) {
          // Handle reader errors
          if (error.name !== 'AbortError') {
            handleStreamingError(error);
          }
          isStreamActive = false;
        }
      };

      // Handle message events
      onMessageCallback = (e) => {
        try {
          console.log('Received SSE chunk from server');

          let data;
          try {
            data = JSON.parse(e.data);
          } catch (parseError) {
            // If e.data is not valid JSON, wrap it in an object with a 'text' field
            data = { text: e.data };
          }

          // Special handling for DeepSeek model
          const modelSelect = document.getElementById('model-select');
          const currentModel = (modelSelect && modelSelect.value) ? modelSelect.value : 'DeepSeek-R1';
          const isDeepSeek = currentModel.toLowerCase().includes('deepseek');

          if (isDeepSeek) {
            // Handle both structured and unstructured responses
            if (typeof data.text === 'string') {
              // For text field format responses
              data.text = data.text.trim();
            } else if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              // For structured JSON response format with delta
              data.choices[0].delta.content = data.choices[0].delta.content.trim();
            } else if (typeof e.data === 'string' && e.data.trim()) {
              // For raw string data, ensure we have a clean object with text field
              data = { text: e.data.trim() };
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

      // Handle error events
      onErrorCallback = async (e) => {
        if (signal && signal.aborted) return;
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);
        isStreamActive = false;

        // Create error object with additional properties
        const error = new Error('Connection failed (EventSource closed)');
        error.recoverable = true;

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
      };

      // Handle complete events
      onCompleteCallback = async (e) => {
        try {
          clearTimeout(connectionTimeoutId);
          clearInterval(connectionCheckIntervalId);
          isStreamActive = false;

          if (e.data && e.data !== 'done') {
            try {
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
            } catch (err) {
              console.warn('Error parsing completion data:', err);
            }
          }

          forceRender();
        } catch (err) {
          console.error('[streamChatResponse] Error handling completion:', err);
        } finally {
          await cleanupStreaming(finalModelName);
          resolve(true);
        }
      };

      // Start the event stream processing
      eventBus.publish('streamingStarted', { modelName: validModelName });
      processChunk();
    } catch (error) {
      console.error('[streamChatResponse] Setup error:', error);
      handleStreamingError(error);
      reject(error);
    }
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
    errorStr.includes('deepseek service') ||
    errorStr.includes('missing deepseek required headers') ||
    errorStr.includes('invalid api version')
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
  // Check if we're handling a DeepSeek model
  const modelSelect = document.getElementById('model-select');
  const currentModel = (modelSelect && modelSelect.value) ? modelSelect.value : 'DeepSeek-R1';
  const isDeepSeek = currentModel.toLowerCase().includes('deepseek');

  // For DeepSeek models, preprocess the chunks to avoid unwanted newlines
  if (isDeepSeek && typeof data === 'object' && data.text) {
    // Remove any trailing newlines that would cause unwanted breaks
    data.text = data.text.replace(/\r?\n$/, '');

    // If this is a continuation and doesn't start with whitespace or punctuation,
    // ensure we have proper spacing from the previous chunk
    if (mainTextBuffer &&
      data.text &&
      data.text.length > 0 &&
      !/^[\s\.,!?;:]/.test(data.text) &&
      !/[\s\.,!?;:]$/.test(mainTextBuffer)) {
      data.text = ' ' + data.text;
    }
  }

  // Handle DeepSeek-specific thinking blocks and HTML formatting
  const processedData = deepSeekProcessor.preprocessChunk ?
    deepSeekProcessor.preprocessChunk(data) : data;

  const result = deepSeekProcessor.processChunkAndUpdateBuffers(
    processedData,
    chunkBuffer,
    mainTextBuffer,
    thinkingTextBuffer,
    isThinking
  );

  // Store the result (Fix for thinkingBuffer issue)
  mainTextBuffer = result.mainTextBuffer || '';
  thinkingTextBuffer = result.thinkingTextBuffer || '';
  chunkBuffer = result.chunkBuffer || '';
  isThinking = result.isThinking || false;

  // If the newly processed chunk is already contained in mainTextBuffer, skip appending again
  if (result.mainTextBuffer && mainTextBuffer && mainTextBuffer.endsWith(result.mainTextBuffer.trim())) {
    console.warn('[processDataChunkWrapper] Skipping repeated partial chunk...');
    return;
  }

  // Check if we're entering a thinking state
  if (isThinking && thinkingTextBuffer) {
    const container = ensureMessageContainer();
    messageContainer = container; // Ensure messageContainer is updated

    // Use current message ID for this thinking container
    if (!thinkingContainers[currentMessageId]) {
      // Create a new thinking container for this thinking block
      thinkingContainers[currentMessageId] = deepSeekProcessor.renderThinkingContainer(
        container,
        thinkingTextBuffer,
        { createNew: true }
      );
    }
    thinkingContainer = thinkingContainers[currentMessageId];
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
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;

    messageContainer = document.createElement('div');
    messageContainer.className = 'message assistant-message';
    const lastMessage = chatHistory.lastElementChild;
    if (lastMessage) {
      chatHistory.insertBefore(messageContainer, lastMessage.nextSibling);
    } else {
      chatHistory.appendChild(messageContainer);
    }

    // Get both content buffers with proper boundary handling
    const separated = deepSeekProcessor.separateContentBuffers(
      mainTextBuffer || '',
      thinkingTextBuffer || ''
    );

    const mainContent = separated.mainContent || '';
    const thinkingContent = separated.thinkingContent || '';

    // Update main content FIRST
    if (mainContent) {
      const processedMain = deepSeekProcessor.processDeepSeekResponse(mainContent);

      // Only scroll periodically to reduce jitter
      const shouldScroll = (Date.now() - lastScrollTimestamp > SCROLL_INTERVAL_MS) && !errorState;

      renderContentEfficiently(messageContainer, processedMain, {
        scroll: shouldScroll,
        scrollOptions: { behavior: shouldScroll ? 'smooth' : 'auto' }
      });

      if (shouldScroll) {
        lastScrollTimestamp = Date.now();
        showStreamingProgressIndicator(messageContainer);
      }
    }

    // Handle thinking content separately to prevent layout thrashing
    if (thinkingTextBuffer) {
      // Make sure we have a dedicated container for the current thinking block
      if (!thinkingContainers[currentMessageId]) {
        thinkingContainers[currentMessageId] = deepSeekProcessor.renderThinkingContainer(
          messageContainer,
          thinkingTextBuffer,
          { createNew: true }
        );
      }

      thinkingContainer = thinkingContainers[currentMessageId];

      if (thinkingContainer && thinkingTextBuffer) {
        // Update content in the correct container
        const thinkingPre = thinkingContainer.querySelector('.thinking-pre');
        if (thinkingPre) {
          const sanitized = DOMPurify ? DOMPurify.sanitize(thinkingTextBuffer) : thinkingTextBuffer;
          thinkingPre.innerHTML = sanitized;
        }
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
    // CORRECTED: Use dynamic import() instead of static import
    const { removeTypingIndicator } = await import('./ui/notificationManager.js');
    removeTypingIndicator();
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