import { renderMarkdown, sanitizeHTML, highlightCode } from './markdownParser.js';
import { showNotification, showConfirmDialog } from './notificationManager.js';
import { debounce, eventBus } from '../utils/helpers.js';
import { deepSeekProcessor } from './deepseekProcessor.js';
import { getSessionId } from '../session.js';

//================================================================================
// Minimal Stub Implementations (retain references but remove verbose docs)
//================================================================================
function initMobileUI() {
  const chatHistory = document.getElementById('chat-history');
  if (chatHistory && window.matchMedia('(max-width: 768px)').matches) {
    const headerHeight = document.querySelector('header')?.offsetHeight || 64;
    const inputHeight = document.querySelector('.input-area')?.offsetHeight || 120;
    chatHistory.style.height = `calc(100dvh - ${headerHeight + inputHeight}px)`;
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    window.addEventListener('resize', () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    });
  }
}
function applyFontSize(fontSize) { }
function updateConversationTitle(title) { }
function showWelcomeMessageIfNeeded() { }
function storeChatMessage(role, content) { }
function pruneOldMessages() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  limitChatHistory(chatHistory, messageRenderLimit);
}

//================================================================================
// Main Variables
//================================================================================
let messageRenderLimit = 60;
let isLoadingPrevious = false;
let hasMoreMessages = true;
let messageCache = new Map();
let messageObserver;
let currentView = 'chat';

