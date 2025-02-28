// Enhanced chat.js with improved error handling and performance

import { showNotification, handleMessageError, showTypingIndicator, removeTypingIndicator, showConfirmDialog } from './ui/notificationManager.js';
import { getSessionId, initializeSession, setLastUserMessage } from './session.js'; 
import { formatFileSize, copyToClipboard, updateTokenUsage, debounce } from './utils/helpers.js';
import { renderMarkdown, sanitizeHTML, highlightCode } from './ui/markdownParser.js';

// Configuration defaults
let streamingEnabled = false;
let developerConfig = 'You are a helpful AI assistant.';
let reasoningEffort = 'medium';
let isProcessing = false;
let currentController = null;
let messageQueue = [];
let isStreamingSupported = true;

// Initialize event listeners when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  initChatInterface();
  
  // Create a global event for message sending
  window.sendMessage = sendMessage;
  
  // Expose the renderMessage function globally for streaming.js
  window.renderAssistantMessage = renderAssistantMessage;
});

/**
 * Initialize the chat interface components and listeners
 */
function initChatInterface() {
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const streamingToggle = document.getElementById('enable-streaming');
  const developerConfigInput = document.getElementById('developer-config');
  const reasoningSlider = document.getElementById('reasoning-effort-slider');
  const charCount = document.getElementById('char-count');
  
  // Initialize character count
  if (userInput && charCount) {
    // Update character count as user types with debounce
    userInput.addEventListener('input', debounce((e) => {
      const count = e.target.value.length;
      charCount.textContent = count;
      
      // Adjust input height based on content
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
      
      // Visual indicator for long messages
      if (count > 4000) {
        charCount.classList.add('text-warning-500');
      } else {
        charCount.classList.remove('text-warning-500');
      }
    }, 100));
  }
  
  // Initialize send button
  if (sendButton) {
    sendButton.addEventListener('click', sendMessage);
  }
  
  // Initialize streaming toggle
  if (streamingToggle) {
    streamingToggle.addEventListener('change', (e) => {
      streamingEnabled = e.target.checked;
      localStorage.setItem('streamingEnabled', streamingEnabled);
    });
    
    // Set initial state from localStorage
    const storedStreamingState = localStorage.getItem('streamingEnabled');
    if (storedStreamingState !== null) {
      streamingEnabled = storedStreamingState === 'true';
      streamingToggle.checked = streamingEnabled;
    }
  }
  
  // Initialize developer config
  if (developerConfigInput) {
    developerConfigInput.addEventListener('change', (e) => {
      developerConfig = e.target.value;
      localStorage.setItem('developerConfig', developerConfig);
    });
    
    // Set initial state from localStorage
    const storedConfig = localStorage.getItem('developerConfig');
    if (storedConfig) {
      developerConfig = storedConfig;
      developerConfigInput.value = developerConfig;
    }
  }
  
  // Initialize reasoning effort slider
  if (reasoningSlider) {
    const effortDisplay = document.getElementById('reasoning-effort-display');
    const effortDescription = document.getElementById('effort-description-text');
    
    // Only add event listener if both display elements exist
    if (effortDisplay && effortDescription) {
      reasoningSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10);
        let effortLevel = 'medium';
        let description = '';
        
        switch (value) {
          case 1:
            effortLevel = 'low';
            description = 'Low: Faster responses (30s-1min) with basic reasoning';
            break;
          case 2:
            effortLevel = 'medium';
            description = 'Medium: Balanced processing time (1-3min) and quality';
            break;
          case 3:
            effortLevel = 'high';
            description = 'High: Deeper reasoning (3-5min) for complex questions';
            break;
        }
        
        reasoningEffort = effortLevel;
        localStorage.setItem('reasoningEffort', effortLevel);
        
        effortDisplay.textContent = effortLevel.charAt(0).toUpperCase() + effortLevel.slice(1);
        effortDescription.textContent = description;
      });
    } else {
      console.warn('Reasoning effort display elements not found in DOM');
    }
    
    // Set initial state from localStorage
    const storedEffort = localStorage.getItem('reasoningEffort');
    if (storedEffort) {
      reasoningEffort = storedEffort;
      
      // Set slider position based on effort level
      switch (storedEffort) {
        case 'low':
          reasoningSlider.value = 1;
          break;
        case 'medium':
          reasoningSlider.value = 2;
          break;
        case 'high':
          reasoningSlider.value = 3;
          break;
      }
      
      // Trigger input event to update display
      reasoningSlider.dispatchEvent(new Event('input'));
    }
  }
  
  // Add keyboard shortcut support
  userInput?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Initialize token usage panel toggle
  const tokenUsageToggle = document.getElementById('token-usage-toggle');
  const tokenDetails = document.getElementById('token-details');
  const tokenChevron = document.getElementById('token-chevron');
  
  if (tokenUsageToggle && tokenDetails && tokenChevron) {
    tokenUsageToggle.addEventListener('click', () => {
      tokenDetails.classList.toggle('hidden');
      tokenChevron.classList.toggle('rotate-180');
      
      // Store preference
      localStorage.setItem('tokenDetailsVisible', !tokenDetails.classList.contains('hidden'));
    });
    
    // Set initial state from localStorage
    const tokenDetailsVisible = localStorage.getItem('tokenDetailsVisible') === 'true';
    if (tokenDetailsVisible) {
      tokenDetails.classList.remove('hidden');
      tokenChevron.classList.add('rotate-180');
    }
  }
  
  // Set up event delegation for copy buttons and code highlights
  document.addEventListener('click', (e) => {
    // Copy code block
    if (e.target.classList.contains('copy-code-button') || e.target.closest('.copy-code-button')) {
      const button = e.target.classList.contains('copy-code-button') ? 
                    e.target : e.target.closest('.copy-code-button');
      const codeBlock = button.nextElementSibling;
      
      if (codeBlock) {
        const code = codeBlock.textContent;
        copyToClipboard(code)
          .then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            
            setTimeout(() => {
              button.textContent = originalText;
            }, 2000);
          })
          .catch(err => {
            console.error('Copy failed:', err);
            showNotification('Failed to copy to clipboard', 'error');
          });
      }
    }
    
    // Handle thinking process toggle
    if (e.target.classList.contains('thinking-toggle') || e.target.closest('.thinking-toggle')) {
      const toggle = e.target.classList.contains('thinking-toggle') ? 
                    e.target : e.target.closest('.thinking-toggle');
      const content = toggle.parentElement.nextElementSibling;
      const icon = toggle.querySelector('.toggle-icon');
      
      if (content && icon) {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', !isExpanded);
        
        // Update icon
        icon.textContent = isExpanded ? '▶' : '▼';
      }
    }
  });
}

