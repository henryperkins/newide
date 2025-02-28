// Enhanced streaming.js with improved performance and error handling

import { getSessionId } from './session.js';
import { updateTokenUsage } from './utils/helpers.js';
import { showNotification, handleMessageError, removeTypingIndicator } from './ui/notificationManager.js';
import { processDeepSeekResponse, deepSeekProcessor } from './ui/deepseekProcessor.js';

// Performance optimization: use a buffer to batch DOM updates
let mainTextBuffer = '';
let thinkingTextBuffer = '';
let messageContainer = null;
let thinkingContainer = null;
let isThinking = false;
let lastRenderTimestamp = 0;
let animationFrameId = null;
let isProcessing = false;
let errorState = false;

// Debounce render frequency to reduce DOM operations
const RENDER_INTERVAL_MS = 50; // Update DOM every 50ms max

/**
 * Stream chat response with optimized rendering and error handling
 * 
 * @param {string} messageContent - User's message content
 * @param {string} sessionId - Current session ID
 * @param {string} modelName - Model to use
 * @param {string} developerConfig - System prompt
 * @param {string} reasoningEffort - Reasoning effort level
 * @param {AbortSignal} signal - AbortController signal for cancellation
 */
export async function streamChatResponse(
  messageContent,
  sessionId,
  modelName = 'DeepSeek-R1',
  developerConfig = '',
  reasoningEffort = 'medium',
  signal
) {
  // Clear buffers and state for new streaming response
  resetStreamingState();
  isProcessing = true;
  
  try {
    // Validate sessionId early to prevent malformed URLs
    if (!sessionId) {
      throw new Error('Invalid sessionId: Session ID is required for streaming');
    }
    
    // Build API URL with proper encoding
    let apiUrl = `/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    
    // Create URL params more carefully
    const params = new URLSearchParams();
    params.append('model', modelName || 'DeepSeek-R1');
    params.append('message', messageContent || '');
    params.append('reasoning_effort', reasoningEffort || 'medium');
    
    // Only add developer_config if it exists and is not null/undefined
    if (developerConfig) {
      params.append('developer_config', developerConfig);
    }
    
    // Add DeepSeek-specific params if applicable
    if (modelName.toLowerCase().includes('deepseek')) {
      params.append('enable_thinking', 'true'); // Ensure thinking blocks are enabled
    }
    
    // Construct the final URL with parameters
    const fullUrl = `${apiUrl}&${params.toString()}`;
    console.log(`[streamChatResponse] Connecting to: ${fullUrl}`);
    
    // Create EventSource with error and timeout handling
    const eventSource = new EventSource(fullUrl);
    
    // Add timeout handling - close connection if no 'open' event within 10 seconds
    const connectionTimeout = setTimeout(() => {
      if (eventSource && eventSource.readyState === 0) { // Still connecting
        console.warn('[streamChatResponse] Connection timeout - no response from server');
        eventSource.close();
        
        const timeoutError = new Error('Connection timeout - server did not respond');
        timeoutError.name = 'TimeoutError';
        timeoutError.recoverable = true;
        handleStreamingError(timeoutError);
      }
    }, 10000); // 10 second timeout
    
    const messages = [];
    
    // Add system message if provided
    if (developerConfig) {
      messages.push({
        role: "system",
        content: developerConfig
      });
    }
    
    // Add user message
    messages.push({
      role: "user",
      content: messageContent
    });
    
    // Set up EventSource for streaming
    const params = new URLSearchParams({
      model: modelName,
      message: messageContent,
      reasoning_effort: reasoningEffort,
      developer_config: developerConfig || null
    });
    
    // Add DeepSeek-specific params if applicable
    if (modelName.toLowerCase().includes('deepseek')) {
      params.append('enable_thinking', 'true'); // Ensure thinking blocks are enabled
    }
    
    const eventSource = new EventSource(`${apiUrl}&${params}`);
    
    // Attach AbortSignal to EventSource
    if (signal) {
      signal.addEventListener('abort', () => {
        eventSource.close();
        handleStreamingError(new Error('Request aborted'));
      });
    }
    
    // Setup event handlers
    eventSource.onopen = (event) => {
      clearTimeout(connectionTimeout);
      console.log('[streamChatResponse] SSE connection opened successfully');
      
      // Add additional diagnostics for debugging
      if (window.DEBUG_MODE) {
        console.log(`[streamChatResponse] Connection ready state: ${eventSource.readyState}`);
      }
    };
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Process and buffer the streaming chunks
        processStreamingChunk(data);
        
        // Schedule render with request animation frame for performance
        scheduleRender();
      } catch (error) {
        console.error('[streamChatResponse] Error processing message:', error);
        
        // Try to render any remaining content even if we hit an error
        if (mainTextBuffer || thinkingTextBuffer) {
          forceRender();
        }
      }
    };
    
    // Track connection state
    let connectionClosed = false;
    
    // Add improved error message listener
    const tempErrorHandler = (event) => {
      try {
        clearTimeout(connectionTimeout); // Clear timeout on any error event
        
        // Browser offline check
        if (!navigator.onLine) {
          console.warn('[streamChatResponse] Browser reports network offline');
          const error = new Error('Network offline - check your internet connection');
          error.name = 'NetworkError';
          error.recoverable = true;
          handleStreamingError(error);
          return;
        }
        
        // Connection state diagnotics
        const connectionState = eventSource ? eventSource.readyState : 'undefined';
        console.warn(`[streamChatResponse] Error event received, connection state: ${connectionState}`);
        
        // Handle different connection states
        if (connectionState === 0) {
          // Still connecting - likely a connection refused or timeout
          const error = new Error('Failed to connect to server - verify API endpoint availability');
          error.name = 'ConnectionError';
          error.readyState = 0;
          error.recoverable = true;
          handleStreamingError(error);
          return;
        }

        // Server responded with error data
        if (event.data && typeof event.data === 'string') {
          try {
            const errorData = JSON.parse(event.data);
            console.error('[streamChatResponse] SSE server error:', errorData);
            
            const errorMessage = errorData.error?.message || 
                               errorData.message || 
                               errorData.detail || 
                               'Server error';
                               
            const error = new Error(errorMessage);
            error.name = 'ServerError';
            error.data = errorData;
            error.recoverable = true;
            handleStreamingError(error);
          } catch (jsonError) {
            // Error data isn't valid JSON
            console.error('[streamChatResponse] Error parsing error message:', jsonError);
            console.warn('[streamChatResponse] Raw error data:', event.data);
            
            handleStreamingError(new Error(`Server sent invalid response: ${event.data.substring(0, 100)}`));
          }
        } else {
          // Generic connection error without data
          console.warn('[streamChatResponse] SSE connection error without data');
          
          let errorMessage = 'Connection error';
          let errorType = 'ConnectionError';
          let recoverable = true;
          
          if (event.target && event.target.readyState === 0) {
            errorMessage = 'Failed to connect to server - connection refused or timeout';
            errorType = 'ConnectionError';
          } else if (event.target && event.target.readyState === 2) {
            errorMessage = 'Connection closed unexpectedly';
            errorType = 'ConnectionError';
          }
          
          const error = new Error(errorMessage);
          error.name = errorType;
          error.readyState = event.target?.readyState;
          error.recoverable = recoverable;
          error.originalEvent = {
            type: event.type,
            timeStamp: event.timeStamp,
            readyState: event.target?.readyState
          };
          
          handleStreamingError(error);
        }
      } catch (e) {
        // Fallback for any error handler issues
        console.error('[streamChatResponse] Error in error handler:', e);
        handleStreamingError(new Error('Connection error - please try again'));
      }
    };
    
    eventSource.addEventListener('error', tempErrorHandler);
    
    eventSource.onerror = async (event) => {
      clearTimeout(connectionTimeout);
      console.error('[streamChatResponse] SSE transport error:', event);
      
      // Additional diagnostics
      console.warn(`[streamChatResponse] Connection state: ${eventSource.readyState}`);
      
      if (!connectionClosed) {
        connectionClosed = true;
        eventSource.close();
        
        if (!errorState) {
          errorState = true;
          
          // Try to render buffered content
          if (mainTextBuffer || thinkingTextBuffer) {
            forceRender();
          }
          
          // Create appropriate error message based on context
          let errorMessage = 'Connection failed - server may be unavailable';
          let errorType = 'ConnectionError';
          
          if (event.status) {
            errorMessage = `Connection failed with status: ${event.status}`;
            errorType = 'ServerError';
          } else if (!navigator.onLine) {
            errorMessage = 'Internet connection lost - please check your network';
            errorType = 'NetworkError';
          }
          
          // Create error with appropriate properties
          const error = new Error(errorMessage);
          error.name = errorType;
          error.readyState = event.target?.readyState;
          error.recoverable = true;
          
          // Pass through error handler
          await handleMessageError(error);
          
          // Offer recovery options
          if (navigator.onLine) {
            showNotification('Connection failed. Would you like to retry?', 'error', 0, [
              {
                text: 'Retry',
                action: () => attemptErrorRecovery(messageContent, error),
                primary: true
              }
            ]);
          } else {
            // Listen for online event to auto-recover
            window.addEventListener('online', () => {
              showNotification('Connection restored. Retrying...', 'info');
              attemptErrorRecovery(messageContent, error);
            }, { once: true });
          }
        }
      }
      
      // Ensure event listener is removed
      try {
        eventSource.removeEventListener('error', tempErrorHandler);
      } catch (e) {
        console.warn('[streamChatResponse] Error removing event listener:', e);
      }
    };
    
    eventSource.addEventListener('complete', (event) => {
      try {
        // Check if data exists before parsing
        if (event.data) {
          const completionData = JSON.parse(event.data);
          console.log('[streamChatResponse] Completion event received:', completionData);
          
          // Update token usage statistics
          if (completionData.usage) {
            updateTokenUsage(completionData.usage);
          }
        } else {
          console.log('[streamChatResponse] Completion event received without data');
        }
        
        // Ensure final content is rendered
        forceRender();
        
        // Close the connection
        eventSource.close();
      } catch (error) {
        console.error('[streamChatResponse] Error handling completion event:', error);
      } finally {
        // Cleanup
        cleanupStreaming();
      }
    });
    
    return true;
  } catch (error) {
    console.error('[streamChatResponse] Error setting up streaming:', error);
    
    // Add more specific error message for network related issues
    if (error.message && error.message.includes('Failed to fetch')) {
      error.message = 'Could not connect to API server - network error';
      error.recoverable = true;
    }
    
    await handleStreamingError(error);
    return false;
  }
}

/**
 * Process a streaming chunk of text with improved parsing and batching
 * Enhanced for reliable DeepSeek thinking block handling
 */
let chunkBuffer = '';

function processStreamingChunk(data) {
  // Ignore if not choice data
  if (!data.choices || data.choices.length === 0) return;
  
  // Process each choice (typically just one)
  data.choices.forEach(choice => {
    if (choice.delta && choice.delta.content) {
      const text = choice.delta.content;
      chunkBuffer += text;
      
      // Enhanced parsing of thinking blocks for DeepSeek-R1
      const processThinkingBlocks = () => {
        // Look for complete or partial thinking blocks
        const openTagIndex = chunkBuffer.indexOf('<think>');
        if (openTagIndex === -1) {
          // No thinking blocks, just process regular content
          if (!isThinking) {
            mainTextBuffer = processDeepSeekResponse(mainTextBuffer + chunkBuffer);
            chunkBuffer = '';
          }
          return;
        }
        
        // Handle start of thinking block
        if (openTagIndex >= 0) {
          // Process any content before thinking block
          if (openTagIndex > 0 && !isThinking) {
            const beforeThink = chunkBuffer.substring(0, openTagIndex);
            mainTextBuffer = processDeepSeekResponse(mainTextBuffer + beforeThink);
          }
          
          // Check for closing tag
          const closeTagIndex = chunkBuffer.indexOf('</think>', openTagIndex);
          
          if (closeTagIndex >= 0) {
            // Complete thinking block found
            isThinking = false;
            
            // Extract thinking content without the tags
            const thinkContent = chunkBuffer.substring(openTagIndex + 7, closeTagIndex);
            thinkingTextBuffer = thinkContent;
            
            // Ensure container exists and render thinking
            ensureThinkingContainer();
            
            // Process content after closing tag
            const afterThink = chunkBuffer.substring(closeTagIndex + 8);
            chunkBuffer = afterThink;
            
            // If there's content after the thinking block, process it recursively
            if (afterThink.length > 0) {
              processThinkingBlocks();
            }
          } else {
            // Partial thinking block - still collecting
            isThinking = true;
            thinkingTextBuffer = chunkBuffer.substring(openTagIndex + 7);
            chunkBuffer = '';
          }
        }
      };
      
      // Process any thinking blocks in the current buffer
      processThinkingBlocks();
    }
    
    // Check for completion
    if (choice.finish_reason) {
      console.log(`[processStreamingChunk] Finished: ${choice.finish_reason}`);
      // Process any remaining buffer
      if (chunkBuffer) {
        mainTextBuffer = processDeepSeekResponse(mainTextBuffer + chunkBuffer);
        chunkBuffer = '';
      }
      
      // Finalize any thinking blocks
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
  
  // Only render if we haven't rendered recently
  if (now - lastRenderTimestamp >= RENDER_INTERVAL_MS) {
    // Cancel any pending animation frame
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    
    // Render immediately
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
  // Cancel any pending animation frame
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  // Render immediately
  renderBufferedContent();
  lastRenderTimestamp = Date.now();
}

/**
 * Render buffered content to DOM with optimizations
 */
function renderBufferedContent() {
  try {
    // Only render if we have content
    if (mainTextBuffer) {
      // Create message container if needed
      ensureMessageContainer();
      
      // Efficiently update DOM - use insertAdjacentHTML for partial updates
      if (messageContainer) {
        // Use specialized function from chat.js
        if (window.renderAssistantMessage) {
          window.renderAssistantMessage(mainTextBuffer);
        } else {
          // Fallback with DeepSeek processing
          messageContainer.innerHTML = mainTextBuffer;
          messageContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
          
          // Initialize any DeepSeek thinking blocks
          deepSeekProcessor.initializeExistingBlocks();
        }
      }
    }
    
    // Render thinking content if present
    if (thinkingTextBuffer && thinkingContainer) {
      thinkingContainer.textContent = thinkingTextBuffer;
      thinkingContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  } catch (error) {
    console.error('[renderBufferedContent] Error rendering content:', error);
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
 * Create thinking container with improved UI and interaction
 */
function ensureThinkingContainer() {
  // First ensure we have a message container
  ensureMessageContainer();
  
  if (!thinkingContainer && messageContainer) {
    // Create thinking process container
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

    // Add click handler to toggle
    thinkingHeader.querySelector('.thinking-toggle').addEventListener('click', function() {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !expanded);
      const content = this.closest('.thinking-process').querySelector('.thinking-content');
      content.classList.toggle('hidden', expanded);
      this.querySelector('.toggle-icon').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    });

    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content bg-blue-50/50 dark:bg-blue-900/10 relative';

    // Create pre element for thinking text
    const thinkingPre = document.createElement('pre');
    thinkingPre.className = 'thinking-pre font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200 px-4 py-3 max-h-[300px] overflow-y-auto';
    thinkingContainer = thinkingPre;

    // Create gradient overlay for preview
    const gradientOverlay = document.createElement('div');
    gradientOverlay.className = 'absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-blue-50/90 dark:from-blue-900/30 to-transparent pointer-events-none';
    gradientOverlay.id = 'thinking-gradient';

    thinkingContent.appendChild(thinkingPre);
    thinkingContent.appendChild(gradientOverlay);
    thinkingProcess.appendChild(thinkingHeader);
    thinkingProcess.appendChild(thinkingContent);

    messageContainer.appendChild(thinkingProcess);
  }
  
  // Update thinking content if container exists
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
    
    // Get parent elements
    const toggleButton = thinkingContainer.closest('.thinking-process').querySelector('.thinking-toggle');
    const gradientOverlay = document.getElementById('thinking-gradient');
    
    // Remove gradient if content doesn't need scrolling
    if (thinkingContainer.scrollHeight <= thinkingContainer.clientHeight) {
      if (gradientOverlay) gradientOverlay.remove();
    }
    
    // Add collapse functionality (initially expanded)
    if (toggleButton) {
      toggleButton.addEventListener('click', function() {
        const expanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', !expanded);
        const content = this.closest('.thinking-process').querySelector('.thinking-content');
        content.classList.toggle('hidden', expanded);
        this.querySelector('.toggle-icon').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    }
    
    // Reset for potential additional thinking blocks
    thinkingContainer = null;
    thinkingTextBuffer = '';
  }
}

/**
 * Handle streaming error with improved recovery options
 */
async function handleStreamingError(error) {
  console.error('[handleStreamingError]', error);
  
  if (!errorState) {
    errorState = true;
    
    try {
      // Try to render any buffered content before showing error
      if (mainTextBuffer || thinkingTextBuffer) {
        forceRender();
      }
      
      // If we have some partial response already, add an error notice
      if (messageContainer && mainTextBuffer) {
        const errorNotice = document.createElement('div');
        errorNotice.className = 'py-2 px-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded mt-2';
        errorNotice.textContent = '⚠️ The response was interrupted. The content above may be incomplete.';
        messageContainer.appendChild(errorNotice);
      }
      
      // Remove typing indicator
      removeTypingIndicator();
      
      // Show error notification for user with more specific guidance
      const userFriendlyMessage = getUserFriendlyErrorMessage(error);
      
      // Use existing error handler from notificationManager
      await handleMessageError({
        ...error,
        message: userFriendlyMessage,
        recoveryOptions: getRecoveryOptionsForError(error)
      });
    } catch (e) {
      console.error('[handleStreamingError] Error handling stream error:', e);
    }
  }
}

/**
 * Get a user-friendly error message based on the error type
 * @param {Error} error - The error object
 * @returns {string} A user-friendly error message
 */
function getUserFriendlyErrorMessage(error) {
  // Handle network related errors
  if (error.name === 'NetworkError' || !navigator.onLine) {
    return 'Network connection lost. Please check your internet connection and try again.';
  }
  
  // Handle server errors with status codes
  if (error.message && error.message.includes('Connection closed (')) {
    const statusMatch = error.message.match(/\((\d+)\)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : null;
    
    if (status === 401 || 403) {
      return 'Authentication error. Please try signing in again.';
    } else if (status === 429) {
      return 'Rate limit exceeded. Please wait a moment before sending more messages.';
    } else if (status >= 500) {
      return 'Server error. The system may be experiencing issues. Please try again later.';
    }
  }
  
  // Handle timeouts
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 'Request timed out. Try reducing the complexity of your message or selecting a faster model.';
  }
  
  // Generic fallback
  return error.message || 'An unexpected error occurred. Please try again.';
}

/**
 * Get recovery options based on the type of error
 * @param {Error} error - The error object
 * @returns {Array} - List of recovery options
 */
function getRecoveryOptionsForError(error) {
  const options = [];
  
  // Network errors
  if (error.name === 'NetworkError' || !navigator.onLine) {
    options.push({
      label: 'Check Network',
      action: () => {
        // Open connection troubleshooting info
        window.open('https://support.microsoft.com/help/10741', '_blank');
      }
    });
  }
  
  // Timeout errors
  if (error.name === 'TimeoutError' || 
      (error.message && error.message.includes('timeout'))) {
    
    options.push({
      label: 'Try with simpler query',
      action: 'retry',
      primary: true
    });
    
    options.push({
      label: 'Switch to faster model',
      action: () => {
        // Show model selection
        const toggleButton = document.getElementById('sidebar-toggle');
        const modelsTab = document.getElementById('models-tab');
        
        if (toggleButton) toggleButton.click();
        if (modelsTab) setTimeout(() => modelsTab.click(), 300);
      }
    });
  }
  
  // Authentication errors
  if (error.message && error.message.match(/\(40[13]\)/)) {
    options.push({
      label: 'Sign in again',
      action: 'reload',
      primary: true
    });
  }
  
  // Rate limiting errors
  if (error.message && error.message.includes('429')) {
    options.push({
      label: 'Wait and retry',
      action: () => {
        setTimeout(() => {
          document.getElementById('send-button')?.click();
        }, 5000);
      },
      primary: true
    });
  }
  
  // Always add retry option if no other options
  if (options.length === 0) {
    options.push({
      label: 'Retry',
      action: 'retry',
      primary: true
    });
  }
  
  // Add option to continue without AI
  options.push({
    label: 'Dismiss',
    action: 'dismiss'
  });
  
  return options;
}

/**
 * Attempt to recover from streaming errors when possible
 * @param {string} messageContent - The original message to retry
 * @param {Error} error - The error that occurred
 * @return {Promise<boolean>} - Whether recovery was attempted
 */
async function attemptErrorRecovery(messageContent, error) {
  if (!navigator.onLine) {
    console.log('[attemptErrorRecovery] Browser offline, waiting for connectivity');
    
    // Show a persistent notification
    showNotification(
      'Waiting for internet connection to be restored...',
      'warning',
      0, // 0 duration = persistent until manually closed
      [{ text: 'Dismiss', action: 'dismiss' }]
    );
    
    // Add a one-time listener for when connectivity is restored
    return new Promise(resolve => {
      const reconnectHandler = async () => {
        window.removeEventListener('online', reconnectHandler);
        console.log('[attemptErrorRecovery] Browser back online, retrying request');
        
        // Wait a moment for connection to stabilize
        await new Promise(r => setTimeout(r, 1500));
        
        // Close the waiting notification
        hideAllNotifications();
        
        // Get fresh session ID
        const sessionId = getSessionId();
        if (!sessionId) {
          console.error('[attemptErrorRecovery] No session ID available');
          showNotification('Could not retrieve session ID', 'error');
          resolve(false);
          return;
        }
        
        // Show retrying notification
        showNotification('Connection restored. Retrying...', 'info', 3000);
        
        // Try again with current settings
        const modelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
        const developerConfig = document.getElementById('developer-config')?.value || '';
        const reasoningEffort = getReasoningEffortSetting();
        
        try {
          const success = await streamChatResponse(
            messageContent,
            sessionId,
            modelName,
            developerConfig,
            reasoningEffort
          );
          
          if (success) {
            showNotification('Connection restored successfully', 'success', 3000);
          }
          
          resolve(success);
        } catch (retryError) {
          console.error('[attemptErrorRecovery] Recovery attempt failed:', retryError);
          showNotification('Recovery attempt failed - please try again', 'error');
          resolve(false);
        }
      };
      
      window.addEventListener('online', reconnectHandler, { once: true });
    });
  }
  
  // Check if error is likely temporary and worth retrying
  if (error.recoverable || 
      error.name === 'ConnectionError' || 
      error.name === 'NetworkError' ||
      error.name === 'TimeoutError' ||
      (error.message && (
        error.message.includes('Failed to fetch') ||
        error.message.includes('Network error') ||
        error.message.includes('timeout') ||
        error.message.includes('failed to connect')
      ))) {
    
    console.log('[attemptErrorRecovery] Attempting to retry recoverable error');
    
    // Show retry notification
    showNotification('Retrying connection...', 'info', 3000);
    
    // Wait a moment before retrying
    await new Promise(r => setTimeout(r, 2000));
    
    // Get fresh session ID
    const sessionId = getSessionId();
    if (!sessionId) {
      console.error('[attemptErrorRecovery] No session ID available');
      showNotification('Could not retrieve session ID', 'error');
      return false;
    }
    
    // Try again with current settings
    const modelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
    const developerConfig = document.getElementById('developer-config')?.value || '';
    const reasoningEffort = getReasoningEffortSetting();
    
    try {
      const success = await streamChatResponse(
        messageContent,
        sessionId,
        modelName,
        developerConfig,
        reasoningEffort
      );
      
      if (success) {
        showNotification('Connection restored successfully', 'success', 3000);
      }
      
      return success;
    } catch (retryError) {
      console.error('[attemptErrorRecovery] Recovery attempt failed:', retryError);
      
      // Show more specific error message based on the retry error
      let errorMessage = 'Recovery attempt failed';
      
      if (!navigator.onLine) {
        errorMessage = 'Network connection lost during retry';
      } else if (retryError.message?.includes('timeout')) {
        errorMessage = 'Server timeout during retry - try again later';
      } else if (retryError.message?.includes('rate limit')) {
        errorMessage = 'Rate limit exceeded - please wait a moment before trying again';
      }
      
      showNotification(errorMessage, 'error');
      return false;
    }
  }
  
  // Non-recoverable error
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
  
  // Cancel any pending animation frame
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  // Remove typing indicator
  removeTypingIndicator();
  
  // Store the final answer in conversation
  if (mainTextBuffer && messageContainer) {
    try {
      // Signal completion
      const sessionId = getSessionId();
      
      // Store in backend (reusing the API from chat.js)
      if (sessionId) {
        fetch(`/api/chat/conversations/store?session_id=${sessionId}&role=assistant&content=${encodeURIComponent(mainTextBuffer)}`)
          .catch(err => console.warn('Failed to store message in backend:', err));
      }
    } catch (e) {
      console.warn('Failed to store streamed message:', e);
    }
  }
}

/**
 * Helper function to get the current reasoning effort setting
 * @returns {string} - 'low', 'medium', or 'high'
 */
function getReasoningEffortSetting() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) {
    const value = parseInt(slider.value);
    switch (value) {
      case 1: return 'low';
      case 3: return 'high'; 
      case 2:
      default: return 'medium';
    }
  }
  return 'medium'; // Default value
}

/**
 * Helper function to hide all notifications
 */
function hideAllNotifications() {
  const notificationContainer = document.getElementById('notification-container');
  if (notificationContainer) {
    notificationContainer.innerHTML = '';
  }
}
