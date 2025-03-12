/***************************************************
 * displayManager.js
 * 
 * Remediated module with no duplicate blocks,
 * no hidden/invalid characters, and minimal
 * placeholder/stub functions for undefined references.
 ***************************************************/

import { renderMarkdown, sanitizeHTML, highlightCode } from './markdownParser.js';
import { showNotification, showConfirmDialog } from './notificationManager.js';
import { debounce, eventBus } from '../utils/helpers.js';
import { deepSeekProcessor } from './deepseekProcessor.js';
import { getSessionId } from '../session.js';

/** 
 *  ======= Stub functions to prevent reference errors =======
 *  Adjust or remove these if you have real implementations 
 */
function initMobileUI() {
  // Handle mobile UI layout or interactions
}
function applyFontSize(fontSize) {
  // Implementation for adjusting font size in the app
}
function updateConversationTitle(title) {
  // Implementation for updating the conversation title in the UI
  // e.g., document.getElementById('conversation-title').textContent = title;
}
function showWelcomeMessageIfNeeded() {
  // Implementation for showing a welcome message if new or returning user
}
function storeChatMessage(role, content) {
  // Implementation for persisting the message in local storage or DB
  // e.g., localStorage.setItem('lastMessage', JSON.stringify({role, content}));
}
function pruneOldMessages() {
  // Implementation that removes oldest messages above a threshold
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  limitChatHistory(chatHistory, messageRenderLimit);
}
/** End of stub functions */

let messageRenderLimit = 60;
let isLoadingPrevious = false;
let hasMoreMessages = true;
let messageCache = new Map();
let messageObserver;
let currentView = 'chat';

export function initDisplayManager() {
  setupIntersectionObserver();
  updateLoadMoreButton();
  setupEventListeners();

  // Handle mobile layout if on a narrow screen
  if (window.matchMedia('(max-width: 768px)').matches) {
    initMobileUI();
  }

  // Listen for config updates to apply new font sizes
  eventBus.subscribe('configUpdated', ({ updates }) => {
    if (updates.appSettings?.fontSize) {
      applyFontSize(updates.appSettings.fontSize);
    }
  });

  // Show a welcome or info message if it’s a fresh session
  showWelcomeMessageIfNeeded();
}

function setupEventListeners() {
  console.log('Setting up displayManager event listeners');

  // Token usage toggle
  const tokenUsageToggle = document.getElementById('token-usage-toggle');
  const tokenDetails = document.getElementById('token-details');
  const tokenChevron = document.getElementById('token-chevron');
  if (tokenUsageToggle && tokenDetails && tokenChevron) {
    console.log('Adding event listener to token usage toggle');
    tokenUsageToggle.addEventListener('click', () => {
      console.log('Token usage toggle clicked');
      tokenDetails.classList.toggle('hidden');
      tokenChevron.classList.toggle('rotate-180');
      localStorage.setItem('tokenDetailsVisible', !tokenDetails.classList.contains('hidden'));
    });

    // Restore toggle state from localStorage
    const tokenDetailsVisible = localStorage.getItem('tokenDetailsVisible') === 'true';
    if (tokenDetailsVisible) {
      tokenDetails.classList.remove('hidden');
      tokenChevron.classList.add('rotate-180');
    }
  }

  // Font size controls
  const fontSizeUpBtn = document.getElementById('font-size-up');
  const fontSizeDownBtn = document.getElementById('font-size-down');
  const fontSizeResetBtn = document.getElementById('font-size-reset');
  if (fontSizeUpBtn) {
    fontSizeUpBtn.addEventListener('click', () => adjustFontSize(1));
  }
  if (fontSizeDownBtn) {
    fontSizeDownBtn.addEventListener('click', () => adjustFontSize(-1));
  }
  if (fontSizeResetBtn) {
    // Double-click to reset font size
    fontSizeResetBtn.addEventListener('dblclick', () => adjustFontSize(0));
  }

  // Global click handler (e.g., copy-code button, file links)
  document.addEventListener('click', handleGlobalClick);
}

