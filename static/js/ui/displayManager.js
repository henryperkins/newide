// Updated displayManager.js with escaped apostrophes in template strings and corrected any hidden or invalid characters.
// Attempting to ensure it parses properly under a TS/JSX environment if needed.

import { renderMarkdown, sanitizeHTML, highlightCode } from './markdownParser.js';
import { showNotification, showConfirmDialog } from './notificationManager.js';
import { debounce, eventBus } from '../utils/helpers.js';
import { deepSeekProcessor } from './deepseekProcessor.js';
import { getSessionId } from '../session.js';

let messageRenderLimit = 60;
let isLoadingPrevious = false;
let hasMoreMessages = true;
let messageCache = new Map();
let messageObserver;
let currentView = 'chat';

function initDisplayManager() {
  setupIntersectionObserver();
  updateLoadMoreButton();
  setupEventListeners();
  if (window.matchMedia('(max-width: 768px)').matches) initMobileUI();
  eventBus.subscribe('configUpdated', ({ updates }) => {
    if (updates.appSettings?.fontSize) applyFontSize(updates.appSettings.fontSize);
  });
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
  if (fontSizeUpBtn) fontSizeUpBtn.addEventListener('click', () => adjustFontSize(1));
  if (fontSizeDownBtn) fontSizeDownBtn.addEventListener('click', () => adjustFontSize(-1));
  if (fontSizeResetBtn) fontSizeResetBtn.addEventListener('dblclick', () => adjustFontSize(0));

  // Global click handler for code copy buttons and file links
  document.addEventListener('click', handleGlobalClick);
}

function handleGlobalClick(e) {
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
  // Toggling removed (chain-of-thought remains always visible)
  if (e.target.classList.contains('file-ref-link') || e.target.closest('.file-ref-link')) {
    const link = e.target.closest('.file-ref-link');
    if (!link) return;
    e.preventDefault();
    openFileInSidebar(link.getAttribute('data-file-name'));
  }
}