/**
 * Send a message from the user to the AI
 */
export async function sendMessage() {
  const userInput = document.getElementById('user-input');
  if (!userInput) return;
  
  const messageContent = userInput.value.trim();
  if (!messageContent || isProcessing) return;
  
  try {
    // Abort any ongoing requests
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
    
    isProcessing = true;
    
    // Store message for retry scenarios
    setLastUserMessage(messageContent);
    
    // Update UI
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span>';
    }
    
    // Clear input field and reset height
    userInput.value = '';
    userInput.style.height = 'auto';
    
    // Get current session ID from multiple sources
    let currentSessionId = getSessionId() || localStorage.getItem('current_session_id');
    if (!currentSessionId) {
      try {
        console.warn('Session ID not found, attempting to recover...');
        // Show notification to user
        showNotification('Session expired. Attempting to reconnect...', 'warning');
        
        // Try to initialize a new session
        const sessionInitialized = await initializeSession();
        if (sessionInitialized) {
          const newSessionId = getSessionId();
          if (newSessionId) {
            showNotification('Session restored successfully', 'success');
            currentSessionId = newSessionId;
          } else {
            throw new Error('Failed to get new session ID');
          }
        } else {
          throw new Error('Failed to initialize new session');
        }
      } catch (error) {
        // Show dialog with refresh option
        await showConfirmDialog('Session expired', 'Your session has expired. Would you like to refresh the page?', () => {
          window.location.reload();
        });
        throw new Error('Invalid session. Please refresh the page.');
      }
    }
    
    // Render user message
    renderUserMessage(messageContent);
    
    // Get model settings
    const modelSelect = document.getElementById('model-select');
    let modelName = 'DeepSeek-R1'; // Default model
    
    if (modelSelect) {
      modelName = modelSelect.value;
    }
    
    // Check if streaming is supported for this model
    const modelConfig = await getModelConfig(modelName);
    isStreamingSupported = modelConfig?.supports_streaming || false;
    
    // Use streaming only if both enabled and supported
    const useStreaming = streamingEnabled && isStreamingSupported;
    
    // Show typing indicator
    showTypingIndicator();
    
    // Set up abort controller for timeout
    const controller = new AbortController();
    currentController = controller;
    
    // Compute timeout based on message length
    const timeoutMs = calculateTimeout(messageContent, modelName, reasoningEffort);
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(`Request timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    
    try {
      if (useStreaming) {
        // Use streaming implementation
        await import('./streaming.js').then(module => {
          return module.streamChatResponse(
            messageContent, 
            currentSessionId,
            modelName,
            developerConfig,
            reasoningEffort,
            controller.signal
          );
        });
      } else {
        // Use standard implementation
        const response = await fetchChatResponse(
          messageContent,
          currentSessionId,
          modelName,
          developerConfig,
          reasoningEffort,
          controller.signal
        );
        
        // Render response
        const assistantMessage = response.choices[0].message.content;
        renderAssistantMessage(assistantMessage);
        
        // Update token usage
        if (response.usage) {
          updateTokenUsage(response.usage);
        }
      }
    } catch (error) {
      // Only handle errors not related to user-initiated aborts
      if (error.name !== 'AbortError' || !controller.signal.aborted) {
        await handleMessageError(error);
      }
    } finally {
      // Clear timeout
      clearTimeout(timeoutId);
      
      // Remove typing indicator
      removeTypingIndicator();
      
      // Reset controller
      currentController = null;
    }
  } catch (error) {
    console.error('Error in sendMessage:', error);
    showNotification('Failed to send message', 'error');
  } finally {
    // Reset UI
    isProcessing = false;
    
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
        </svg>
      `;
    }
    
    // Restore focus to input field
    userInput.focus();
  }
}