/**
 * Adjust the global or user-defined font size setting 
 * @param {number} step If 0, reset; if positive, increase; if negative, decrease
 */
function adjustFontSize(step) {
  // Implementation detail depends on your app's logic
  // E.g., store or apply new font size in CSS variables
  console.log(`Adjusting font size by: ${step}`);
}

function handleGlobalClick(e) {
  // Handle code copy button
  if (e.target.classList.contains('copy-code-button') || e.target.closest('.copy-code-button')) {
    const button = e.target.closest('.copy-code-button');
    const codeBlock = button?.nextElementSibling?.querySelector('code');
    if (codeBlock) {
      const code = codeBlock.textContent;
      navigator.clipboard.writeText(code)
        .then(() => {
          const originalText = button.textContent;
          button.textContent = 'Copied!';
          setTimeout(() => (button.textContent = originalText), 2000);
        })
        .catch(() => showNotification('Failed to copy to clipboard', 'error'));
    }
  }

  // Handle file ref link
  if (e.target.classList.contains('file-ref-link') || e.target.closest('.file-ref-link')) {
    const link = e.target.closest('.file-ref-link');
    if (!link) return;
    e.preventDefault();
    openFileInSidebar(link.getAttribute('data-file-name'));
  }
}

function openFileInSidebar(filename) {
  // If sidebar is collapsed, toggle it
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar?.classList.contains('translate-x-full')) sidebarToggle.click();
  }
  // Switch to files tab
  const filesTab = document.getElementById('files-tab');
  if (filesTab) filesTab.click();

  // Highlight the file in the list
  setTimeout(() => {
    const filesList = document.querySelectorAll('[aria-label^="File:"]');
    for (const f of filesList) {
      if (f.innerText.includes(filename)) {
        f.scrollIntoView({ behavior: 'smooth', block: 'center' });
        f.classList.add('bg-blue-100', 'dark:bg-blue-900/30');
        setTimeout(() => f.classList.remove('bg-blue-100', 'dark:bg-blue-900/30'), 1500);
        break;
      }
    }
  }, 500);
}

function setupIntersectionObserver() {
  if (messageObserver || !('IntersectionObserver' in window)) return;
  messageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const msg = entry.target;
        if (msg.classList.contains('assistant-message')) {
          // Highlight code blocks in the assistant's message
          highlightCode(msg);
          // Lazy-load images
          msg.querySelectorAll('img[data-src]').forEach(img => {
            if (img.dataset.src) {
              img.src = img.dataset.src;
              delete img.dataset.src;
            }
          });
        }
        messageObserver.unobserve(msg);
      }
    });
  }, { rootMargin: '100px 0px', threshold: 0.1 });
}

