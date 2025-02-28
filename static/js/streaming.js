import { getSessionId } from './session.js';
import { updateTokenUsage } from './utils/helpers.js';
import { showNotification, handleMessageError, removeTypingIndicator } from './ui/notificationManager.js';
import { processDeepSeekResponse, deepSeekProcessor } from './ui/deepseekProcessor.js';

// State management
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

// Config
const RENDER_INTERVAL_MS = 50;

/**
 * Stream chat response with optimized rendering and error handling
 */
export async function streamChatResponse(
  messageContent,
  sessionId,
  modelName = 'DeepSeek-R1',
  developerConfig = '',
  reasoningEffort = 'medium',
  signal
) {
  resetStreamingState();
  isProcessing = true;
  
  try {
    if (!sessionId) {
      throw new Error('Invalid sessionId: Session ID is required for streaming');
    }
    
    // Build API URL and parameters
    let apiUrl = `/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    let requestParams = new URLSearchParams({
      model: modelName || 'DeepSeek-R1',
      message: messageContent || '',
      reasoning_effort: reasoningEffort || 'medium'
    });
    
    if (developerConfig) {
      requestParams.append('developer_config', developerConfig);
    }
    
    if (modelName.toLowerCase().includes('deepseek')) {
      requestParams.append('enable_thinking', 'true');
    }
    
    const fullUrl = `${apiUrl}&${requestParams.toString()}`;
    console.log(`[streamChatResponse] Connecting to: ${fullUrl}`);
    
    // Create EventSource with error and timeout handling
    const eventSource = new EventSource(fullUrl);
    const connectionTimeout = setTimeout(() => {
      if (eventSource && eventSource.readyState === 0) {
        eventSource.close();
        handleStreamingError(Object.assign(new Error('Connection timeout'), {
          name: 'TimeoutError', 
          recoverable: true
        }));
      }
    }, 10000);
    
    // Attach AbortSignal
    if (signal) {
      signal.addEventListener('abort', () => {
        eventSource.close();
        handleStreamingError(new Error('Request aborted'));
      });
    }
    
    // Connection state tracking
    let connectionClosed = false;
    
    // Setup event handlers
    eventSource.onopen = () => {
      clearTimeout(connectionTimeout);
      console.log('[streamChatResponse] SSE connection opened successfully');
    };
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        processStreamingChunk(data);
        scheduleRender();
      } catch (error) {
        console.error('[streamChatResponse] Error processing message:', error);
        if (mainTextBuffer || thinkingTextBuffer) forceRender();
      }
    };
    
    // Error handler
    const errorHandler = (event) => {
      clearTimeout(connectionTimeout);
      
      // Quick network status check
      if (!navigator.onLine) {
        handleStreamingError(Object.assign(new Error('Network offline'), {
          name: 'NetworkError',
          recoverable: true
        }));
        return;
      }
      
      // Parse error data if available
      if (event.data && typeof event.data === 'string') {
        try {
          const errorData = JSON.parse(event.data);
          const errorMessage = errorData.error?.message || errorData.message || errorData.detail || 'Server error';
          handleStreamingError(Object.assign(new Error(errorMessage), {
            name: 'ServerError',
            data: errorData,
            recoverable: true
          }));
        } catch (jsonError) {
          handleStreamingError(new Error(`Server sent invalid response: ${event.data.substring(0, 100)}`));
        }
      } else {
        // Create appropriate error based on connection state
        let error = new Error('Connection error');
        error.name = 'ConnectionError';
        error.readyState = event.target?.readyState;
        error.recoverable = true;
        
        handleStreamingError(error);
      }
    };
    
    eventSource.addEventListener('error', errorHandler);
    
    eventSource.onerror = (event) => {
      clearTimeout(connectionTimeout);
      
      if (!connectionClosed) {
        connectionClosed = true;
        eventSource.close();
        
        if (!errorState) {
          errorState = true;
          
          if (mainTextBuffer || thinkingTextBuffer) {
            forceRender();
          }
          
          // Create error message based on context
          let error = new Error(!navigator.onLine 
            ? 'Internet connection lost' 
            : (event.status ? `Connection failed with status: ${event.status}` : 'Connection failed'));
            
          error.name = !navigator.onLine ? 'NetworkError' : 'ConnectionError';
          error.recoverable = true;
          
          handleMessageError(error);
          
          // Offer recovery options
          if (navigator.onLine) {
            showNotification('Connection failed. Would you like to retry?', 'error', 0, [{
              text: 'Retry',
              action: () => attemptErrorRecovery(messageContent, error),
              primary: true
            }]);
          } else {
            window.addEventListener('online', () => {
              showNotification('Connection restored. Retrying...', 'info');
              attemptErrorRecovery(messageContent, error);
            }, { once: true });
          }
        }
      }
      
      try {
        eventSource.removeEventListener('error', errorHandler);
      } catch (e) {
        console.warn('[streamChatResponse] Error removing event listener:', e);
      }
    };
    
    eventSource.addEventListener('complete', (event) => {
      try {
        if (event.data) {
          const completionData = JSON.parse(event.data);
          if (completionData.usage) updateTokenUsage(completionData.usage);
        }
        
        forceRender();
        eventSource.close();
      } catch (error) {
        console.error('[streamChatResponse] Error handling completion:', error);
      } finally {
        cleanupStreaming();
      }
    });
    
    return true;
  } catch (error) {
    console.error('[streamChatResponse] Setup error:', error);
    
    if (error.message && error.message.includes('Failed to fetch')) {
      error.message = 'Could not connect to API server - network error';
      error.recoverable = true;
    }
    
    await handleStreamingError(error);
    return false;
  }
}

/**
 * Process a streaming chunk of text
 */
function processStreamingChunk(data) {
  if (!data.choices || data.choices.length === 0) return;
  
  data.choices.forEach(choice => {
    if (choice.delta && choice.delta.content) {
      const text = choice.delta.content;
      chunkBuffer += text;
      
      // Process thinking blocks
      const processThinkingBlocks = () => {
        const openTagIndex = chunkBuffer.indexOf('<think>');
        if (openTagIndex === -1) {
          if (!isThinking) {
            mainTextBuffer = processDeepSeekResponse(mainTextBuffer + chunkBuffer);
            chunkBuffer = '';
          }
          return;
        }
        
        if (openTagIndex >= 0) {
          if (openTagIndex > 0 && !isThinking) {
            mainTextBuffer = processDeepSeekResponse(mainTextBuffer + chunkBuffer.substring(0, openTagIndex));
          }
          
          const closeTagIndex = chunkBuffer.indexOf('</think>', openTagIndex);
          
          if (closeTagIndex >= 0) {
            isThinking = false;
            thinkingTextBuffer = chunkBuffer.substring(openTagIndex + 7, closeTagIndex);
            ensureThinkingContainer();
            
            const afterThink = chunkBuffer.substring(closeTagIndex + 8);
            chunkBuffer = afterThink;
            
            if (afterThink.length > 0) {
              processThinkingBlocks();
            }
          } else {
            isThinking = true;
            thinkingTextBuffer = chunkBuffer.substring(openTagIndex + 7);
            chunkBuffer = '';
          }
        }
      };
      
      processThinkingBlocks();
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

/**
 * Schedule a render with debouncing for performance
 */
function scheduleRender() {
  const now = Date.now();
  
  if (now - lastRenderTimestamp >= RENDER_INTERVAL_MS) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    animationFrameId = requestAnimationFrame(() => {
      renderBufferedContent();
      lastRenderTimestamp = now;
      animationFrameId = null;
    });
  }
}

/**
 * Force an immediate render regardless of debounce interval
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
 * Render buffered content to DOM
 */
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
  } catch (error) {
    console.error('[renderBufferedContent] Error:', error);
  }
}

/**
 * Create message container if it doesn't exist
 */
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

/**
 * Create thinking container with improved UI
 */
function ensureThinkingContainer() {
  ensureMessageContainer();
  
  if (!thinkingContainer && messageContainer) {
    const thinkingProcess = document.createElement('div');
    thinkingProcess.className = 'thinking-process border border-blue-200 dark:border-blue-800 rounded-md overflow-hidden my-3';

    const thinkingHeader = document.createElement('div');
    thinkingHeader.className = 'thinking-header bg-blue-50 dark:bg-blue-900/30 px-3 py-2';
    thinkingHeader.innerHTML = `
      <button class="thinking-toggle w-full text-left flex items-center justify-between text-blue-700 dark:text-blue-300" aria-expanded="true">
        <span class="font-medium">Thinking Process</span>
        <span class="toggle-icon transition-transform duration-200">▼</span>
      </button>
    `;

    thinkingHeader.querySelector('.thinking-toggle').addEventListener('click', function() {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !expanded);
      const content = this.closest('.thinking-process').querySelector('.thinking-content');
      content.classList.toggle('hidden', expanded);
      this.querySelector('.toggle-icon').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    });

    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content bg-blue-50/50 dark:bg-blue-900/10 relative';

    const thinkingPre = document.createElement('pre');
    thinkingPre.className = 'thinking-pre font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200 px-4 py-3 max-h-[300px] overflow-y-auto';
    thinkingContainer = thinkingPre;

    const gradientOverlay = document.createElement('div');
    gradientOverlay.className = 'absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-blue-50/90 dark:from-blue-900/30 to-transparent pointer-events-none';
    gradientOverlay.id = 'thinking-gradient';

    thinkingContent.appendChild(thinkingPre);
    thinkingContent.appendChild(gradientOverlay);
    thinkingProcess.appendChild(thinkingHeader);
    thinkingProcess.appendChild(thinkingContent);

    messageContainer.appendChild(thinkingProcess);
  }
  
  if (thinkingContainer && thinkingTextBuffer) {
    thinkingContainer.textContent = thinkingTextBuffer;
  }
}

/**
 * Finalize thinking container once thinking is complete
 */
function finalizeThinkingContainer() {
  if (thinkingContainer) {
    thinkingContainer.textContent = thinkingTextBuffer;
    
    const toggleButton = thinkingContainer.closest('.thinking-process').querySelector('.thinking-toggle');
    const gradientOverlay = document.getElementById('thinking-gradient');
    
    if (thinkingContainer.scrollHeight <= thinkingContainer.clientHeight) {
      if (gradientOverlay) gradientOverlay.remove();
    }
    
    thinkingContainer = null;
    thinkingTextBuffer = '';
  }
}

/**
 * Handle streaming error with recovery options
 */
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
      
      const userFriendlyMessage = !navigator.onLine ? 'Network connection lost' : 
                                 error.name === 'TimeoutError' ? 'Request timed out' : 
                                 error.message || 'An unexpected error occurred';
      
      await handleMessageError({
        ...error,
        message: userFriendlyMessage
      });
    } catch (e) {
      console.error('[handleStreamingError] Error handling stream error:', e);
    }
  }
}

/**
 * Attempt to recover from streaming errors
 */
async function attemptErrorRecovery(messageContent, error) {
  // Handle network offline state
  if (!navigator.onLine) {
    showNotification('Waiting for internet connection...', 'warning', 0);
    
    return new Promise(resolve => {
      window.addEventListener('online', async () => {
        await new Promise(r => setTimeout(r, 1500));
        showNotification('Connection restored. Retrying...', 'info', 3000);
        
        const sessionId = getSessionId();
        if (!sessionId) {
          showNotification('Could not retrieve session ID', 'error');
          resolve(false);
          return;
        }
        
        const modelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
        const developerConfig = document.getElementById('developer-config')?.value || '';
        const reasoningEffort = getReasoningEffortSetting();
        
        try {
          const success = await streamChatResponse(
            messageContent, sessionId, modelName, developerConfig, reasoningEffort);
          resolve(success);
        } catch (e) {
          showNotification('Recovery failed', 'error');
          resolve(false);
        }
      }, { once: true });
    });
  }
  
  // Handle recoverable errors
  if (error.recoverable || ['ConnectionError', 'NetworkError', 'TimeoutError'].includes(error.name)) {
    showNotification('Retrying connection...', 'info', 3000);
    await new Promise(r => setTimeout(r, 2000));
    
    const sessionId = getSessionId();
    if (!sessionId) {
      showNotification('Could not retrieve session ID', 'error');
      return false;
    }
    
    const modelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
    const developerConfig = document.getElementById('developer-config')?.value || '';
    const reasoningEffort = getReasoningEffortSetting();
    
    try {
      return await streamChatResponse(
        messageContent, sessionId, modelName, developerConfig, reasoningEffort);
    } catch (e) {
      showNotification('Recovery failed', 'error');
      return false;
    }
  }
  
  showNotification('Cannot retry - please refresh and try again', 'error');
  return false;
}

/**
 * Reset streaming state for a new request
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
 * Clean up after streaming completes
 */
function cleanupStreaming() {
  isProcessing = false;
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  removeTypingIndicator();
  
  if (mainTextBuffer && messageContainer) {
    try {
      const sessionId = getSessionId();
      
      if (sessionId) {
        fetch(`/api/chat/conversations/store?session_id=${sessionId}&role=assistant&content=${encodeURIComponent(mainTextBuffer)}`)
          .catch(err => console.warn('Failed to store message:', err));
      }
    } catch (e) {
      console.warn('Failed to store message:', e);
    }
  }
}

/**
 * Get the current reasoning effort setting
 */
function getReasoningEffortSetting() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) {
    const value = parseInt(slider.value);
    return value === 1 ? 'low' : value === 3 ? 'high' : 'medium';
  }
  return 'medium';
}