/**
 * Calculate an appropriate timeout based on message length and model
 * 
 * @param {string} message - The message content
 * @param {string} model - The model name
 * @param {string} reasoningEffort - Reasoning effort level (low, medium, high)
 * @returns {number} Timeout in milliseconds
 */
function calculateTimeout(message, model, reasoningEffort) {
  const baseTimeout = 60000; // 60 seconds base
  const perCharTimeout = 10; // 10ms per character
  const messageLength = message.length;
  
  // Determine if this is an o-series model (which takes longer)
  const isOSeries = model.toLowerCase().startsWith('o1') || model.toLowerCase().startsWith('o3');
  
  // Apply model-specific multiplier
  const modelMultiplier = isOSeries ? 3 : 1;
  
  // Apply reasoning effort multiplier
  let effortMultiplier = 1;
  switch (reasoningEffort) {
    case 'low':
      effortMultiplier = 0.7;
      break;
    case 'medium':
      effortMultiplier = 1;
      break;
    case 'high':
      effortMultiplier = 1.5;
      break;
  }
  
  // Calculate timeout
  const timeout = baseTimeout + (messageLength * perCharTimeout * modelMultiplier * effortMultiplier);
  
  // Cap at a reasonable maximum
  return Math.min(timeout, 300000); // Maximum 5 minutes
}