export async function loadConversationFromDb() {
  let maybeSession = getSessionId();
  const conversationId = maybeSession instanceof Promise ? await maybeSession : maybeSession;
  if (!conversationId) {
    console.error("No conversation ID available");
    return;
  }

  try {
    // Updated endpoint path to match new structure
    const res = await fetch(`/api/chat/conversations/${conversationId}/messages?offset=0&limit=100`);
    if (!res.ok) {
      if (res.status === 404) {
        // The conversation no longer exists, so create a new one
        console.warn('Conversation not found, creating a new conversation...');
        sessionStorage.removeItem('sessionId');
        const cm = await import('./conversationManager.js');
        await cm.createAndSetupNewConversation();
      } else {
        console.error('Failed to fetch conversation from DB:', res.statusText);
        showNotification('Failed to load conversation from DB', 'error');
      }
      return;
    }

    // Debugging
    console.log('API response status:', res.status);
    const responseText = await res.text();
    console.log('Raw API response:', responseText);

    // Parse the JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (jsonError) {
      console.error('Failed to parse JSON response:', jsonError);
      showNotification('Invalid response format from server', 'error');
      return;
    }

    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;

    // Preserve any existing system messages + conversation controls
    const systemMessages = chatHistory.querySelectorAll('.system-message');
    const conversationControls = chatHistory.querySelector('.conversation-controls');
    chatHistory.innerHTML = '';
    systemMessages.forEach(el => chatHistory.appendChild(el));
    if (conversationControls) {
      chatHistory.appendChild(conversationControls);
    }

    // Sort messages by timestamp, then append in chronological order
    if (data.messages && Array.isArray(data.messages)) {
      data.messages.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeA - timeB; // Ascending order (oldest first)
      });

      for (const m of data.messages) {
        const messageElement = m.role === 'user'
          ? createUserMessageElement(m.content)
          : createAssistantMessageElement(m.content);
        chatHistory.appendChild(messageElement);
      }
    } else {
      console.warn('No messages found in the response', data);
    }

    // If there's a title, update page title or conversation header
    if (data.title) {
      updateConversationTitle(data.title);
    }

    // Auto-scroll to bottom after loading conversation
    setTimeout(() => {
      chatHistory.scrollTo({
        top: chatHistory.scrollHeight,
        behavior: 'auto'
      });
    }, 100);
  } catch (e) {
    console.error('Error loading conversation from DB:', e);
    showNotification('Failed to load conversation from DB', 'error');
  }
}