//================================================================================
// Initialization
//================================================================================
export function initDisplayManager() {
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
  const tokenUsageToggle = document.getElementById('token-usage-toggle');
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

function adjustFontSize(step) { }

//================================================================================
// Event Handling
//================================================================================
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
  if (e.target.classList.contains('file-ref-link') || e.target.closest('.file-ref-link')) {
    const link = e.target.closest('.file-ref-link');
    if (!link) return;
    e.preventDefault();
    openFileInSidebar(link.getAttribute('data-file-name'));
  }
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

//================================================================================
// Intersection Observer
//================================================================================
function setupIntersectionObserver() {
  if (messageObserver || !('IntersectionObserver' in window)) return;
  messageObserver = new IntersectionObserver(entries => {
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

//================================================================================
// Loading Conversation
//================================================================================
export async function loadConversationFromDb() {
  let maybeSession = getSessionId();
  const conversationId = maybeSession instanceof Promise ? await maybeSession : maybeSession;
  if (!conversationId) return;
  try {
    const res = await fetch(`/api/chat/conversations/${conversationId}/messages?offset=0&limit=100`);
    if (!res.ok) {
      if (res.status === 404) {
        console.warn('Conversation not found, creating a new conversation...');
        sessionStorage.removeItem('sessionId');
        const cm = await import('./conversationManager.js');
        await cm.createAndSetupNewConversation();
      } else {
        console.error('Failed to fetch conversation:', res.statusText);
        showNotification('Failed to load conversation from DB', 'error');
      }
      return;
    }
    const responseText = await res.text();
    let data;
    try { data = JSON.parse(responseText); }
    catch (jsonError) {
      console.error('Failed to parse JSON:', jsonError);
      showNotification('Invalid response format', 'error');
      return;
    }
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    const systemMessages = chatHistory.querySelectorAll('.system-message');
    const conversationControls = chatHistory.querySelector('.conversation-controls');
    chatHistory.innerHTML = '';
    systemMessages.forEach(el => chatHistory.appendChild(el));
    if (conversationControls) chatHistory.appendChild(conversationControls);
    if (data.messages && Array.isArray(data.messages)) {
      data.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      for (const m of data.messages) {
        const el = m.role === 'user'
          ? createUserMessageElement(m.content)
          : createAssistantMessageElement(m.content);
        chatHistory.appendChild(el);
      }
    }
    if (data.title) updateConversationTitle(data.title);
    setTimeout(() => {
      chatHistory.scrollTo({ top: chatHistory.scrollHeight, behavior: 'auto' });
    }, 100);
  } catch (e) {
    console.error('Error loading conversation:', e);
    showNotification('Failed to load conversation', 'error');
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
    if (!chatHistory) throw new Error('Chat history container not found');
    const scrollPositionBefore = chatHistory.scrollTop;
    const scrollHeightBefore = chatHistory.scrollHeight;
    const rendered = chatHistory.querySelectorAll('.message:not(.system-message)').length;
    const fetchLimit = 50;
    const api = `/api/chat/conversations/${conversationId}/messages?offset=${rendered}&limit=${fetchLimit}`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`Failed to fetch older messages: ${res.statusText}`);
    const data = await res.json();
    if (!data || !data.messages || !data.messages.length) {
      hasMoreMessages = false;
      updateLoadMoreButton(0);
      return;
    }
    const fragment = document.createDocumentFragment();
    data.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (const m of data.messages) {
      const element = m.role === 'user'
        ? createUserMessageElement(m.content)
        : createAssistantMessageElement(m.content);
      fragment.appendChild(element);
    }
    if (chatHistory.firstChild) {
      chatHistory.insertBefore(fragment, chatHistory.firstChild);
    } else {
      chatHistory.appendChild(fragment);
    }
    hasMoreMessages = data.has_more || data.messages.length >= fetchLimit;
    updateLoadMoreButton(
      data.total_count ? data.total_count - rendered - data.messages.length : 0
    );
    chatHistory.querySelectorAll('.message:not(.observed)').forEach(el => {
      if (messageObserver && el.classList.contains('assistant-message')) {
        el.classList.add('observed');
        messageObserver.observe(el);
      }
    });
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

//================================================================================
// Saving
//================================================================================
export async function saveConversation() {
  const sessionIdMaybe = getSessionId();
  const sessionId = sessionIdMaybe instanceof Promise ? await sessionIdMaybe : sessionIdMaybe;
  if (!sessionId) {
    showNotification('No valid session found', 'error');
    return;
  }
  try {
    const api = `/api/chat/conversations/${sessionId}/messages?offset=0&limit=9999`;
    const res = await fetch(api);
    if (!res.ok) {
      if (res.status === 422) {
        console.warn('Conversation data invalid. Creating new...');
        showNotification('Conversation data invalid', 'warning');
        sessionStorage.removeItem('sessionId');
        await createAndSetupNewConversation();
        return;
      } else {
        console.error('Failed to fetch conversation:', res.statusText);
        showNotification('Failed to fetch conversation', 'error');
        return;
      }
    }
    const data = await res.json();
    if (!data || !data.messages) {
      showNotification('No conversation to save', 'error');
      return;
    }
    const chatTitle = 'Conversation ' + new Date().toLocaleString();
    try {
      await fetch('/api/chat/conversations/set_title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: data.session_id, title: chatTitle })
      });
    } catch (error) {
      console.warn('Failed to set title on server:', error);
    }
    const exportData = {
      session_id: data.session_id,
      messages: data.messages,
      title: chatTitle,
      timestamp: new Date().toISOString()
    };
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${sessionId}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showNotification('Conversation downloaded', 'success');
  } catch (error) {
    console.error('Error saving conversation:', error);
    showNotification('Failed to save conversation', 'error');
  }
}

//================================================================================
// Load More Button
//================================================================================
function updateLoadMoreButton(unloadedCount) {
  const loadBtn = document.getElementById('load-older-btn');
  if (!loadBtn) return;
  loadBtn.classList.toggle('hidden', !hasMoreMessages);
  if (hasMoreMessages) {
    const sessionId = getSessionId();
    if (sessionId) {
      try {
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

//================================================================================
// Rendering
//================================================================================
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
      chatHistory.scrollTo({ top: chatHistory.scrollHeight, behavior: 'smooth' });
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
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    el.appendChild(document.createTextNode(line));
    if (index < lines.length - 1) el.appendChild(document.createElement('br'));
  });
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
  if (!skipScroll) {
    requestAnimationFrame(() => {
      chatHistory.scrollTo({ top: chatHistory.scrollHeight, behavior: 'smooth' });
    });
  }
  pruneOldMessages();
  if (!skipStore) storeChatMessage('assistant', content);
  return messageElement;
}

function createAssistantMessageElement(response) {
  let content = '';
  if (typeof response === 'object' && response !== null && response.content) content = String(response.content);
  else content = String(response);
  const messageId = `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const el = document.createElement('div');
  el.className = 'message assistant-message';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('data-id', messageId);
  let mainContent = content || '';
  let thinkingContent = '';
  if (content && content.includes('<think>')) {
    const thinkMatches = content.match(/<think>([\s\S]*?)<\/think>/g);
    if (thinkMatches) {
      thinkingContent = thinkMatches.map(m => m.replace(/<\/?think>/g, '')).join('\n\n');
      mainContent = content.replace(/<think>[\s\S]*?<\/think>/g, '');
      mainContent = mainContent.replace(/\s*\{"type"\s*:\s*"done".*?\}\s*$/g, '');
    }
  }
  const messageContentContainer = document.createElement('div');
  messageContentContainer.className = 'message-content';
  el.appendChild(messageContentContainer);
  const thinkingContainer = document.createElement('div');
  thinkingContainer.className = 'thinking-container';
  messageContentContainer.appendChild(thinkingContainer);
  const responseContentDiv = document.createElement('div');
  responseContentDiv.className = 'response-content';
  messageContentContainer.appendChild(responseContentDiv);
  if (thinkingContent && thinkingContent.trim()) {
    deepSeekProcessor.renderThinkingContainer(thinkingContainer, thinkingContent, { createNew: true, isComplete: true });
    thinkingContainer.style.display = 'block';
  } else thinkingContainer.style.display = 'none';
  responseContentDiv.innerHTML = renderMarkdown(mainContent.trim());
  return el;
}

//================================================================================
// Delete, Create, and Error Handling
//================================================================================
export async function deleteConversation() {
  showConfirmDialog('Delete Conversation', 'Are you sure?', async () => {
    try {
      const sessionId = await getSessionId();
      if (!sessionId) {
        await createAndSetupNewConversation();
        return;
      }
      const deleteResponse = await fetch(`${window.location.origin}/api/chat/conversations/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!deleteResponse.ok) console.error(`Failed to delete conversation: ${deleteResponse.status}`);
      await createAndSetupNewConversation();
      showNotification('Conversation deleted', 'success');
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      showNotification('Failed to delete conversation', 'error');
      try { await createAndSetupNewConversation(); } catch (err) { console.error('Failed to create new conversation:', err); }
    }
  });
}

export async function createAndSetupNewConversation() {
  sessionStorage.removeItem('sessionId');
  const newSessionId = await createNewConversation();
  if (!newSessionId) throw new Error('Failed to create new conversation');
  if (sessionStorage.getItem('sessionId') !== newSessionId) {
    sessionStorage.setItem('sessionId', newSessionId);
  }
  const chatHistory = document.getElementById('chat-history');
  if (chatHistory) {
    const systemMessages = [];
    chatHistory.querySelectorAll('.system-message').forEach(el => systemMessages.push(el.cloneNode(true)));
    chatHistory.innerHTML = '';
    systemMessages.forEach(el => chatHistory.appendChild(el));
    const controls = document.querySelector('.conversation-controls');
    if (controls) chatHistory.appendChild(controls);
  }
  messageCache.clear();
  hasMoreMessages = false;
  updateLoadMoreButton(0);
  showWelcomeMessageIfNeeded();
}

export async function createNewConversation(pinned = false, archived = false, title = 'New Conversation') {
  const existingSessionId = sessionStorage.getItem('sessionId');
  if (existingSessionId) {
    console.log('Reusing existing session:', existingSessionId);
    return existingSessionId;
  }
  try {
    const response = await fetch(`${window.location.origin}/api/chat/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, pinned, archived })
    });
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Failed to create conversation: ${response.status} - ${responseText}`);
    }
    const data = await response.json();
    const newConversationId = data.conversation_id;
    sessionStorage.setItem('sessionId', newConversationId);
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
  if (callback) callback();
}

//================================================================================
// Pruning
//================================================================================
function limitChatHistory(chatHistory, maxCount) {
  const msgs = chatHistory.querySelectorAll('.message:not(.system-message)');
  if (msgs.length <= maxCount) return;
  const removeCount = msgs.length - maxCount;
  for (let i = 0; i < removeCount; i++) msgs[i].remove();
  hasMoreMessages = true;
}
