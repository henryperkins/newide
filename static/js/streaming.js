// Enhanced streaming.js with improved performance and error handling

import { getSessionId } from './session.js';
import { updateTokenUsage } from './utils/helpers.js';
import { showNotification, handleMessageError, removeTypingIndicator } from './ui/notificationManager.js';

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
    const apiUrl = `/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
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
      console.log('[streamChatResponse] SSE connection opened');
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
    
    eventSource.onerror = async (event) => {
      console.error('[streamChatResponse] SSE error:', event);
      eventSource.close();
      
      if (!errorState) {
        errorState = true;
        
        // Try to render any buffered content before reporting the error
        if (mainTextBuffer || thinkingTextBuffer) {
          forceRender();
        }
        
        // Check if this was an intentional abort
        if (signal && signal.aborted) {
          console.log('[streamChatResponse] Request was aborted intentionally');
          // Don't show error notification for intentional abort
          return;
        }
        
        // Extract error details from the event
        const error = new Error('Streaming connection error');
        
        // Use specialized message error handler
        await handleMessageError(error);
      }
    };
    
    eventSource.addEventListener('complete', (event) => {
      try {
        const completionData = JSON.parse(event.data);
        console.log('[streamChatResponse] Completion event received:', completionData);
        
        // Update token usage statistics
        if (completionData.usage) {
          updateTokenUsage(completionData.usage);
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
    await handleStreamingError(error);
    return false;
  }
}

/**
 * Process a streaming chunk of text with improved parsing and batching
 */
function processStreamingChunk(data) {
  // Ignore if not choice data
  if (!data.choices || data.choices.length === 0) return;
  
  // Process each choice (typically just one)
  data.choices.forEach(choice => {
    if (choice.delta && choice.delta.content) {
      const text = choice.delta.content;
      
      // Handle thinking mode toggle for DeepSeek-R1 chain-of-thought
      parseChunkForReasoning(text);
    }
    
    // Check for completion
    if (choice.finish_reason) {
      console.log(`[processStreamingChunk] Finished: ${choice.finish_reason}`);
    }
  });
}

/**
 * Parse chunk text for reasoning blocks (<think> tags)
 */
function parseChunkForReasoning(text) {
  if (!isThinking) {
    // Check if this chunk contains a thinking start tag
    const thinkStart = text.indexOf('<think>');
    
    if (thinkStart === -1) {
      // Normal text, add to main buffer
      mainTextBuffer += text;
    } else {
      // Found thinking start tag
      // Add text before the tag to main buffer
      mainTextBuffer += text.slice(0, thinkStart);
      
      // Switch to thinking mode and process remaining text
      isThinking = true;
      const remainingText = text.slice(thinkStart + '<think>'.length);
      thinkingTextBuffer += remainingText;
      
      // Ensure we have the thinking container ready
      ensureThinkingContainer();
    }
  } else {
    // Already in thinking mode, check for end tag
    const thinkEnd = text.indexOf('</think>');
    
    if (thinkEnd === -1) {
      // Still in thinking block
      thinkingTextBuffer += text;
    } else {
      // Found end of thinking
      // Add text up to the end tag to thinking buffer
      thinkingTextBuffer += text.slice(0, thinkEnd);
      
      // Switch back to normal mode
      isThinking = false;
      
      // Process any text after the end tag
      const remainingText = text.slice(thinkEnd + '</think>'.length);
      if (remainingText) {
        mainTextBuffer += remainingText;
      }
      
      // Finalize thinking container
      finalizeThinkingContainer();
    }
  }
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
          // Fallback
          messageContainer.innerHTML = mainTextBuffer;
          messageContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
 * Create thinking container if it doesn't exist
 */
function ensureThinkingContainer() {
  // First ensure we have a message container
  ensureMessageContainer();
  
  if (!thinkingContainer && messageContainer) {
    // Create thinking process container
    const thinkingProcess = document.createElement('div');
    thinkingProcess.className = 'thinking-process';
    
    // Create header
    const thinkingHeader = document.createElement('div');
    thinkingHeader.className = 'thinking-header';
    thinkingHeader.innerHTML = `
      <button class="thinking-toggle" aria-expanded="true">
        <span class="toggle-icon">▼</span> Thinking Process
      </button>
    `;
    
    // Create content container
    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content';
    
    // Create pre element for thinking text
    const thinkingPre = document.createElement('pre');
    thinkingPre.className = 'thinking-pre';
    thinkingContainer = thinkingPre;
    
    // Assemble structure
    thinkingContent.appendChild(thinkingPre);
    thinkingProcess.appendChild(thinkingHeader);
    thinkingProcess.appendChild(thinkingContent);
    
    // Add to message container
    messageContainer.appendChild(thinkingProcess);
  }
}

/**
 * Finalize thinking container once thinking is complete
 */
function finalizeThinkingContainer() {
  if (thinkingContainer) {
    // Set final content
    thinkingContainer.textContent = thinkingTextBuffer;
    
    // Add highlighting and styling
    const toggleButton = thinkingContainer.closest('.thinking-process').querySelector('.thinking-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', () => {
        const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
        toggleButton.setAttribute('aria-expanded', !isExpanded);
        
        // Update icon
        const icon = toggleButton.querySelector('.toggle-icon');
        if (icon) {
          icon.textContent = isExpanded ? '▶' : '▼';
        }
      });
    }
    
    // Reset for potential additional thinking blocks
    thinkingContainer = null;
    thinkingTextBuffer = '';
  }
}

/**
 * Handle streaming error with improved recovery
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
      
      // Show error notification for user
      await handleMessageError(error);
    } catch (e) {
      console.error('[handleStreamingError] Error handling stream error:', e);
    }
  }
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