export async function loadOlderMessages() {
  if (isLoadingPrevious || !hasMoreMessages) return;

  const sessionIdMaybe = getSessionId();
  const conversationId = sessionIdMaybe instanceof Promise ? await sessionIdMaybe : sessionIdMaybe;
  if (!conversationId) return;

  try {
    isLoadingPrevious = true;
    const loadBtn = document.getElementById('load-older-btn');
    if (loadBtn) {
      loadBtn.classList.add('loading');
      loadBtn.setAttribute('disabled', 'true');
    }

    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) {
      throw new Error('Chat history container not found');
    }

    // Remember current scroll position and height
    const scrollPositionBefore = chatHistory.scrollTop;
    const scrollHeightBefore = chatHistory.scrollHeight;

    // Get currently rendered messages count (excluding system messages)
    const rendered = chatHistory.querySelectorAll('.message:not(.system-message)').length;
    const fetchLimit = 50; // Load 50 older messages
    const api = `/api/chat/conversations/${conversationId}/messages?offset=${rendered}&limit=${fetchLimit}`;

    const res = await fetch(api);
    if (!res.ok) {
      throw new Error(`Failed to fetch older messages: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data || !data.messages || !data.messages.length) {
      hasMoreMessages = false;
      updateLoadMoreButton(0);
      return;
    }

    // Create a document fragment to batch DOM operations
    const fragment = document.createDocumentFragment();

    // Sort messages by timestamp
    data.messages.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB; // Ascending order (oldest first)
    });

    for (const m of data.messages) {
      const messageElement = m.role === 'user'
        ? createUserMessageElement(m.content)
        : createAssistantMessageElement(m.content);
      fragment.appendChild(messageElement);
    }

    // Insert older messages at top
    if (chatHistory.firstChild) {
      chatHistory.insertBefore(fragment, chatHistory.firstChild);
    } else {
      chatHistory.appendChild(fragment);
    }

    // Update hasMoreMessages based on number of messages received
    hasMoreMessages = data.has_more || data.messages.length >= fetchLimit;
    updateLoadMoreButton(
      data.total_count ? data.total_count - rendered - data.messages.length : 0
    );

    // Setup observers for lazy-loaded content
    chatHistory.querySelectorAll('.message:not(.observed)').forEach(el => {
      if (messageObserver && el.classList.contains('assistant-message')) {
        el.classList.add('observed');
        messageObserver.observe(el);
      }
    });

    // Adjust scroll position to maintain view
    requestAnimationFrame(() => {
      const heightDiff = chatHistory.scrollHeight - scrollHeightBefore;
      chatHistory.scrollTop = scrollPositionBefore + heightDiff;
    });
  } catch (error) {
    console.error('Error loading older messages:', error);
    showNotification('Failed to load older messages', 'error');
  } finally {
    isLoadingPrevious = false;
    const loadBtn = document.getElementById('load-older-btn');
    if (loadBtn) {
      loadBtn.classList.remove('loading');
      loadBtn.removeAttribute('disabled');
    }
  }
}

async function saveConversation() {
  const sessionIdMaybe = getSessionId();
  const sessionId = sessionIdMaybe instanceof Promise ? await sessionIdMaybe : sessionIdMaybe;
  if (!sessionId) {
    showNotification('No valid session found', 'error');
    return;
  }

  try {
    // Fetch all conversation messages from DB
    const api = `/api/chat/conversations/history`;
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        offset: 0,
        limit: 9999
      })
    });
    if (!res.ok) {
      console.error('Failed to fetch conversation for saving:', res.statusText);
      showNotification('Failed to fetch conversation for saving', 'error');
      return;
    }
    const data = await res.json();
    if (!data || !data.messages) {
      showNotification('No conversation to save', 'error');
      return;
    }

    // Also notify server of the chosen title so it appears in dropdown
    const chatTitle = 'Conversation ' + new Date().toLocaleString();
    try {
      await fetch('/api/chat/conversations/set_title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: data.session_id, title: chatTitle })
      });
    } catch (error) {
      console.warn('Failed to set conversation title on server:', error);
    }

    // Prepare JSON data
    const exportData = {
      session_id: data.session_id,
      messages: data.messages,
      title: chatTitle,
      timestamp: new Date().toISOString()
    };
    const jsonString = JSON.stringify(exportData, null, 2);

    // Create downloadable blob
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${sessionId}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showNotification('Conversation downloaded successfully', 'success');
  } catch (error) {
    console.error('Error saving conversation:', error);
    showNotification('Failed to save conversation', 'error');
  }
}
export { saveConversation };

/**
 * Updates the visibility or text of the "Load Older Messages" button.
 * 
 * @param {number} [unloadedCount]
 */
function updateLoadMoreButton(unloadedCount) {
  const loadBtn = document.getElementById('load-older-btn');
  if (!loadBtn) return;

  loadBtn.classList.toggle('hidden', !hasMoreMessages);

  if (hasMoreMessages) {
    const sessionId = getSessionId();
    if (sessionId) {
      try {
        // If unloadedCount wasn't passed, attempt to compute from local storage
        if (unloadedCount === undefined) {
          const storageKey = `conversation_${sessionId}`;
          const storedConversation = localStorage.getItem(storageKey);
          if (storedConversation) {
            const allMessages = JSON.parse(storedConversation);
            unloadedCount = Math.max(0, allMessages.length - messageRenderLimit);
          } else {
            unloadedCount = 0;
          }
        }

        // Update button text
        if (unloadedCount > 0) {
          loadBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
            Load Older Messages (${unloadedCount})
          `;
        } else {
          loadBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
            Load Older Messages
          `;
        }
      } catch (e) {
        console.error('Error updating load more button:', e);
      }
    }
  }
}

/**
 * Renders a user message into the DOM
 */
export function renderUserMessage(content, skipScroll = false, skipStore = false) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return null;

  const message = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    content,
    role: 'user',
    timestamp: Date.now()
  };

  const element = document.createElement('div');
  element.dataset.id = message.id;
  element.className = 'message user-message';
  element.innerHTML = sanitizeHTML(content).replace(/\n/g, '<br>');

  chatHistory.appendChild(element);

  if (!skipScroll) {
    requestAnimationFrame(() => {
      chatHistory.scrollTo({
        top: chatHistory.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  pruneOldMessages();
  if (!skipStore) storeChatMessage('user', content);
  return element;
}

function createUserMessageElement(content) {
  const cacheKey = `user-${content}`;
  if (messageCache.has(cacheKey)) {
    return messageCache.get(cacheKey).cloneNode(true);
  }

  const el = document.createElement('div');
  el.className = 'message user-message';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = sanitizeHTML(content).replace(/\n/g, '<br>');
  messageCache.set(cacheKey, el.cloneNode(true));
  return el;
}

/**
 * Renders an assistant message into the DOM
 */
export function renderAssistantMessage(content, skipScroll = false, skipStore = false) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return null;

  const messageElement = createAssistantMessageElement(content);
  chatHistory.appendChild(messageElement);

  if (messageObserver) {
    messageElement.classList.add('observed');
    messageObserver.observe(messageElement);
  }

  if (!skipScroll) {
    requestAnimationFrame(() => {
      chatHistory.scrollTo({
        top: chatHistory.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  pruneOldMessages();
  if (!skipStore) storeChatMessage('assistant', content);
  return messageElement;
}

function createAssistantMessageElement(response) {
  let content = '';
  if (typeof response === 'object' && response !== null && response.content) {
    content = String(response.content);
  } else {
    content = String(response);
  }

  // Create a unique ID
  const messageId = `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const el = document.createElement('div');
  el.className = 'message assistant-message';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('data-id', messageId);

  // Extract thinking content from <think> tags
  let mainContent = content || '';
  let thinkingContent = '';

  if (content && content.includes('<think>')) {
    const thinkMatches = content.match(/<think>([\s\S]*?)<\/think>/g);
    if (thinkMatches) {
      thinkingContent = thinkMatches
        .map(m => m.replace(/<\/?think>/g, ''))
        .join('\n\n');
      mainContent = content.replace(/<think>[\s\S]*?<\/think>/g, '');
      // Clean up trailing JSON-like objects if present
      mainContent = mainContent.replace(/\s*\{"type"\s*:\s*"done".*?\}\s*$/g, '');
    }
  }

  // Create the same structure as streaming.js produces
  const messageContentContainer = document.createElement('div');
  messageContentContainer.className = 'message-content';
  el.appendChild(messageContentContainer);

  // Add thinking container (even if empty, for consistent structure)
  const thinkingContainer = document.createElement('div');
  thinkingContainer.className = 'thinking-container';
  messageContentContainer.appendChild(thinkingContainer);

  // Add response content container
  const responseContentDiv = document.createElement('div');
  responseContentDiv.className = 'response-content';
  messageContentContainer.appendChild(responseContentDiv);

  // If there's thinking content, render it using the same deepSeekProcessor
  if (thinkingContent && thinkingContent.trim()) {
    // Use the same processor as streaming.js for consistency
    deepSeekProcessor.renderThinkingContainer(
      thinkingContainer,
      thinkingContent,
      { createNew: true, isComplete: true }
    );
    thinkingContainer.style.display = 'block';
  } else {
    thinkingContainer.style.display = 'none';
  }

  // Render the main content
  responseContentDiv.innerHTML = renderMarkdown(mainContent.trim());

  return el;
}

// Example transformations of code blocks
function processCodeBlocks(htmlString) {
  // If you want to insert copy buttons or transform code blocks, do it here
  // Otherwise just return the same HTML
  return htmlString;
}

// Example lazy loading transform for images
function processImagesForLazyLoading(htmlString) {
  // Replace <img src="..." /> with <img data-src="..." />
  // Then load them when in viewport
  return htmlString.replace(
    /<img\s+src="([^"]+)"([^>]*)>/gi,
    (match, p1, p2) => `<img data-src="${p1}" ${p2}>`
  );
}