/**
 * Fetch chat completion from the API with improved error handling
 */
async function fetchChatResponse(
  messageContent, 
  sessionId,
  modelName = 'DeepSeek-R1',
  developerConfig = '',
  reasoningEffort = 'medium',
  signal
) {
  const maxRetries = 2;
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount <= maxRetries) {
    try {
      const apiUrl = '/api/chat';
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
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          model: modelName,
          messages: messages,
          reasoning_effort: reasoningEffort,
          temperature: 0.7,
          max_completion_tokens: 5000
        }),
        signal
      });
      
      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
          
          if (retryCount < maxRetries) {
            console.warn(`Rate limited (429). Retrying in ${retrySeconds}s... (${retryCount + 1}/${maxRetries})`);
            
            showNotification(
              `Rate limited. Retrying in ${retrySeconds}s... (${retryCount + 1}/${maxRetries})`, 
              'warning', 
              retrySeconds * 1000
            );
            
            await new Promise(resolve => setTimeout(resolve, retrySeconds * 1000));
            retryCount++;
            continue;
          }
        }
        
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      lastError = error;
      
      // Only retry network errors, not user aborts or validation errors
      if (error.name === 'TypeError' && error.message.includes('network') && retryCount < maxRetries) {
        console.warn(`Network error. Retrying (${retryCount + 1}/${maxRetries})...`);
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // Increasing delay
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Render user message in the chat
 */
function renderUserMessage(content) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  
  const messageElement = document.createElement('div');
  messageElement.className = 'message user-message';
  
  // Set ARIA role for screen readers
  messageElement.setAttribute('role', 'log');
  messageElement.setAttribute('aria-live', 'polite');
  
  // Sanitize and render
  const sanitizedContent = sanitizeHTML(content);
  messageElement.innerHTML = sanitizedContent.replace(/\n/g, '<br>');
  
  // Append to chat
  chatHistory.appendChild(messageElement);
  
  // Scroll into view with smooth animation
  setTimeout(() => {
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, 100);
  
  // Store message in chat history
  storeChatMessage('user', content);
}

/**
 * Render assistant message in the chat
 */
export function renderAssistantMessage(content, isThinking = false) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  
  const messageElement = document.createElement('div');
  messageElement.className = `message assistant-message ${isThinking ? 'thinking-message' : ''}`;
  
  // Set ARIA role for screen readers
  messageElement.setAttribute('role', 'log');
  messageElement.setAttribute('aria-live', 'polite');
  
  // Process DeepSeek-R1 thinking blocks through centralized processor
  if (content.includes('<think>')) {
    content = processDeepSeekResponse(content, true);
  }
  
  // Render markdown content
  const markdownContent = renderMarkdown(content);
  
  // Process code blocks to add copy buttons
  const processedContent = processCodeBlocks(markdownContent);
  
  // Set content
  messageElement.innerHTML = processedContent;
  
  // Append to chat
  chatHistory.appendChild(messageElement);
  
  // Highlight code blocks
  highlightCode(messageElement);
  
  // Scroll into view with smooth animation
  setTimeout(() => {
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, 100);
  
  // Store message in chat history (only if not thinking content)
  if (!isThinking) {
    storeChatMessage('assistant', content);
  }
}

/**
 * Store messages in history and local storage
 */
function storeChatMessage(role, content) {
  const currentSessionId = getSessionId();
  if (!currentSessionId) return;

  // Store in backend with retry logic
  fetchWithRetry(
    `/api/chat/conversations/store`,
    { 
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: currentSessionId,
        role: role,
        content: content
      })
    },
    3  // Max retries
  ).catch(err => console.warn('Failed to store message in backend after retries:', err));
  
  // Store in local storage (limited to recent messages)
  try {
    const storageKey = `conversation_${currentSessionId}`;
    let conversation = JSON.parse(localStorage.getItem(storageKey) || '[]');
    
    // Add message
    conversation.push({ role, content, timestamp: new Date().toISOString() });
    
    // Limit to last 50 messages to avoid localStorage limits
    if (conversation.length > 50) {
      conversation = conversation.slice(-50);
    }
    
    localStorage.setItem(storageKey, JSON.stringify(conversation));
  } catch (e) {
    console.warn('Failed to store message in localStorage:', e);
  }
}

