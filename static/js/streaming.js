import { getSessionId } from './session.js';
import { updateTokenUsage, fetchWithRetry, retry, eventBus } from './utils/helpers.js';
import { showNotification, handleMessageError, removeTypingIndicator } from './ui/notificationManager.js';
import { processDeepSeekResponse, deepSeekProcessor } from './ui/deepseekProcessor.js';

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
const BASE_CONNECTION_TIMEOUT_MS = 90000; // Increase base timeout to 90 seconds
const MAX_CONNECTION_TIMEOUT_MS = 360000; // Increase max timeout to 6 minutes
const MAX_RETRY_ATTEMPTS = 3;
const CONNECTION_CHECK_INTERVAL_MS = 15000; // Check connection status every 15 seconds

/**
 * Calculate connection timeout based on model type and reasoning effort
 * @param {string} modelName - The model name
 * @param {string} reasoningEffort - Reasoning effort (low, medium, high)
 * @param {number} messageLength - Length of message content
 * @returns {number} - Connection timeout in milliseconds
 */
function calculateConnectionTimeout(modelName, reasoningEffort, messageLength) {
  // Base timeout is 90 seconds
  let timeout = BASE_CONNECTION_TIMEOUT_MS;
  
  const normalizedModelName = modelName ? modelName.toLowerCase() : '';
  
  // Adjust for model type with more reliable model detection
  if (normalizedModelName.includes('o1') || normalizedModelName.includes('o3')) {
    timeout *= 3.5; // Increase timeout for O-series models
  } else if (normalizedModelName.includes('claude')) {
    timeout *= 2.5; // Increase timeout for Claude models
  } else if (normalizedModelName.includes('deepseek')) {
    timeout *= 2.0; // Add specific timeout for DeepSeek models
  }
  
  // Adjust for reasoning effort
  if (reasoningEffort === 'high') {
    timeout *= 2.5; // Increase time for high reasoning
  } else if (reasoningEffort === 'medium') {
    timeout *= 1.8; // Increase time for medium reasoning
  } else if (reasoningEffort === 'low') {
    timeout *= 1; // No adjustment for low reasoning
  }
  
  // Adjust for message length (longer messages need more time to process)
  if (messageLength > 1000) {
    timeout *= 1 + (messageLength / 8000); // Increase timeout for long messages
  }
  
  // Cap at maximum timeout
  return Math.min(timeout, MAX_CONNECTION_TIMEOUT_MS);
}

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
      throw new Error('Invalid sessionId: Session ID is required for streaming');
    }
    
    // Ensure modelName is defined and valid
    const validModelName = modelName || 'DeepSeek-R1';
    const normalizedModelName = validModelName.toLowerCase();
    
    const apiUrl = `${window.location.origin}/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    const params = new URLSearchParams({
      model: validModelName,
      message: messageContent || '',
      reasoning_effort: reasoningEffort || 'medium'
    });
    
    if (developerConfig) params.append('developer_config', developerConfig);
    
    // More reliable detection for DeepSeek models
    if (normalizedModelName.includes('deepseek')) {
      params.append('enable_thinking', 'true');
      console.log('DeepSeek model detected, enabling thinking mode');
    }
    
    const fullUrl = `${apiUrl}&${params.toString()}`;
    console.log(`Connecting to streaming endpoint with model: ${validModelName}`);
    
    const eventSource = new EventSource(fullUrl);
    
    // Calculate dynamic timeout based on model, reasoning effort, and message length
    const connectionTimeoutMs = calculateConnectionTimeout(validModelName, reasoningEffort, messageContent.length);
    console.log(`Setting connection timeout to ${connectionTimeoutMs}ms for ${validModelName}`);
    
    // Set up connection timeout to detect stalled connections
    connectionTimeoutId = setTimeout(() => {
      if (eventSource && eventSource.readyState !== 2) { // 2 is CLOSED
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
    
    // Set up periodic connection check
    connectionCheckIntervalId = setInterval(() => {
      if (eventSource.readyState === 2) { // CLOSED
        clearInterval(connectionCheckIntervalId);
      }
    }, CONNECTION_CHECK_INTERVAL_MS);

    if (signal) {
      signal.addEventListener('abort', () => {
        if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
        if (connectionCheckIntervalId) clearInterval(connectionCheckIntervalId);
        eventSource.close();
        handleStreamingError(new Error('Request aborted'));
      });
    }

    let connectionClosed = false;

    eventSource.onopen = () => {
      if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
      // Reset connectionTimeoutId with a longer duration after connection is established
      connectionTimeoutId = setTimeout(() => {
        if (eventSource && eventSource.readyState !== 2) {
          console.warn(`Stream appears stalled after ${connectionTimeoutMs * 1.5}ms`);
          eventSource.close();
          handleStreamingError(Object.assign(new Error('Stream stalled'), {
            name: 'TimeoutError',
            modelName: validModelName,
            reasoningEffort,
            recoverable: true
          }));
        }
      }, connectionTimeoutMs * 1.5);
      
      // Keep the interval for periodic checks even after connection is established
      eventBus.publish('streamingStarted', { modelName: validModelName });
    };

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        processDataChunk(data);
        scheduleRender();
      } catch (err) {
        console.error('[streamChatResponse] Error processing message:', err);
        if (mainTextBuffer || thinkingTextBuffer) forceRender();
      }
      eventSource.addEventListener('ping', (e) => {
        console.debug('[SSE Ping] keep-alive event received');
      });
    };

    eventSource.onerror = (e) => {
      // This callback is triggered when the SSE connection closes unexpectedly
      if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
      if (connectionCheckIntervalId) clearInterval(connectionCheckIntervalId);
      
      if (!connectionClosed) {
        connectionClosed = true;
        eventSource.close();
        
        // If offline:
        if (!navigator.onLine) {
          handleStreamingError(Object.assign(new Error('Network offline'), {
            name: 'NetworkError',
            recoverable: true
          }));
          return;
        }
        
        // If there's an error response in e.data:
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
        
        if (!errorState) {
          errorState = true;
          if (mainTextBuffer || thinkingTextBuffer) {
            forceRender();
          }
          
          const err = new Error(!navigator.onLine
            ? 'Internet connection lost'
            : (e.status ? `Connection failed with status: ${e.status}` : 'Connection failed (EventSource connection closed)'));
          
          err.name = !navigator.onLine ? 'NetworkError' : 'ConnectionError';
          err.recoverable = true;

          // Include additional diagnostic information
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

    eventSource.onerror = (e) => {
      if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
      if (connectionCheckIntervalId) clearInterval(connectionCheckIntervalId);
      handleStreamingError(new Error('Connection error during streaming'));
      reject(e);
    };

    return new Promise((resolve, reject) => {
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
          resolve(true);  // Resolve the promise
        }
      });

      eventSource.onerror = (e) => {
        if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
        if (connectionCheckIntervalId) clearInterval(connectionCheckIntervalId);
        handleStreamingError(new Error('Connection error during streaming'));
        reject(e);  // Reject the promise
      };
    });
}

/**
 * Simplified reconnection function that can be called from eventSource.onerror
 * with better error handling and model persistence
 */
function attemptReconnect(messageContent, sessionId, modelName, developerConfig, reasoningEffort) {
  const validModelName = modelName || 'DeepSeek-R1';
  
  console.warn(`[streaming.js] Attempting SSE reconnect in 3 seconds for model ${validModelName}...`);
  
  // Show a reconnection notification
  showNotification(`Connection lost. Attempting to reconnect in 3 seconds...`, 'warning');
  
  setTimeout(() => {
    // Only reconnect if we're online
    if (navigator.onLine) {
      console.log(`[streaming.js] Reconnecting with model: ${validModelName}`);
      streamChatResponse(messageContent, sessionId, validModelName, developerConfig, reasoningEffort);
    } else {
      console.warn('[streaming.js] Cannot reconnect - still offline');
      showNotification('Network is offline. Waiting for connection...', 'error');
      
      // When connection is restored, we'll try again
      window.addEventListener('online', () => {
        console.log(`[streaming.js] Network connection restored, reconnecting with model: ${validModelName}`);
        showNotification('Connection restored. Reconnecting...', 'info');
        streamChatResponse(messageContent, sessionId, validModelName, developerConfig, reasoningEffort);
      }, { once: true });
    }
  }, 3000);
}

function processDataChunk(data) {
  if (!data.choices || data.choices.length === 0) return;
  data.choices.forEach(choice => {
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
      if (result.remainingChunk) {
        chunkBuffer = result.remainingChunk;
        processDataChunk({ choices: [{ delta: { content: '' } }] });
      }
      if (isThinking && thinkingTextBuffer) {
        ensureThinkingContainer();
      }
    }
    if (choice.finish_reason) {
      if (chunkBuffer) {
        mainTextBuffer = processDeepSeekResponse(mainTextBuffer + chunkBuffer);
        chunkBuffer = '';
      }
      if (isThinking) {
        finalizeThinkingContainer();
        isThinking = false;
      }
    }
  });
}

function scheduleRender() {
  const now = Date.now();
  if (now - lastRenderTimestamp >= RENDER_INTERVAL_MS) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(() => {
      renderBufferedContent();
      updateStreamingProgress();
      lastRenderTimestamp = now;
      animationFrameId = null;
    });
  }
}

function updateStreamingProgress() {
  // Create or update streaming progress indicator
  let progressIndicator = document.getElementById('streaming-progress');
  if (!progressIndicator && messageContainer) {
    progressIndicator = document.createElement('div');
    progressIndicator.id = 'streaming-progress';
    progressIndicator.className = 'streaming-progress-indicator flex items-center text-xs text-dark-500 dark:text-dark-400 mt-2 mb-1';
    progressIndicator.innerHTML = `
      <div class="animate-pulse mr-2 h-1.5 w-1.5 rounded-full bg-primary-500"></div>
      <span>Receiving response...</span>
    `;
    messageContainer.appendChild(progressIndicator);
  }
}

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
    if (mainTextBuffer) {
      ensureMessageContainer();
      if (messageContainer) {
        if (window.renderAssistantMessage) {
          window.renderAssistantMessage(mainTextBuffer);
        } else {
          messageContainer.innerHTML = mainTextBuffer;
          messageContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
          deepSeekProcessor.initializeExistingBlocks();
        }
      }
    }
    if (thinkingTextBuffer && thinkingContainer) {
      thinkingContainer.textContent = thinkingTextBuffer;
      thinkingContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  } catch (err) {
    console.error('[renderBufferedContent] Error:', err);
  }
}

function ensureMessageContainer() {
  if (!messageContainer) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    messageContainer = document.createElement('div');
    messageContainer.className = 'message assistant-message';
    messageContainer.setAttribute('role', 'log');
    messageContainer.setAttribute('aria-live', 'polite');
    chatHistory.appendChild(messageContainer);
  }
}

function ensureThinkingContainer() {
  ensureMessageContainer();
  if (!thinkingContainer && messageContainer) {
    const thinkingWrapper = document.createElement('div');
    thinkingWrapper.innerHTML = deepSeekProcessor.createThinkingBlockHTML(thinkingTextBuffer);
    messageContainer.appendChild(thinkingWrapper.firstElementChild);
    thinkingContainer = messageContainer.querySelector('.thinking-pre');
    const toggleButton = messageContainer.querySelector('.thinking-toggle');
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
  if (thinkingContainer && thinkingTextBuffer) {
    thinkingContainer.textContent = thinkingTextBuffer;
  }
}

function finalizeThinkingContainer() {
  if (thinkingContainer) {
    thinkingContainer.textContent = thinkingTextBuffer;
    const toggleButton = messageContainer.querySelector('.thinking-toggle');
    const gradientOverlay = messageContainer.querySelector('.thinking-content > div:last-child');
    if (thinkingContainer.scrollHeight <= thinkingContainer.clientHeight && gradientOverlay) {
      gradientOverlay.remove();
    }
    thinkingContainer = null;
    thinkingTextBuffer = '';
  }
}

async function handleStreamingError(error) {
  console.error('[handleStreamingError]', error);
  if (!errorState) {
    errorState = true;
    try {
      if (mainTextBuffer || thinkingTextBuffer) {
        forceRender();
      }
      if (messageContainer && mainTextBuffer) {
        const errorNotice = document.createElement('div');
        errorNotice.className = 'py-2 px-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded mt-2';
        errorNotice.textContent = '⚠️ The response was interrupted. The content above may be incomplete.';
        messageContainer.appendChild(errorNotice);
      }
      removeTypingIndicator();
      const userFriendlyMessage = !navigator.onLine
        ? 'Network connection lost'
        : error.name === 'TimeoutError'
          ? 'Request timed out. Consider reducing reasoning effort or retrying.'
          : error.message || 'An unexpected error occurred';

      // Generate a unique error ID to prevent duplicate handling
      const errorId = `stream-error-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      error.errorId = errorId;

      // Display timeout-specific instructions in a modal
      if (error.name === 'TimeoutError') {
        // Import directly to avoid circular dependencies
        import('./ui/notificationManager.js').then(module => {
          // Create more detailed message with diagnostic info
          const modelInfo = error.modelName ? `<li>Model: ${error.modelName}</li>` : '';
          const reasoningInfo = error.reasoningEffort ? `<li>Reasoning effort: ${error.reasoningEffort}</li>` : '';
          
          module.showErrorModal('Connection Timeout', `
            <p>${userFriendlyMessage}</p>
            ${(modelInfo || reasoningInfo) ? `
            <p><strong>Diagnostic Information:</strong></p>
            <ul>
              ${modelInfo}
              ${reasoningInfo}
            </ul>` : ''}
            <p><strong>Suggestions:</strong></p>
            <ul>
              <li>Check your internet connection</li>
              <li>Reduce reasoning effort in the settings</li>
              <li>Try a different model if available</li>
              <li>Break your request into smaller parts</li>
              <li>Retry the request</li>
            </ul>
          `, [
            { 
              label: 'Retry', 
              variant: 'btn-primary', 
              action: () => {
                // Direct button click handler with proper access
                const btn = document.createElement('button');
                btn.id = `retry-btn-${errorId}`;
                btn.style.display = 'none';
                document.body.appendChild(btn);
                btn.addEventListener('click', () => {
                  if (typeof window.sendMessage === 'function') {
                    window.sendMessage();
                  } else {
                    console.warn('No sendMessage function available');
                  }
                });
                try {
                  setTimeout(() => btn.click(), 100);
                  setTimeout(() => btn.remove(), 500);
                } catch (ex) {
                  console.error('Unable to auto-click retry button:', ex);
                }
              }
            },
            { 
              label: 'Settings', 
              variant: 'btn-secondary', 
              action: () => {
                const configTab = document.getElementById('config-tab');
                if (configTab) {
                  // Use direct click instead of programmatic
                  configTab.click();
                }
              } 
            }
          ]);
        });
      } else {
        // Use a separate error handler path with error ID to prevent double reporting
        await handleMessageError({ ...error, message: userFriendlyMessage, errorId });
      }

      eventBus.publish('streamingError', {
        error,
        recoverable: error.recoverable || false,
        errorId
      });
    } catch (err) {
      console.error('[handleStreamingError] Error handling stream error:', err);
    }
  }
}