function setupIntersectionObserver() {
  if (messageObserver || !('IntersectionObserver' in window)) return;
  messageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const msg = entry.target;
        if (msg.classList.contains('assistant-message')) {
          highlightCode(msg);
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
    // Try to get the response text first for debugging
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
    // Updated endpoint path
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
    updateLoadMoreButton(data.total_count ? data.total_count - rendered - data.messages.length : 0);

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

function updateLoadMoreButton(unloadedCount) {
  const loadBtn = document.getElementById('load-older-btn');
  if (!loadBtn) return;

  loadBtn.classList.toggle('hidden', !hasMoreMessages);

  if (hasMoreMessages) {
    const sessionId = getSessionId();
    if (sessionId) {
      try {
        // If unloadedCount wasn't passed as a parameter, calculate it
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

        // Update button text to show number of unloaded messages
        if (unloadedCount > 0) {
          loadBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
            Load Older Messages (${unloadedCount})
          `;
        } else {
          loadBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
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

  // Use consistent scrolling behavior by scrolling the chat history container
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
  if (messageCache.has(cacheKey)) return messageCache.get(cacheKey).cloneNode(true);

  const el = document.createElement('div');
  el.className = 'message user-message';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = sanitizeHTML(content).replace(/\n/g, '<br>');
  messageCache.set(cacheKey, el.cloneNode(true));
  return el;
}

export function renderAssistantMessage(content, skipScroll = false, skipStore = false) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return null;
  const messageElement = createAssistantMessageElement(content);
  chatHistory.appendChild(messageElement);
  if (messageObserver) {
    messageElement.classList.add('observed');
    messageObserver.observe(messageElement);
  }

  // Use consistent scrolling behavior by scrolling the chat history container
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

  // Log the content for debugging
  console.log("Processing assistant message:", {
    contentLength: content?.length || 0,
    hasThinking: content?.includes('<think>') || false,
    sample: content?.substring(0, 50) || ''
  });

  // Don't use caching for now as it might be causing issues with duplicate content
  // Create a unique ID for this message instance
  const messageId = `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const el = document.createElement('div');
  el.className = 'message assistant-message';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('data-id', messageId);

  // Extract thinking content properly
  let mainContent = content || '';
  let thinkingContent = '';

  if (content && content.includes('<think>')) {
    const thinkMatches = content.match(/<think>([\s\S]*?)<\/think>/g);
    if (thinkMatches) {
      console.log("Found thinking blocks:", thinkMatches.length);
      thinkingContent = thinkMatches.map(m => m.replace(/<\/?think>/g, '')).join('\n\n');
      mainContent = content.replace(/<think>[\s\S]*?<\/think>/g, '');
      
      // Clean up any trailing JSON objects that might have been added
      mainContent = mainContent.replace(/\s*\{"type"\s*:\s*"done".*?\}\s*$/g, "");
    }
  }

  // Process and sanitize main content
  const md = renderMarkdown(mainContent.trim());
  const enhanced = processCodeBlocks(md);
  const lazy = processImagesForLazyLoading(enhanced);
  
  // Create a content div to match the streaming renderer structure
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.style.width = '100%';
  contentDiv.style.minHeight = '20px';
  contentDiv.style.display = 'block';
  contentDiv.style.opacity = '1';
  contentDiv.style.visibility = 'visible';
  contentDiv.innerHTML = lazy;
  
  el.appendChild(contentDiv);

  // Add thinking content if present - use deepSeekProcessor if available for consistency
  if (thinkingContent && thinkingContent.trim()) {
    try {
      if (typeof deepSeekProcessor !== 'undefined' && deepSeekProcessor.renderThinkingContainer) {
        console.log('[displayManager] Using deepSeekProcessor to render thinking content');
        deepSeekProcessor.renderThinkingContainer(el, thinkingContent.trim(), { createNew: true });
      } else {
        console.log('[displayManager] Using built-in thinking renderer');
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-container mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded';
        thinkingDiv.setAttribute('data-cot-id', Date.now());
        thinkingDiv.innerHTML = `
          <details open>
            <summary class="font-medium cursor-pointer">Chain of Thought</summary>
            <div class="markdown-content mt-2">${renderMarkdown(thinkingContent)}</div>
          </details>
        `;
        el.appendChild(thinkingDiv);
      }
    } catch (error) {
      console.error('[displayManager] Error rendering thinking content:', error);
    }
  }

  return el;
}

// Make createAssistantMessageElement available globally for consistency between modules
window.displayManager = window.displayManager || {};
window.displayManager.createAssistantMessageElement = createAssistantMessageElement;

function processCodeBlocks(html) {
  return html.replace(
    /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
    (_, language, code) => {
      // escape any backticks or single quotes inside code content
      const safeCode = code.replace(/`/g, '&#96;').replace(/'/g, '&#39;');
      return `
        <div class="relative group">
          <button class="copy-code-button absolute top-2 right-2 p-1 rounded text-xs bg-gray-800/90 text-gray-100 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Copy code">
            Copy
          </button>
          <pre><code class="language-${language}">${safeCode}</code></pre>
        </div>
      `;
    }
  );
}

function processImagesForLazyLoading(html) {
  return html.replace(
    /<img\s+src="([^"]+)"/g,
    (_, src) => `<img data-src="${src}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" loading="lazy"`
  );
}

const pruneOldMessages = debounce(() => {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  const msgs = chatHistory.querySelectorAll('.message:not(.system-message)');
  if (msgs.length > messageRenderLimit) {
    const removeCount = msgs.length - messageRenderLimit;
    const scrollHeightBefore = chatHistory.scrollHeight;
    const scrollPositionBefore = chatHistory.scrollTop;
    for (let i = 0; i < removeCount; i++) {
      chatHistory.removeChild(msgs[i]);
    }
    hasMoreMessages = true;

    requestAnimationFrame(() => {
      const heightDiff = scrollHeightBefore - chatHistory.scrollHeight;
      chatHistory.scrollTop = Math.max(0, scrollPositionBefore - heightDiff);
    });
  }
}, 500);

let clientVersion = Date.now();

async function storeChatMessage(role, content) {
  try {
    // Get conversation ID, handling both Promise and direct value
    const sessionIdMaybe = getSessionId();
    const conversationId = sessionIdMaybe instanceof Promise ? await sessionIdMaybe : sessionIdMaybe;

    if (!conversationId) {
      console.error('No valid conversation ID found — cannot store message.');
      return;
    }

    if (!role || !content) {
      console.error('Missing role or content — cannot store message.');
      return;
    }

    // Use window.location.origin to ensure we're using the correct base URL
    const apiUrl = `${window.location.origin}/api/chat/conversations/${conversationId}/messages`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content })
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[storeChatMessage] Server error:', response.status, text);
        throw new Error(`Server returned ${response.status}: ${text}`);
      }

      console.log('[storeChatMessage] Message stored successfully');
    } catch (err) {
      console.warn('Failed to store message in backend:', err);
    }
  } catch (error) {
    console.error('Error in storeChatMessage:', error);
  }
}

function updateConversationTitle(title) {
  // Update the title in the UI if there's an appropriate element
  const titleElement = document.getElementById('conversation-title');
  if (titleElement) {
    titleElement.textContent = title;
  }

  // Could also update document title
  document.title = `${title} - Azure OpenAI Chat`;
}

function showWelcomeMessageIfNeeded() {
  const sessionId = getSessionId();
  if (!sessionId) return;
  const storageKey = `conversation_${sessionId}`;
  const storedConversation = localStorage.getItem(storageKey);
  const hasConversation = storedConversation && JSON.parse(storedConversation).length > 0;
  const welcomeShown = sessionStorage.getItem('welcome_message_shown') === 'true';
  if (!hasConversation && !welcomeShown) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    const welcomeMessage = document.createElement('div');
    welcomeMessage.className = 'system-message mx-auto max-w-2xl text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-8';
    welcomeMessage.innerHTML = `
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">Welcome to Azure OpenAI Chat</h2>
      <p class="text-gray-600 dark:text-gray-300 mb-4">
        This chat application uses Azure OpenAI&#39;s powerful language models.
      </p>
      <p class="text-gray-600 dark:text-gray-300">
        Type a message below to get started!
      </p>
    `;
    chatHistory.appendChild(welcomeMessage);
    sessionStorage.setItem('welcome_message_shown', 'true');
  }
}

function initMobileUI() {
  document.querySelectorAll('button:not([aria-label])').forEach(button => {
    if (!button.textContent.trim()) {
      button.setAttribute('aria-label', 'Button');
    }
  });
}

function openFileInSidebar(filename) {
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar?.classList.contains('translate-x-full')) sidebarToggle.click();
  }
  const filesTab = document.getElementById('files-tab');
  if (filesTab) filesTab.click();
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

        // 2. Delete the conversation on the server
        const deleteResponse = await fetch(`${window.location.origin}/api/chat/conversations/${sessionId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!deleteResponse.ok) {
          console.error(`Failed to delete conversation: ${deleteResponse.status}`);
          // Continue anyway to ensure UI is reset
        }

        // 3. Create a new conversation and ensure sessionStorage is updated
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
 * Extracted for cleaner code and reusability
 */
async function createAndSetupNewConversation() {
  // IMPORTANT: First remove the old session ID to prevent it from being reused
  sessionStorage.removeItem('sessionId');

  // 1. Create a new conversation (this internal function should update sessionStorage)
  const newSessionId = await createNewConversation();
  if (!newSessionId) {
    throw new Error('Failed to create new conversation');
  }

  // 2. Double-check that sessionStorage was updated correctly
  if (sessionStorage.getItem('sessionId') !== newSessionId) {
    console.warn('Session ID not properly updated, fixing it now');
    sessionStorage.setItem('sessionId', newSessionId);
  }

  // 3. Clear the UI
  const chatHistory = document.getElementById('chat-history');
  if (chatHistory) {
    // Keep system messages
    const systemMessages = [];
    chatHistory.querySelectorAll('.system-message').forEach(el =>
      systemMessages.push(el.cloneNode(true))
    );

    // Clear and restore system messages
    chatHistory.innerHTML = '';
    systemMessages.forEach(el => chatHistory.appendChild(el));

    // Restore conversation controls if they exist
    const controls = document.querySelector('.conversation-controls');
    if (controls) chatHistory.appendChild(controls);
  }

  // 4. Reset other display states
  messageCache.clear();
  hasMoreMessages = false;
  updateLoadMoreButton(0);

  // 5. Show welcome message if needed
  showWelcomeMessageIfNeeded();

  console.log('New conversation created with ID:', newSessionId);
  return newSessionId;
}

/**
 * Creates a new conversation session, clearing the chat
 * 
 * @param {boolean} pinned - Whether the conversation should be pinned
 * @param {boolean} archived - Whether the conversation should be archived
 * @param {string} title - Title for the conversation
 * @returns {Promise<string|null>} The new conversation ID or null on failure
 */
export async function createNewConversation(pinned = false, archived = false, title = "New Conversation") {
  try {
    // 1. Create the conversation on the server
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

    // 2. Get the new conversation ID
    const data = await response.json();
    const newConversationId = data.conversation_id;

    // 3. CRITICAL: Update session storage with the new ID
    console.log('Setting new session ID in storage:', newConversationId);
    sessionStorage.setItem('sessionId', newConversationId);

    // 4. Optional additional feedback
    console.log(`New conversation created: ${title} (ID: ${newConversationId})`);

    return newConversationId;
  } catch (err) {
    console.error("Error creating new conversation:", err);
    showNotification("Failed to create new conversation", "error");
    return null;
  }
}

/**
 * Standard error handler for conversation operations
 * 
 * @param {Error} error - The error that occurred
 * @param {string} userMessage - Message to show the user
 * @param {Function} recoveryFn - Optional function to call for recovery
 * @param {Object} analyticsData - Optional data for analytics
 */
export function handleConversationError(error, userMessage, callback, context) {
  console.error('Display Manager Error:', error);

  // Show error message in UI
  const errorDisplay = document.getElementById('error-display');
  if (errorDisplay) {
    errorDisplay.textContent = userMessage || 'An error occurred';
    errorDisplay.classList.remove('hidden');
  }

  // Recovery callback if provided
  if (callback) {
    callback();
  }
}

export {
  initDisplayManager,
  saveConversation
};

function limitChatHistory(chatHistory, maxCount) {
  const msgs = chatHistory.querySelectorAll('.message:not(.system-message)');
  if (msgs.length <= maxCount) return;

  const removeCount = msgs.length - maxCount;
  for (let i = 0; i < removeCount; i++) {
    msgs[i].remove();
  }
  hasMoreMessages = true;
}
