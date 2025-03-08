/**
 * streaming.js - Core module for handling streaming chat responses
 * 
 * This module contains the functionality for processing streaming Server-Sent Events (SSE)
 * from the API and rendering them incrementally into the DOM. It's specifically enhanced
 * to support DeepSeek-R1 model responses with "thinking" blocks.
 */

import { getSessionId } from './session.js';
import { updateTokenUsage, fetchWithRetry, retry, eventBus } from './utils/helpers.js';
import { showNotification, handleMessageError } from './ui/notificationManager.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';
import {
  ensureMessageContainer,
  shouldRenderNow,
  showStreamingProgressIndicator,
  removeStreamingProgressIndicator,
  finalizeStreamingContainer,
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
let currentMessageContainer = null; // Track the current container element ID
let thinkingContainers = {}; // Store thinking containers by message ID

// --- Constants ---
const RENDER_INTERVAL_MS = 150;  // Increased from 50ms for better performance
const SCROLL_INTERVAL_MS = 500;  // Only scroll every 500ms to reduce jitter
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
 * Longer messages and certain model types get extended timeouts.
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
 * This is called at the start of each new streaming request to ensure a clean slate.
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
  currentMessageContainer = null; // Reset the container tracker
  thinkingContainers = {}; // Reset thinking containers

  // Clear out any existing streaming containers
  document.querySelectorAll('[data-streaming="true"]').forEach(el => {
    el.removeAttribute('data-streaming');
  });

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

    // Removed thinking mode toggle code

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
        
        // Removed thinking mode code
        
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

                      // CRITICAL FIX: Don't ignore whitespace-only chunks
                      if (onMessageCallback) {
                        onMessageCallback({ data: partialContent });
                        // Log empty chunks but still process them
                        if (!partialContent.trim()) {
                          console.log('[DeepSeek Partial] Received whitespace-only chunk, still processing.');
                        }
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
              
              // CRITICAL FIX: Create default usage data if none provided by the server
              let usageData = completionData.usage;
              
              if (!usageData) {
                console.log('[onCompleteCallback] No usage data provided, creating estimates');
                
                // Create token count estimates based on message and response lengths
                usageData = {
                  prompt_tokens: Math.max(Math.round(messageContent.length / 4), 1),
                  completion_tokens: Math.max(Math.round(mainTextBuffer.length / 4), 1),
                  total_tokens: 0
                };
                
                // Calculate total and add to the usage data
                usageData.total_tokens = usageData.prompt_tokens + usageData.completion_tokens;
                console.log('[onCompleteCallback] Created estimated usage data:', usageData);
              }
              
              if (usageData) {
                console.log('Token usage data:', usageData);

                // Enhance the token usage data with timing metrics
                const enhancedUsage = {
                  ...usageData,
                  // Include streaming performance metrics
                  latency: (performance.now() - streamStartTime).toFixed(0),
                  tokens_per_second: calculateTokensPerSecond(usageData)
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

function processDataChunkWrapper(data) {
  // Check if we're handling a DeepSeek model
  const modelSelect = document.getElementById('model-select');
  const currentModel = (modelSelect && modelSelect.value) ? modelSelect.value : 'DeepSeek-R1';
  const isDeepSeek = currentModel.toLowerCase().includes('deepseek');

  try {
    // CRITICAL FIX: More detailed logging of what's in the incoming data
    console.log('[processDataChunkWrapper] Processing chunk:',
      typeof data === 'object' ? JSON.stringify(data).substring(0, 100) : data);

    // For DeepSeek models, preprocess the chunks to avoid unwanted newlines
    if (isDeepSeek && typeof data === 'object') {
      // CRITICAL FIX: Handle both data.text and data.choices[0].delta.content formats
      let contentText = '';

      if (data.text) {
        contentText = data.text;
      } else if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
        contentText = data.choices[0].delta.content;
      }

      // Only process if we found content
      if (contentText) {
        // CRITICAL FIX: Don't skip content even if it's just whitespace
        // Remove any trailing newlines that would cause unwanted breaks
        contentText = contentText.replace(/\r?\n$/, '');

        // If this is a continuation and doesn't start with whitespace or punctuation,
        // ensure we have proper spacing from the previous chunk
        if (mainTextBuffer &&
          contentText.length > 0 &&
          !/^[\s\.,!?;:]/.test(contentText) &&
          !/[\s\.,!?;:]$/.test(mainTextBuffer)) {
          contentText = ' ' + contentText;
        }

        // CRITICAL FIX: Set this back into the right property
        if (data.text) {
          data.text = contentText;
        } else if (data.choices && data.choices[0] && data.choices[0].delta) {
          data.choices[0].delta.content = contentText;
        }
      }
    }

    // CRITICAL FIX: Always create the container first before processing chunks
    if (!messageContainer) {
      messageContainer = ensureMessageContainer();
      if (messageContainer) {
        console.log('[processDataChunkWrapper] Created container:', messageContainer.id);
        currentMessageContainer = messageContainer.id;
      }
    }

    // Handle DeepSeek-specific thinking blocks and HTML formatting
    const processedData = deepSeekProcessor.preprocessChunk ?
      deepSeekProcessor.preprocessChunk(data) : data;

    // CRITICAL FIX: Log what's going on with the buffer before & after processing
    console.log(`[processDataChunkWrapper] Current buffer lengths - Main: ${mainTextBuffer.length}, Thinking: ${thinkingTextBuffer.length}`);

    const result = deepSeekProcessor.processChunkAndUpdateBuffers(
      processedData,
      chunkBuffer,
      mainTextBuffer,
      thinkingTextBuffer,
      isThinking
    );

    // CRITICAL FIX: Even if buffers didn't update, render what we have
    mainTextBuffer = result.mainTextBuffer || '';
    thinkingTextBuffer = result.thinkingTextBuffer || '';
    chunkBuffer = result.chunkBuffer || '';
    isThinking = result.isThinking || false;

    console.log(`[processDataChunkWrapper] After processing - Main buffer length: ${mainTextBuffer.length}`);

    // Check if we're entering a thinking state
    if (isThinking && thinkingTextBuffer) {
      // Use current message ID for this thinking container
      if (!thinkingContainers[currentMessageId]) {
        // Create a new thinking container for this thinking block
        thinkingContainers[currentMessageId] = deepSeekProcessor.renderThinkingContainer(
          messageContainer,
          thinkingTextBuffer,
          { createNew: true }
        );
      }
      thinkingContainer = thinkingContainers[currentMessageId];
    }

    // CRITICAL FIX: Ensure content is always displayed, even if it's inside thinking blocks
    let shouldForceRender = false;
    
    // If we have any content at all, we should render
    if (mainTextBuffer.length > 0 || thinkingTextBuffer.length > 0) {
      shouldForceRender = true;
    }
    
    // For DeepSeek models, always force render on every chunk
    if (isDeepSeek) {
      shouldForceRender = true;
    }
    
    if (shouldForceRender) {
      console.log('[processDataChunkWrapper] Forcing render');
      renderBufferedContent();
    }
  } catch (error) {
    console.error("[processDataChunkWrapper] Error processing chunk:", error);
    // Continue processing despite errors to avoid breaking the stream
  }
}
/**
 * Schedules a DOM render if enough time has passed.
 * This throttles rendering to reduce unnecessary DOM updates.
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
 * Used for error states and final rendering.
 */
function forceRender() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  renderBufferedContent();
  lastRenderTimestamp = Date.now();
}

function renderBufferedContent() {
  try {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;

    // FIXED: Find existing container or create a new one
    if (!messageContainer) {
      // Try to find an existing streaming container first
      const existingContainer = chatHistory.querySelector('.assistant-message[data-streaming="true"]');

      if (existingContainer) {
        messageContainer = existingContainer;
        console.log('[renderBufferedContent] Found existing container:', messageContainer.id);
      } else {
        // Create a new container if none exists
        messageContainer = document.createElement('div');
        messageContainer.className = 'message assistant-message';
        messageContainer.setAttribute('role', 'log');
        messageContainer.setAttribute('aria-live', 'polite');
        messageContainer.setAttribute('data-streaming', 'true');
        messageContainer.id = `message-${Date.now()}`;

        // CRITICAL FIX: Set important styles to ensure visibility
        messageContainer.style.display = 'block';
        messageContainer.style.minHeight = '40px';
        messageContainer.style.opacity = '1';
        messageContainer.style.visibility = 'visible';

        // Add debug class to help troubleshoot
        messageContainer.classList.add('debug-streaming-container');

        // CRITICAL FIX: Create a content div to ensure text is properly contained
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.style.width = '100%';
        contentDiv.style.minHeight = '20px';
        contentDiv.innerHTML = ''; // Start with empty content
        messageContainer.appendChild(contentDiv);

        // Add it to the chat history
        chatHistory.appendChild(messageContainer);

        console.log('[renderBufferedContent] Created new container:', messageContainer.id);
      }

      // Track the current message container
      currentMessageContainer = messageContainer.id;
    }

    // Get both content buffers with proper boundary handling
    const separated = deepSeekProcessor.separateContentBuffers(
      mainTextBuffer || '',
      thinkingTextBuffer || ''
    );

    const mainContent = separated.mainContent || '';
    const thinkingContent = separated.thinkingContent || '';

    // CRITICAL FIX: Ensure we have content to render before continuing
    console.log('[renderBufferedContent] Content length:', mainContent.length);
    if (mainContent.length > 0) {
      // CRITICAL FIX: Find the content div within the container
      const contentTarget = messageContainer.querySelector('.message-content') || messageContainer;

      // Modified approach: Use a balanced method that preserves both content types
      // Regular user-visible content gets the thinking blocks removed for clean display
      const processedMain = deepSeekProcessor.processDeepSeekResponse(mainContent);
      
      // Log what's happening with content processing for debugging
      console.log('[renderBufferedContent] Original content length:', mainContent.length, 
                  'Processed content length:', processedMain.length);

      // Only scroll periodically to reduce jitter
      const shouldScroll = (Date.now() - lastScrollTimestamp > SCROLL_INTERVAL_MS) && !errorState;

      // CRITICAL FIX: Direct text rendering fallback before trying efficient renderer
      if (processedMain.length < 1000 && !/<[a-z][\s\S]*>/i.test(processedMain)) {
        contentTarget.textContent = processedMain;
        contentTarget.__previousHtml = processedMain;
        console.log('[renderBufferedContent] Used direct textContent rendering');
      } else {
        // Try normal rendering
        renderContentEfficiently(contentTarget, processedMain, {
          scroll: shouldScroll,
          scrollOptions: { behavior: shouldScroll ? 'smooth' : 'auto' }
        });
      }

      if (shouldScroll) {
        lastScrollTimestamp = Date.now();
        showStreamingProgressIndicator(messageContainer);
      }
    } else {
      console.log('[renderBufferedContent] No main content to render yet');
    }

    // Handle thinking content separately to prevent layout thrashing
    if (thinkingTextBuffer) {
      console.log('[renderBufferedContent] Handling thinking content, length:', thinkingTextBuffer.length);
      
      // Make sure we have a dedicated container for the current thinking block
      if (!thinkingContainers[currentMessageId]) {
        console.log('[renderBufferedContent] Creating new thinking container for message:', currentMessageId);
        thinkingContainers[currentMessageId] = deepSeekProcessor.renderThinkingContainer(
          messageContainer,
          thinkingTextBuffer
        );
      }

      thinkingContainer = thinkingContainers[currentMessageId];

      if (thinkingContainer && thinkingTextBuffer) {
        // Update content in the correct container
        const thinkingPre = thinkingContainer.querySelector('.thinking-pre');
        if (thinkingPre) {
          // CRITICAL FIX: Sanitize and apply simple markdown formatting
          try {
            console.log('[renderBufferedContent] Updating thinking content. Sample:', 
                       thinkingTextBuffer.substring(0, 50) + '...');
            
            // Apply minimal markdown formatting for better readability
            const formattedThinking = thinkingTextBuffer
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.*?)\*/g, '<em>$1</em>')
              .replace(/`([^`]+)`/g, '<code>$1</code>')
              .replace(/\n/g, '<br>');
            
            const sanitized = DOMPurify ? DOMPurify.sanitize(formattedThinking, {
              ALLOWED_TAGS: ['br', 'b', 'i', 'strong', 'em', 'code', 'pre'],
              KEEP_CONTENT: true
            }) : formattedThinking;
            
            // Set the content and make sure it's visible
            thinkingPre.innerHTML = sanitized || '(processing...)';
            thinkingPre.style.display = 'block';
            thinkingPre.style.minHeight = '20px';
            
            // Make sure the thinking container itself is visible
            const thinkingContent = thinkingContainer.closest('.thinking-content');
            if (thinkingContent) {
              thinkingContent.style.display = 'block';
            }
          } catch (err) {
            console.error('[renderBufferedContent] Error updating thinking content:', err);
            // Fallback to text content if sanitization fails
            thinkingPre.textContent = thinkingTextBuffer;
          }
        } else {
          console.warn('[renderBufferedContent] No .thinking-pre element found in container');
        }
      } else {
        console.warn('[renderBufferedContent] No valid thinking container found');
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
    // Remove typing indicators
    const { removeTypingIndicator } = await import('./ui/notificationManager.js');
    removeTypingIndicator();
    removeStreamingProgressIndicator();

    // Finalize the streaming container
    if (messageContainer) {
      finalizeStreamingContainer(messageContainer);
    }
  } catch (error) {
    console.error('[cleanupStreaming] Error cleaning up indicators:', error);
  } finally {
    document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
    document.querySelectorAll('.streaming-progress').forEach(el => el.remove());
  }

  // Store message in database
  if (messageContainer) {
    try {
      const conversationId = await getSessionId();
      if (!conversationId) {
        console.error('No valid conversation ID found — cannot store message.');
      } else {
        // CRITICAL FIX: Include both mainTextBuffer and thinkingTextBuffer in the final message
        // This ensures chain-of-thought content is preserved in the stored message
        let finalContent = mainTextBuffer || ' ';  // Use a space if buffer is empty
        
        // If we have thinking content, make sure it's included in the final message
        if (thinkingTextBuffer && thinkingTextBuffer.trim()) {
          console.log('[cleanupStreaming] Including thinking content in final message, length:', thinkingTextBuffer.length);
          // Don't remove the thinking tags so they can be rendered properly when retrieved
          finalContent = finalContent.includes('<think>') ? 
            finalContent : // Thinking blocks already included in main buffer
            finalContent + (finalContent ? '\n\n' : '') + '<think>' + thinkingTextBuffer + '</think>';
        }
        
        console.log('[cleanupStreaming] Storing complete message with content length:', finalContent.length);
        
        await fetchWithRetry(
          window.location.origin + `/api/chat/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: 'assistant',
              content: finalContent,
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

// Add this function to streaming.js

/**
 * For debugging rendering issues - call from browser console
 */
window.debugStreamingState = function () {
  console.log('--- STREAMING DEBUG INFO ---');
  console.log('Main buffer length:', mainTextBuffer?.length || 0);
  console.log('Main buffer content:', mainTextBuffer?.substring(0, 100) + '...');
  console.log('Thinking buffer length:', thinkingTextBuffer?.length || 0);
  console.log('Current message container:', messageContainer?.id || 'none');
  console.log('Current message container content:', messageContainer?.innerHTML?.substring(0, 100) || 'none');

  // Count streaming containers
  const containers = document.querySelectorAll('.assistant-message[data-streaming="true"]');
  console.log('Active streaming containers:', containers.length);

  containers.forEach((container, i) => {
    console.log(`Container ${i} ID:`, container.id || 'no-id');
    console.log(`Container ${i} content length:`, container.textContent?.length || 0);
    console.log(`Container ${i} visibility:`,
      window.getComputedStyle(container).visibility,
      window.getComputedStyle(container).display);
  });

  // Check if any CSS might be hiding content
  const styleSheets = document.styleSheets;
  let hidingRules = [];

  try {
    for (let i = 0; i < styleSheets.length; i++) {
      const rules = styleSheets[i].cssRules || styleSheets[i].rules;
      if (!rules) continue;

      for (let j = 0; j < rules.length; j++) {
        const rule = rules[j];
        if (rule.selectorText &&
          (rule.selectorText.includes('.assistant-message') ||
            rule.selectorText.includes('.message'))) {
          if (rule.style.display === 'none' ||
            rule.style.visibility === 'hidden' ||
            rule.style.opacity === '0') {
            hidingRules.push(rule.selectorText);
          }
        }
      }
    }
  } catch (e) {
    console.log('Error checking CSS rules:', e);
  }

  console.log('CSS rules that might hide content:', hidingRules);

  return 'Debug info logged to console';
};