/**
 * Fixed deleteConversation function that properly creates a new session
 * after deleting the current one
 */
export async function deleteConversation() {
  showConfirmDialog(
    'Delete Conversation',
    'Are you sure you want to delete the current conversation? This action cannot be undone.',
    async () => {
      try {
        // 1. Get current session ID
        const sessionId = await getSessionId();
        if (!sessionId) {
          console.warn('No session ID to delete, creating new conversation');
          await createAndSetupNewConversation();
          return;
        }

        // 2. Delete on the server
        const deleteResponse = await fetch(`${window.location.origin}/api/chat/conversations/${sessionId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });
        if (!deleteResponse.ok) {
          console.error(`Failed to delete conversation: ${deleteResponse.status}`);
          // Continue anyway so UI can reset
        }

        // 3. Create a new conversation and ensure sessionStorage updates
        await createAndSetupNewConversation();
        showNotification('Conversation deleted', 'success');
      } catch (error) {
        console.error('Failed to delete conversation:', error);
        showNotification('Failed to delete conversation', 'error');

        // 4. Even on error, try to create a new conversation as fallback
        try {
          await createAndSetupNewConversation();
        } catch (err) {
          console.error('Failed to create new conversation after error:', err);
        }
      }
    }
  );
}

/**
 * Helper function to create and set up a new conversation
 */
async function createAndSetupNewConversation() {
  // Remove the old session ID to prevent reuse
  sessionStorage.removeItem('sessionId');

  // Create the conversation on the server
  const newSessionId = await createNewConversation();
  if (!newSessionId) {
    throw new Error('Failed to create new conversation');
  }

  // Ensure session storage was updated
  if (sessionStorage.getItem('sessionId') !== newSessionId) {
    console.warn('Session ID not properly updated, fixing it now');
    sessionStorage.setItem('sessionId', newSessionId);
  }

  // Clear the UI
  const chatHistory = document.getElementById('chat-history');
  if (chatHistory) {
    const systemMessages = [];
    chatHistory.querySelectorAll('.system-message').forEach(el => {
      systemMessages.push(el.cloneNode(true));
    });
    chatHistory.innerHTML = '';
    systemMessages.forEach(el => chatHistory.appendChild(el));

    // Restore conversation controls if present
    const controls = document.querySelector('.conversation-controls');
    if (controls) chatHistory.appendChild(controls);
  }

  // Reset other display states
  messageCache.clear();
  hasMoreMessages = false;
  updateLoadMoreButton(0);

  // Show welcome if needed
  showWelcomeMessageIfNeeded();

  console.log('New conversation created with ID:', newSessionId);
  return newSessionId;
}

/**
 * Creates a new conversation session
 */
export async function createNewConversation(
  pinned = false,
  archived = false,
  title = 'New Conversation'
) {
  try {
    const response = await fetch(`${window.location.origin}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        pinned,
        archived
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Failed to create conversation: ${response.status} - ${responseText}`);
    }

    const data = await response.json();
    const newConversationId = data.conversation_id;
    sessionStorage.setItem('sessionId', newConversationId);
    console.log(`New conversation created: ${title} (ID: ${newConversationId})`);
    return newConversationId;
  } catch (err) {
    console.error('Error creating new conversation:', err);
    showNotification('Failed to create new conversation', 'error');
    return null;
  }
}

export function handleConversationError(error, userMessage, callback, context) {
  console.error('Display Manager Error:', error);

  const errorDisplay = document.getElementById('error-display');
  if (errorDisplay) {
    errorDisplay.textContent = userMessage || 'An error occurred';
    errorDisplay.classList.remove('hidden');
  }

  if (callback) {
    callback();
  }
}

/**
 * Ensures total message count doesn't exceed `maxCount`.
 * Removes oldest messages if we exceed the limit.
 */
function limitChatHistory(chatHistory, maxCount) {
  const msgs = chatHistory.querySelectorAll('.message:not(.system-message)');
  if (msgs.length <= maxCount) return;

  const removeCount = msgs.length - maxCount;
  for (let i = 0; i < removeCount; i++) {
    msgs[i].remove();
  }
  hasMoreMessages = true;
}

