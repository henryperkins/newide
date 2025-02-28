// Enhanced displayManager.js with improved rendering performance and accessibility

import { getSessionId } from '../session.js';
import { renderMarkdown, sanitizeHTML, highlightCode } from './markdownParser.js';
import { showNotification, showConfirmDialog } from './notificationManager.js';
import { debounce } from '../utils/helpers.js';
import { processDeepSeekResponse } from './deepseekProcessor.js';

// Configuration
let messageRenderLimit = 30; // Maximum messages to keep in DOM
let isLoadingPrevious = false;
let hasMoreMessages = true;
let messageCache = new Map(); // Cache messages to avoid re-rendering
let messageObserver; // Intersection observer for images and code

/**
 * Initialize the display manager
 * - Sets up lazy loading via IntersectionObserver
 */
export function initDisplayManager() {
  // Set up intersection observer for lazy content enhancement
  setupIntersectionObserver();
  
  // Initialize visibility of older messages button
  updateLoadMoreButton();
}

/**
 * Setup intersection observer for lazy content enhancement
 * - Code syntax highlighting 
 * - Lazy loading images
 * - Animation on visibility
 */
function setupIntersectionObserver() {
  // Only create if needed and supported
  if (messageObserver || !('IntersectionObserver' in window)) return;
  
  messageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const message = entry.target;
        
        // Handle lazy content enhancement based on message type
        if (message.classList.contains('assistant-message')) {
          // Apply syntax highlighting to code blocks
          highlightCode(message);
          
          // Load any lazy images
          message.querySelectorAll('img[data-src]').forEach(img => {
            if (img.dataset.src) {
              img.src = img.dataset.src;
              delete img.dataset.src;
            }
          });
        }
        
        // Unobserve after enhancing
        messageObserver.unobserve(message);
      }
    });
  }, {
    rootMargin: '100px 0px',
    threshold: 0.1
  });
}

/**
 * Load conversation from localStorage with paging
 */
export function loadConversationFromLocalStorage() {
  const sessionId = getSessionId();
  if (!sessionId) return;
  
  const storageKey = `conversation_${sessionId}`;
  const storedConversation = localStorage.getItem(storageKey);
  
  if (!storedConversation) {
    // No stored conversation
    updateLoadMoreButton();
    return;
  }
  
  try {
    let messages = JSON.parse(storedConversation);
    
    // Keep track if there are more messages
    hasMoreMessages = messages.length > messageRenderLimit;
    
    // Render the most recent messages (limit the number for performance)
    const recentMessages = messages.slice(-messageRenderLimit);
    
    // Clear the history (but keep system messages)
    const chatHistory = document.getElementById('chat-history');
    const systemMessages = [];
    
    if (chatHistory) {
      // Collect system messages to preserve
      chatHistory.querySelectorAll('.system-message').forEach(el => {
        systemMessages.push(el.cloneNode(true));
      });
      
      // Clear chat history
      chatHistory.innerHTML = '';
      
      // Re-add system messages
      systemMessages.forEach(el => {
        chatHistory.appendChild(el);
      });
      
      // Add the conversation messages in correct order
      recentMessages.forEach(message => {
        if (message.role === 'user') {
          renderUserMessage(message.content);
        } else if (message.role === 'assistant') {
          renderAssistantMessage(message.content);
        }
      });
    }
    
    // Update load more button visibility
    updateLoadMoreButton();
  } catch (error) {
    console.error('Error loading conversation:', error);
    showNotification('Failed to load previous conversation', 'error');
  }
}

/**
 * Load older messages from localStorage
 * - Adds pagination support
 * - Preserves scroll position
 */
