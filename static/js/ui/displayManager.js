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
  return true;
}

function setupEventListeners() {
  const loadOlderBtn = document.getElementById('load-older-btn');
  if (loadOlderBtn) loadOlderBtn.addEventListener('click', loadOlderMessages);

  const saveOlderBtn = document.getElementById('save-older-btn');
  if (saveOlderBtn) {
    saveOlderBtn.addEventListener('click', saveConversation);
    saveOlderBtn.hasEventListener = true;
  }

  const tokenUsageToggle = document.getElementById('toggle-token-details');
  const tokenDetails = document.getElementById('token-details');
  const tokenChevron = document.getElementById('token-chevron');
  if (tokenUsageToggle && tokenDetails && tokenChevron) {
    tokenUsageToggle.addEventListener('click', () => {
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
  const fontSizeUpBtn = document.getElementById('font-size-up');
  const fontSizeDownBtn = document.getElementById('font-size-down');
  const fontSizeResetBtn = document.getElementById('font-size-reset');
  if (fontSizeUpBtn) fontSizeUpBtn.addEventListener('click', () => adjustFontSize(1));
  if (fontSizeDownBtn) fontSizeDownBtn.addEventListener('click', () => adjustFontSize(-1));
  if (fontSizeResetBtn) fontSizeResetBtn.addEventListener('dblclick', () => adjustFontSize(0));
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
  const sessionId = maybeSession instanceof Promise ? await maybeSession : maybeSession;
  if (!sessionId) return;

  try {
    const res = await fetch(`/api/chat/conversations/history?session_id=${sessionId}&offset=0&limit=100`);
    if (!res.ok) {
      console.error('Failed to fetch conversation from DB:', res.statusText);
      showNotification('Failed to load conversation from DB', 'error');
      return;
    }
    const data = await res.json();

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

    // Append DB messages in chronological order
    data.messages.forEach(m => {
      if (m.role === 'user') {
        renderUserMessage(m.content, true, true);
      } else if (m.role === 'assistant') {
        renderAssistantMessage(m.content, true, true);
      }
    });
  } catch (e) {
    console.error('Error loading conversation from DB:', e);
    showNotification('Failed to load conversation from DB', 'error');
  }
}

export async function loadOlderMessages() {
    if (isLoadingPrevious || !hasMoreMessages) return;
    const sessionIdMaybe = getSessionId();
    const sessionId = sessionIdMaybe instanceof Promise ? await sessionIdMaybe : sessionIdMaybe;
    if (!sessionId) return;

    try {
        isLoadingPrevious = true;
        const loadBtn = document.getElementById('load-older-btn');
        if (loadBtn) {
            loadBtn.disabled = true;
            loadBtn.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Loading...';
        }

        const chatHistory = document.getElementById('chat-history');
        if (!chatHistory) {
            console.error("Chat history container not found.");
            return;
        }

        // Determine how many messages are currently rendered (excluding system messages).
        const rendered = chatHistory.querySelectorAll('.message:not(.system-message)').length;
        // We'll fetch the next 50 older messages from DB.
        const fetchLimit = 50;
        const api = `/api/chat/conversations/history?session_id=${sessionId}&offset=${rendered}&limit=${fetchLimit}`;
        const res = await fetch(api);
        if (!res.ok) {
            console.error('Failed to fetch older messages from DB:', res.statusText);
            showNotification('Failed to load older messages from DB', 'error');
            return;
        }
        const data = await res.json();

        if (!data || !data.messages?.length) {
            // No more messages
            hasMoreMessages = false;
            updateLoadMoreButton(0);
        } else {
            // Save scroll position
            const scrollHeightBefore = chatHistory.scrollHeight;
            const scrollPositionBefore = chatHistory.scrollTop;

            for (const m of data.messages) {
                const messageElement = m.role === 'user'
                    ? createUserMessageElement(m.content)
                    : createAssistantMessageElement(m.content);
                // Insert older messages at top
                if (chatHistory.firstChild) {
                    chatHistory.insertBefore(messageElement, chatHistory.firstChild);
                } else {
                    chatHistory.appendChild(messageElement);
                }
                if (m.role === 'assistant' && messageObserver) {
                    messageElement.classList.add('observed');
                    messageObserver.observe(messageElement);
                }
            }

            // Adjust scroll position to maintain view
            requestAnimationFrame(() => {
                const heightDiff = chatHistory.scrollHeight - scrollHeightBefore;
                chatHistory.scrollTop = scrollPositionBefore + heightDiff;
            });

            // If we got fewer than fetchLimit messages, we might have reached the end.
            hasMoreMessages = data.has_more;
            if (!hasMoreMessages) updateLoadMoreButton(0);
            else updateLoadMoreButton(); // We'll let the existing logic figure out how many remain
        }
    } catch (error) {
        console.error('Error loading older messages from DB:', error);
        showNotification('Error loading older messages', 'error');
    } finally {
        isLoadingPrevious = false;
        const loadButton = document.getElementById('load-older-btn');
        if (loadButton) {
            loadButton.disabled = false;
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
        const api = `/api/chat/conversations/history?session_id=${sessionId}&offset=0&limit=9999`;
        const res = await fetch(api);
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

        // Prepare JSON data, now including the chosen title
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
    content: content,
    role: 'user',
    timestamp: Date.now()
  };

  const element = document.createElement('div');
  element.dataset.id = message.id;
  element.className = 'message user-message';
  element.innerHTML = sanitizeHTML(content).replace(/\n/g, '<br>');

  chatHistory.appendChild(element);
  if (!skipScroll) requestAnimationFrame(() => element.scrollIntoView({ behavior: 'smooth', block: 'end' }));
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
  if (!skipScroll) requestAnimationFrame(() => messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  pruneOldMessages();
  if (!skipStore) storeChatMessage('assistant', content);
  return messageElement;
}

function createAssistantMessageElement(content) {
  const currentModel = window.modelManager?.getCurrentModelId() || 'unknown';
  const cacheKey = `assistant-${currentModel}-${content.substring(0, 40)}`; // Model-specific cache key
  if (messageCache.has(cacheKey)) return messageCache.get(cacheKey).cloneNode(true);

  const currentModel = window.modelManager?.getCurrentModelId() || document.getElementById('model-select')?.value || 'Unknown';

  const el = document.createElement('div');
  el.className = 'message assistant-message';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  let processed = content.includes('<think>') ? deepSeekProcessor.replaceThinkingBlocks(content) : content;
  const md = renderMarkdown(processed);
  const enhanced = processCodeBlocks(md);
  const lazy = processImagesForLazyLoading(enhanced);

  el.innerHTML = `
    ${lazy}
    <div class="font-mono text-xs text-gray-400/80 dark:text-gray-500 mt-2 transition-opacity opacity-70 hover:opacity-100">
      Model: ${currentModel}
    </div>
  `;

  messageCache.set(cacheKey, el.cloneNode(true));
  return el;
}

function processCodeBlocks(html) {
  return html.replace(
    /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
    (_, language, code) => `
      <div class="relative group">
        <button class="copy-code-button absolute top-2 right-2 p-1 rounded text-xs bg-dark-700/50 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity md:opacity-0 sm:opacity-100" aria-label="Copy code">
          Copy
        </button>
        <pre><code class="language-${language}">${code}</code></pre>
      </div>
    `
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
    for (let i = 0; i < removeCount; i++) chatHistory.removeChild(msgs[i]);
    hasMoreMessages = true;
    
    const sessionId = getSessionId();
    // if (sessionId) {
    //   const storageKey = `conversation_${sessionId}`;
    //   const storedConversation = localStorage.getItem(storageKey);
    //   if (storedConversation) {
    //     try {
    //       const allMessages = JSON.parse(storedConversation);
    //       const unloadedCount = Math.max(0, allMessages.length - messageRenderLimit);
    //       updateLoadMoreButton(unloadedCount);
    //     } catch (e) {
    //       console.error('Error calculating unloaded messages count:', e);
    //       updateLoadMoreButton();
    //     }
    //   } else {
    //     updateLoadMoreButton();
    //   }
    // } else {
    //   updateLoadMoreButton();
    // }

    requestAnimationFrame(() => {
      const heightDiff = scrollHeightBefore - chatHistory.scrollHeight;
      chatHistory.scrollTop = Math.max(0, scrollPositionBefore - heightDiff);
    });
  }
}, 500);

let clientVersion = Date.now();

function storeChatMessage(role, content) {
  const versionedContent = {
    content,
    clientVersion: clientVersion++,
    timestamp: new Date().toISOString()
  };
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error('No valid session ID found — cannot store message.');
    return;
  }
  if (!role || !content) {
    console.error('Missing role or content — cannot store message.');
    return;
  }
  try {
    // Session storage only for transient UI state
    sessionStorage.setItem('pending_message', JSON.stringify({ role, content }));
  try {
    fetch(`/api/chat/conversations/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, role, content })
    }).catch(() => {});
  } catch {}
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
        This chat application uses Azure OpenAI's powerful language models.
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
        f.classList.add('bg-blue-100','dark:bg-blue-900/30');
        setTimeout(() => f.classList.remove('bg-blue-100','dark:bg-blue-900/30'), 1500);
        break;
      }
    }
  }, 500);
}

async function deleteConversation() {
  showConfirmDialog(
    'Delete Conversation',
    'Are you sure you want to delete the current conversation? This action cannot be undone.',
    async () => {
      try {
        const sessionId = await getSessionId();
        if (sessionId) {
          // Remove from localStorage
          // localStorage.removeItem(`conversation_${sessionId}`);

          // Also delete from DB
          await fetch('/api/chat/conversations/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
          });
        }

        // Now remove from DOM
        const chatHistory = document.getElementById('chat-history');
        if (chatHistory) {
          const systemMessages = [];
          chatHistory.querySelectorAll('.system-message').forEach(el => systemMessages.push(el.cloneNode(true)));
          chatHistory.innerHTML = '';
          systemMessages.forEach(el => chatHistory.appendChild(el));
        }
        messageCache.clear();
        hasMoreMessages = false;
        updateLoadMoreButton(0);

        // Hide save button when conversation is deleted
        const saveBtn = document.getElementById('save-older-btn');
        if (saveBtn) {
          saveBtn.classList.add('hidden');
        }

        showNotification('Conversation deleted', 'success');
      } catch (err) {
        console.error('Error deleting conversation:', err);
        showNotification('Failed to delete conversation', 'error');
      }
    }
  );
}

/**
 * Creates a new conversation session, clearing the chat
 */
export function createNewConversation() {
    // Generate a new random session ID
    const newSessionId = crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    // localStorage.setItem('current_session_id', newSessionId);

    // Clear chat UI but keep system messages + conversation controls
    const chatHistory = document.getElementById('chat-history');
    if (chatHistory) {
        const systemMessages = [...chatHistory.querySelectorAll('.system-message')].map(el => el.cloneNode(true));
        const controls = chatHistory.querySelector('.conversation-controls');
        chatHistory.innerHTML = '';
        systemMessages.forEach(msg => chatHistory.appendChild(msg));
        if (controls) chatHistory.appendChild(controls);
    }
    // Force re-welcome
    showWelcomeMessageIfNeeded();

    showNotification('New conversation created', 'success');
}

export {
  initDisplayManager,
  deleteConversation,
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