/**
 * Fetch with exponential backoff retry logic
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<Response>} - The fetch response
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      const response = await fetch(url, options);
      
      // If the request was successful or it's a client error (4xx), don't retry
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      
      // Only retry on server errors (5xx)
      if (response.status >= 500) {
        console.warn(`Server error (${response.status}), retrying... (${retries + 1}/${maxRetries})`);
      } else {
        return response; // Don't retry on other status codes
      }
    } catch (error) {
      // Network errors will be caught here
      console.warn(`Network error, retrying... (${retries + 1}/${maxRetries})`, error);
    }
    
    // Exponential backoff with jitter
    const delay = Math.min(1000 * Math.pow(2, retries) * (0.9 + Math.random() * 0.2), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));
    retries++;
  }
  
  // If we've exhausted retries, make one final attempt and return whatever we get
  return fetch(url, options);
}

/**
 * Process code blocks to add copy buttons
 */
function processCodeBlocks(html) {
  // Add copy buttons to code blocks
  return html.replace(
    /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
    (match, language, code) => {
      return `
        <div class="relative group">
          <button class="copy-code-button absolute top-2 right-2 p-1 rounded text-xs bg-dark-700/50 text-white opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 touch-action-manipulation" aria-label="Copy code">
            Copy
          </button>
          <pre><code class="language-${language}">${code}</code></pre>
        </div>
      `;
    }
  );
}

/**
 * Process DeepSeek-R1 thinking content
 */
function processThinkingContent(content) {
  // Replace <think>...</think> with collapsible blocks
  return content.replace(
    /<think>([\s\S]*?)<\/think>/g,
    (match, thinking) => {
      // Add collapsible thinking content
      return `
        <div class="thinking-process">
          <div class="thinking-header">
            <button class="thinking-toggle" aria-expanded="true">
              <span class="toggle-icon">▼</span> Thinking Process
            </button>
          </div>
          <div class="thinking-content">
            <pre class="thinking-pre">${thinking}</pre>
          </div>
        </div>
      `;
    }
  );
}

/**
 * Get model configuration for a specific model
 */
async function getModelConfig(modelName) {
  try {
    // Properly encode the model name in the URL
    const encodedModelName = encodeURIComponent(modelName);
    
    // Try to fetch from API
    const response = await fetch(`/api/config/models/${encodedModelName}`);
    
    if (response.ok) {
      return await response.json();
    } else {
      console.warn(`Could not fetch model config for ${modelName}, status: ${response.status}`);
      
      // Enhanced error logging
      if (response.status === 400) {
        console.error(`Bad request for model ${modelName}. Check model name format and API compatibility.`);
      } else if (response.status === 404) {
        console.error(`Model ${modelName} not found. It may need to be configured.`);
      }
      
      // Fallback defaults
      if (modelName.toLowerCase() === 'deepseek-r1') {
        console.info('Using fallback configuration for DeepSeek-R1');
        return {
          name: 'DeepSeek-R1',
          supports_streaming: true,
          supports_temperature: true,
          api_version: '2024-05-01-preview'
        };
      } else if (modelName.toLowerCase().startsWith('o1')) {
        console.info(`Using fallback configuration for ${modelName}`);
        return {
          name: modelName,
          supports_streaming: false, 
          supports_temperature: false,
          api_version: '2025-01-01-preview'
        };
      }
    }
  } catch (error) {
    console.error('Error fetching model config:', error);
  }
  
  // Default fallback
  console.info('Using generic fallback model configuration');
  return {
    supports_streaming: false,
    supports_temperature: true
  };
}