export async function loadOlderMessages() {
  if (isLoadingPrevious || !hasMoreMessages) return;
  
  const sessionId = getSessionId();
  if (!sessionId) return;
  
  const storageKey = `conversation_${sessionId}`;
  const storedConversation = localStorage.getItem(storageKey);
  
  if (!storedConversation) return;
  
  try {
    isLoadingPrevious = true;
    
    // Update button to show loading state
    const loadBtn = document.getElementById('load-older-btn');
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Loading...';
    }
    
    // Get currently visible messages
    const currentMessages = document.querySelectorAll('.message:not(.system-message)');
    const currentCount = currentMessages.length;
    
    // Reference first visible message for scroll restoration
    const firstMessage = currentMessages[0];
    
    // Calculate position for measuring scroll offset
    const scrollTopBefore = firstMessage ? firstMessage.offsetTop : 0;
    
    // Get all stored messages
    const allMessages = JSON.parse(storedConversation);
    
    // Calculate how many more to load
    const totalStored = allMessages.length;
    const alreadyLoaded = currentCount;
    const startIndex = Math.max(0, totalStored - alreadyLoaded - messageRenderLimit);
    const messagesToLoad = allMessages.slice(startIndex, totalStored - alreadyLoaded);
    
    // Check if there would be more messages after this load
    hasMoreMessages = startIndex > 0;
    
    // Prepare for rendering
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    
    // Create a document fragment to batch DOM operations
    const fragment = document.createDocumentFragment();
    
    // Add each message to the fragment
    messagesToLoad.forEach(message => {
      let messageElement;
      
      if (message.role === 'user') {
        messageElement = createUserMessageElement(message.content);
      } else if (message.role === 'assistant') {
        messageElement = createAssistantMessageElement(message.content);
      }
      
      if (messageElement) {
        fragment.appendChild(messageElement);
      }
    });
    
    // Add the new messages before existing ones
    if (currentMessages[0]) {
      chatHistory.insertBefore(fragment, currentMessages[0]);
    } else {
      chatHistory.appendChild(fragment);
    }
    
    // Observe new messages for lazy loading
    if (messageObserver) {
      chatHistory.querySelectorAll('.message:not(.observed)').forEach(message => {
        message.classList.add('observed');
        messageObserver.observe(message);
      });
    }

    // Process any DeepSeek thinking blocks in final content
    mainTextBuffer = processDeepSeekResponse(mainTextBuffer, true);
    
    // After rendering, calculate new position of reference element
    const scrollTopAfter = firstMessage ? firstMessage.offsetTop : 0;
    
    // Adjust scroll position to maintain relative position
    const chatContainer = document.getElementById('chat-history');
    if (chatContainer && firstMessage) {
      chatContainer.scrollTop += (scrollTopAfter - scrollTopBefore);
    }
    
    // Update load more button visibility
    updateLoadMoreButton();
  } catch (error) {
    console.error('Error loading older messages:', error);
    showNotification('Failed to load older messages', 'error');
  } finally {
    // Reset loading state
    isLoadingPrevious = false;
    
    // Reset button state
    const loadBtn = document.getElementById('load-older-btn');
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
        </svg>
        Load Older Messages
      `;
    }
  }
}

/**
 * Update visibility of load more button based on available messages
 */
function updateLoadMoreButton() {
  const loadBtn = document.getElementById('load-older-btn');
  if (loadBtn) {
    loadBtn.classList.toggle('hidden', !hasMoreMessages);
  }
}

/**
 * Render user message in the chat
 * - Improves performance with DOM fragment
 * - Adds accessibility attributes
 * 
 * @param {string} content - The message content to render
 * @param {boolean} skipScroll - Whether to skip auto-scrolling (default: false)
 */
export function renderUserMessage(content, skipScroll = false) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return null;
  
  // Create message element
  const messageElement = createUserMessageElement(content);
  
  // Add to DOM
  chatHistory.appendChild(messageElement);
  
  // Scroll into view with smooth animation
  if (!skipScroll) {
    requestAnimationFrame(() => {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }
  
  // Prune old messages to maintain performance
  pruneOldMessages();
  
  return messageElement;
}

/**
 * Create a user message DOM element
 * 
 * @param {string} content - The message content
 * @returns {HTMLElement} - The message DOM element
 */
function createUserMessageElement(content) {
  // Check message cache first
  const cacheKey = `user-${content}`;
  if (messageCache.has(cacheKey)) {
    // Clone from cache to avoid reference issues
    return messageCache.get(cacheKey).cloneNode(true);
  }
  
  // Create new element
  const messageElement = document.createElement('div');
  messageElement.className = 'message user-message';
  
  // Set ARIA attributes
  messageElement.setAttribute('role', 'log');
  messageElement.setAttribute('aria-live', 'polite');
  
  // Process content
  const sanitizedContent = sanitizeHTML(content);
  messageElement.innerHTML = sanitizedContent.replace(/\n/g, '<br>');
  
  // Cache the element for reuse
  messageCache.set(cacheKey, messageElement.cloneNode(true));
  
  return messageElement;
}

/**
 * Render assistant message in the chat
 * - Improves performance with DOM fragment and delayed rendering
 * - Adds accessibility attributes
 * 
 * @param {string} content - The message content to render
 * @param {boolean} skipScroll - Whether to skip auto-scrolling (default: false)
 */
export function renderAssistantMessage(content, skipScroll = false) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return null;
  
  // Create message element
  const messageElement = createAssistantMessageElement(content);
  
  // Add to DOM
  chatHistory.appendChild(messageElement);
  
  // Observe for lazy content enhancement
  if (messageObserver) {
    messageElement.classList.add('observed');
    messageObserver.observe(messageElement);
  }
  
  // Scroll into view
  if (!skipScroll) {
    requestAnimationFrame(() => {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }
  
  // Prune old messages to maintain performance
  pruneOldMessages();
  
  return messageElement;
}

/**
 * Create an assistant message DOM element
 * 
 * @param {string} content - The message content
 * @returns {HTMLElement} - The message DOM element
 */
function createAssistantMessageElement(content) {
  // Check message cache first
  const cacheKey = `assistant-${content}`;
  if (messageCache.has(cacheKey)) {
    // Clone from cache to avoid reference issues
    return messageCache.get(cacheKey).cloneNode(true);
  }
  
  // Create new element
  const messageElement = document.createElement('div');
  messageElement.className = 'message assistant-message';
  
  // Set ARIA attributes
  messageElement.setAttribute('role', 'log');
  messageElement.setAttribute('aria-live', 'polite');
  
  // Process DeepSeek-R1 thinking blocks
  let processedContent = content;
  if (content.includes('<think>')) {
    processedContent = processThinkingContent(content);
  }
  
  // Render content with markdown
  const markdownContent = renderMarkdown(processedContent);
  
  // Process code blocks to add copy buttons
  const enhancedContent = processCodeBlocks(markdownContent);
  
  // Apply modifications for lazy loading images
  const lazyContent = processImagesForLazyLoading(enhancedContent);
  
  // Set content
  messageElement.innerHTML = lazyContent;
  
  // Cache the element for reuse
  messageCache.set(cacheKey, messageElement.cloneNode(true));
  
  return messageElement;
}

/**
 * Process code blocks to add copy buttons
 * 
 * @param {string} html - HTML content with code blocks
 * @returns {string} - Enhanced HTML with copy buttons
 */
function processCodeBlocks(html) {
  // Match pre/code blocks and add copy buttons
  return html.replace(
    /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
    (match, language, code) => {
      return `
        <div class="relative group">
          <button class="copy-code-button absolute top-2 right-2 p-1 rounded text-xs bg-dark-700/50 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity touch-action-manipulation" aria-label="Copy code">
            Copy
          </button>
          <pre><code class="language-${language}">${code}</code></pre>
        </div>
      `;
    }
  );
}

/**
 * Process images for lazy loading
 * 
 * @param {string} html - HTML content with image tags
 * @returns {string} - HTML with lazy loading attributes
 */
function processImagesForLazyLoading(html) {
  // Replace src with data-src for lazy loading
  return html.replace(
    /<img\s+src="([^"]+)"/g,
    (match, src) => {
      return `<img data-src="${src}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" loading="lazy"`;
    }
  );
}

/**
 * Process thinking content for DeepSeek-R1
 */
function processThinkingContent(content) {
  return processDeepSeekResponse(content);
}

/**
 * Prune old messages to maintain performance
 * Uses a debounced approach to avoid excessive DOM operations
 */
const pruneOldMessages = debounce(() => {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  
  const messages = chatHistory.querySelectorAll('.message:not(.system-message)');
  
  // If we have more than the limit, remove oldest ones
  if (messages.length > messageRenderLimit) {
    // How many to remove
    const removeCount = messages.length - messageRenderLimit;
    
    // Keep track of scrollHeight to prevent scroll jumps
    const scrollHeightBefore = chatHistory.scrollHeight;
    const scrollPositionBefore = chatHistory.scrollTop;
    
    // Remove oldest messages
    for (let i = 0; i < removeCount; i++) {
      chatHistory.removeChild(messages[i]);
    }
    
    // Update load more button
    hasMoreMessages = true;
    updateLoadMoreButton();
    
    // Adjust scroll to maintain visual position
    requestAnimationFrame(() => {
      const scrollHeightAfter = chatHistory.scrollHeight;
      const heightDiff = scrollHeightBefore - scrollHeightAfter;
      chatHistory.scrollTop = Math.max(0, scrollPositionBefore - heightDiff);
    });
  }
}, 500);

/**
 * Clear conversation after confirmation
 */
export function clearConversation() {
  showConfirmDialog(
    'Clear Conversation',
    'Are you sure you want to clear the current conversation? This action cannot be undone.',
    () => {
      // Clear local storage
      const sessionId = getSessionId();
      if (sessionId) {
        localStorage.removeItem(`conversation_${sessionId}`);
      }
      
      // Clear the chat history, keeping only system messages
      const chatHistory = document.getElementById('chat-history');
      if (chatHistory) {
        const systemMessages = [];
        
        // Collect system messages to preserve
        chatHistory.querySelectorAll('.system-message').forEach(el => {
          systemMessages.push(el.cloneNode(true));
        });
        
        // Clear chat history
        chatHistory.innerHTML = '';
        
        // Re-add system messages
        systemMessages.forEach(el => {
          chatHistory.appendChild(el);
        });
      }
      
      // Clear message cache
      messageCache.clear();
      
      // Reset load more button state
      hasMoreMessages = false;
      updateLoadMoreButton();
      
      // Show notification
      showNotification('Conversation cleared', 'success');
    }
  );
}

/**
 * Save current conversation with name input
 */
export function saveConversation() {
  const sessionId = getSessionId();
  if (!sessionId) {
    showNotification('No active conversation to save', 'error');
    return;
  }
  
  const storageKey = `conversation_${sessionId}`;
  const storedConversation = localStorage.getItem(storageKey);
  
  if (!storedConversation || JSON.parse(storedConversation).length === 0) {
    showNotification('No messages to save in this conversation', 'warning');
    return;
  }
  
  // Show dialog to get conversation name
  const modalContainer = document.getElementById('modal-container');
  const modalContent = document.getElementById('modal-content');
  
  if (modalContainer && modalContent) {
    modalContent.innerHTML = `
      <div class="p-6">
        <h3 class="text-lg font-semibold text-dark-900 dark:text-dark-100 mb-2">Save Conversation</h3>
        <p class="text-dark-700 dark:text-dark-300 mb-4">Enter a name for this conversation</p>
        
        <input type="text" id="conversation-name" class="form-input w-full" 
               placeholder="My conversation" value="Conversation ${new Date().toLocaleDateString()}">
        
        <div class="flex justify-end space-x-3 mt-6">
          <button id="cancel-save-btn" class="btn btn-secondary">Cancel</button>
          <button id="confirm-save-btn" class="btn btn-primary">Save</button>
        </div>
      </div>
    `;
    
    // Show the modal
    modalContainer.classList.remove('hidden');
    
    // Focus the input
    setTimeout(() => {
      const nameInput = document.getElementById('conversation-name');
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
      }
    }, 100);
    
    // Handle actions
    const cancelBtn = document.getElementById('cancel-save-btn');
    const confirmBtn = document.getElementById('confirm-save-btn');
    const nameInput = document.getElementById('conversation-name');
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        modalContainer.classList.add('hidden');
      });
    }
    
    if (confirmBtn && nameInput) {
      // Enable enter key to submit
      nameInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
          confirmBtn.click();
        }
      });
      
      confirmBtn.addEventListener('click', () => {
        const name = nameInput.value.trim() || `Conversation ${new Date().toLocaleString()}`;
        const savedKey = `saved_conversation_${Date.now()}`;
        
        try {
          // Save the conversation with metadata
          const conversationData = {
            name: name,
            timestamp: new Date().toISOString(),
            messages: JSON.parse(storedConversation)
          };
          
          localStorage.setItem(savedKey, JSON.stringify(conversationData));
          showNotification(`Conversation saved as "${name}"`, 'success');
        } catch (error) {
          console.error('Error saving conversation:', error);
          showNotification('Failed to save conversation', 'error');
        }
        
        // Close modal
        modalContainer.classList.add('hidden');
      });
    }
  }
}

// Initialize the display manager on page load
document.addEventListener('DOMContentLoaded', initDisplayManager);