async function attemptErrorRecovery(messageContent, error) {
  // Check if we're offline
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
          
          // Get the currently selected model with fallback
          let modelName;
          try {
            const modelSelect = document.getElementById('model-select');
            modelName = modelSelect && modelSelect.value ? modelSelect.value : 'DeepSeek-R1';
          } catch (e) {
            console.warn('Error getting model from UI, using DeepSeek-R1 as fallback:', e);
            modelName = 'DeepSeek-R1';
          }
          
          const developerConfig = document.getElementById('developer-config')?.value || '';
          
          // For timeout errors, try with lower reasoning effort
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
  
  // Handle recoverable errors
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
      
      // For timeout errors, try with lower reasoning effort
      let reasoningEffort = getReasoningEffortSetting();
      if (error.name === 'TimeoutError' && reasoningEffort !== 'low') {
        reasoningEffort = 'low';
        showNotification('Retrying with lower reasoning effort', 'info', 3000);
      }
      
      try {
        // Add exponential backoff between retries
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

async function cleanupStreaming(modelName) {
  isProcessing = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  removeTypingIndicator();
  
  // Remove streaming progress indicator
  const progressIndicator = document.getElementById('streaming-progress');
  if (progressIndicator) {
    progressIndicator.remove();
  }
  
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
            model: modelName || 'DeepSeek-R1'  // Store the model name with the message
          })
        }).catch(err => console.warn('Failed to store message:', err));
      }
    } catch (e) {
      console.warn('Failed to store message:', e);
    }
  }
}

function getReasoningEffortSetting() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) {
    const value = parseInt(slider.value);
    return value === 1 ? 'low' : value === 3 ? 'high' : 'medium';
  }
  return 'medium';
}
