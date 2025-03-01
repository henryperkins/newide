import { renderMarkdown, sanitizeHTML, highlightCode } from './markdownParser.js';
import { showNotification, showConfirmDialog } from './notificationManager.js';
import { debounce, eventBus } from '../utils/helpers.js';
import { deepSeekProcessor } from './deepseekProcessor.js';
import { getSessionId } from '../session.js';

let messageRenderLimit = 30;
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
  if (e.target.classList.contains('thinking-toggle') || e.target.closest('.thinking-toggle')) {
    const toggle = e.target.closest('.thinking-toggle');
    if (!toggle) return;
    
    const thinkingProcess = toggle.closest('.thinking-process');
    if (!thinkingProcess) return;
    
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    
    // Update accessibility attributes
    toggle.setAttribute('aria-expanded', !isExpanded);
    thinkingProcess.setAttribute('data-collapsed', isExpanded ? 'false' : 'true');
    
    // Get related elements
    const content = thinkingProcess.querySelector('.thinking-content');
    const icon = toggle.querySelector('.toggle-icon');
    
    // Apply animations
    if (content) {
      content.classList.toggle('hidden', isExpanded);
      
      // Ensure height transitions work properly by forcing a reflow
      if (!isExpanded) {
        // This is a trick to force the browser to recompute styles
        window.getComputedStyle(content).getPropertyValue('opacity');
      }
    }
    
    // Animate icon with spring physics for a more natural feel
    if (icon) {
      icon.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      icon.style.transform = isExpanded ? 'rotate(0)' : 'rotate(-90deg)';
      icon.textContent = '▼'; // Always use same icon but rotate it
    }
  }
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

export function loadConversationFromLocalStorage() {
  const sessionId = getSessionId();
  if (!sessionId) return;
  const storageKey = `conversation_${sessionId}`;
  const storedConversation = localStorage.getItem(storageKey);
  if (!storedConversation) {
    updateLoadMoreButton();
    return;
  }
  try {
    let messages = JSON.parse(storedConversation);
    hasMoreMessages = messages.length > messageRenderLimit;
    const unloadedCount = Math.max(0, messages.length - messageRenderLimit);
    const recentMessages = messages.slice(-messageRenderLimit);
    const chatHistory = document.getElementById('chat-history');
    const systemMessages = [];
    if (chatHistory) {
      chatHistory.querySelectorAll('.system-message').forEach(el => systemMessages.push(el.cloneNode(true)));
      chatHistory.innerHTML = '';
      systemMessages.forEach(el => chatHistory.appendChild(el));
      recentMessages.forEach(m => {
        if (m.role === 'user') renderUserMessage(m.content, true, true);
        else if (m.role === 'assistant') renderAssistantMessage(m.content, true, true);
      });
    }
    updateLoadMoreButton(unloadedCount);
  } catch (e) {
    console.error('Error loading conversation:', e);
    showNotification('Failed to load previous conversation', 'error');
  }
}

export async function loadOlderMessages() {
  if (isLoadingPrevious || !hasMoreMessages) return;
  const sessionId = getSessionId();
  if (!sessionId) return;
  const storageKey = `conversation_${sessionId}`;
  const storedConversation = localStorage.getItem(storageKey);
  if (!storedConversation) return;
  try {
    isLoadingPrevious = true;
    const loadBtn = document.getElementById('load-older-btn');
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span> Loading...';
    }
    
    const allMessages = JSON.parse(storedConversation);
    const unloadedCount = Math.max(0, allMessages.length - messageRenderLimit);
    const chatHistory = document.getElementById('chat-history');
    
    if (chatHistory && unloadedCount > 0) {
      const batchSize = Math.min(messageRenderLimit, unloadedCount);
      const messagesToAdd = allMessages.slice(-messageRenderLimit - batchSize, -messageRenderLimit);
      
      // Save scroll position
      const scrollHeightBefore = chatHistory.scrollHeight;
      const scrollPositionBefore = chatHistory.scrollTop;
      
      // Insert older messages at the top
      messagesToAdd.forEach(m => {
        const messageElement = m.role === 'user' 
          ? createUserMessageElement(m.content) 
          : createAssistantMessageElement(m.content);
          
        chatHistory.insertBefore(messageElement, chatHistory.firstChild);
        if (m.role === 'assistant' && messageObserver) {
          messageElement.classList.add('observed');
          messageObserver.observe(messageElement);
        }
      });
      
      // Adjust scroll position to maintain view
      requestAnimationFrame(() => {
        const heightDiff = chatHistory.scrollHeight - scrollHeightBefore;
        chatHistory.scrollTop = scrollPositionBefore + heightDiff;
      });
      
      // Update hasMoreMessages status
      hasMoreMessages = allMessages.length > (messageRenderLimit + batchSize);
      updateLoadMoreButton(allMessages.length - (messageRenderLimit + batchSize));
      
      // Show save button after successfully loading older messages
      const saveBtn = document.getElementById('save-older-btn');
      if (saveBtn) {
        saveBtn.classList.remove('hidden');
        if (!saveBtn.hasEventListener) {
          saveBtn.addEventListener('click', saveConversation);
          saveBtn.hasEventListener = true;
        }
      }
    }
    
    isLoadingPrevious = false;
    const loadButton = document.getElementById('load-older-btn');
    if (loadButton) {
      loadButton.disabled = false;
    }
  } catch (e) {
    console.error(e);
    isLoadingPrevious = false;
    const loadButton = document.getElementById('load-older-btn');
    if (loadButton) {
      loadButton.disabled = false;
      updateLoadMoreButton();
    }
  }
}

function saveConversation() {
  const sessionId = getSessionId();
  if (!sessionId) {
    showNotification('No valid session found', 'error');
    return;
  }
  
  const storageKey = `conversation_${sessionId}`;
  const storedConversation = localStorage.getItem(storageKey);
  
  if (!storedConversation) {
    showNotification('No conversation to save', 'error');
    return;
  }
  
  try {
    // Create a new key with timestamp for saved conversation
    const savedKey = `saved_conversation_${Date.now()}`;
    localStorage.setItem(savedKey, storedConversation);
    
    showNotification('Conversation saved successfully', 'success');
  } catch (e) {
    console.error('Error saving conversation:', e);
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
  const messageElement = createUserMessageElement(content);
  chatHistory.appendChild(messageElement);
  if (!skipScroll) requestAnimationFrame(() => messageElement.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  pruneOldMessages();
  if (!skipStore) storeChatMessage('user', content);
  return messageElement;
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
  const cacheKey = `assistant-${content}`;
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
  
  // Add model name display with Tailwind classes
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
    
    // Calculate the unloaded count after pruning
    const sessionId = getSessionId();
    if (sessionId) {
      const storageKey = `conversation_${sessionId}`;
      const storedConversation = localStorage.getItem(storageKey);
      if (storedConversation) {
        try {
          const allMessages = JSON.parse(storedConversation);
          const unloadedCount = Math.max(0, allMessages.length - messageRenderLimit);
          updateLoadMoreButton(unloadedCount);
        } catch (e) {
          console.error('Error calculating unloaded messages count:', e);
          updateLoadMoreButton();
        }
      } else {
        updateLoadMoreButton();
      }
    } else {
      updateLoadMoreButton();
    }
    
    requestAnimationFrame(() => {
      const heightDiff = scrollHeightBefore - chatHistory.scrollHeight;
      chatHistory.scrollTop = Math.max(0, scrollPositionBefore - heightDiff);
    });
  }
}, 500);

function storeChatMessage(role, content) {
  const sessionId = getSessionId();
  // Ensure required fields are present
  if (!sessionId) {
    console.error('No valid session ID found — cannot store message.');
    return;
  }
  if (!role || !content) {
    console.error('Missing role or content — cannot store message.');
    return;
  }
  try {
    const storageKey = `conversation_${sessionId}`;
    let conv = JSON.parse(localStorage.getItem(storageKey) || '[]');
    conv.push({ role, content, timestamp: new Date().toISOString() });
    if (conv.length > 100) conv = conv.slice(-100);
    localStorage.setItem(storageKey, JSON.stringify(conv));
  } catch {}
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
  // Use ResizeObserver to handle orientation changes and viewport adjustments
  const resizeObserver = new ResizeObserver(entries => {
    const isMobile = window.innerWidth < 768;
    const isLandscape = window.innerWidth > window.innerHeight;
    
    // Adjust UI based on orientation
    document.body.classList.toggle('landscape', isLandscape && isMobile);
    
    // Fix iOS Safari viewport height issues
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
  });
  
  resizeObserver.observe(document.documentElement);
  
  // Handle orientation change explicitly for older browsers
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    }, 100);
  });
  
  const statsToggle = document.getElementById('mobile-stats-toggle');
  const statsPanel = document.getElementById('mobile-stats-panel');
  if (statsToggle && statsPanel) {
    statsToggle.addEventListener('click', () => {
      const wasHidden = statsPanel.classList.contains('hidden');
      statsPanel.classList.toggle('hidden', !wasHidden);
      statsPanel.setAttribute('aria-hidden', String(!wasHidden));
      statsToggle.setAttribute('aria-expanded', String(wasHidden));
      statsToggle.classList.toggle('bg-gray-100', wasHidden);
      statsToggle.classList.toggle('dark:bg-gray-700', wasHidden);
      if ('vibrate' in navigator) navigator.vibrate(10);
    });
    statsPanel.setAttribute('aria-hidden', 'true');
    statsToggle.setAttribute('aria-expanded', 'false');
  }
  const mobileFontUp = document.getElementById('mobile-font-up');
  const mobileFontDown = document.getElementById('mobile-font-down');
  if (mobileFontUp && mobileFontDown) {
    mobileFontUp.addEventListener('click', () => adjustFontSize(1));
    mobileFontDown.addEventListener('click', () => adjustFontSize(-1));
  }
  initDoubleTapToCopy();
  initPullToRefresh();
}

function initDoubleTapToCopy() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  let lastTap = 0, lastElement = null;
  chatHistory.addEventListener('touchend', (e) => {
    const msgDiv = e.target.closest('.assistant-message');
    if (!msgDiv) return;
    const now = Date.now();
    if (now - lastTap < 500 && lastElement === msgDiv) {
      const content = msgDiv.textContent;
      navigator.clipboard.writeText(content)
        .then(() => {
          const feedback = document.createElement('div');
          feedback.className = 'fixed top-4 right-4 bg-black/70 text-white py-2 px-4 rounded-md z-50';
          feedback.textContent = 'Copied to clipboard';
          document.body.appendChild(feedback);
          setTimeout(() => feedback.remove(), 1500);
        })
        .catch(err => console.error('Could not copy text:', err));
      e.preventDefault();
    }
    lastTap = now;
    lastElement = msgDiv;
  }, { passive: false });
}

function initPullToRefresh() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  let startY = 0, isPulling = false, threshold = 80, indicator = null;
  chatHistory.addEventListener('touchstart', (e) => {
    if (chatHistory.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    isPulling = true;
  }, { passive: true });
  chatHistory.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const currentY = e.touches[0].clientY;
    const pullDistance = currentY - startY;
    if (pullDistance > 0 && chatHistory.scrollTop <= 0) {
      e.preventDefault();
      chatHistory.style.transform = `translateY(${Math.min(pullDistance / 2, threshold)}px)`;
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'text-center text-gray-500 absolute top-0 left-0 right-0 z-10 py-2 bg-gray-100/80 dark:bg-gray-800/80 backdrop-blur-sm';
        indicator.textContent = 'Pull to load older messages';
        chatHistory.parentNode.prepend(indicator);
      }
      indicator.textContent = pullDistance > threshold ? 'Release to load older messages' : 'Pull to load older messages';
    }
  }, { passive: false });
  chatHistory.addEventListener('touchend', (e) => {
    if (!isPulling) return;
    const currentY = e.changedTouches[0].clientY;
    const pullDistance = currentY - startY;
    chatHistory.style.transform = '';
    if (pullDistance > threshold && chatHistory.scrollTop <= 0) {
      if (indicator) indicator.textContent = 'Loading...';
      loadOlderMessages();
    }
    setTimeout(() => {
      if (indicator) {
        indicator.remove();
        indicator = null;
      }
    }, 300);
    isPulling = false;
  }, { passive: true });
}

function adjustFontSize(direction) {
  const sizes = ['text-sm','text-base','text-lg','text-xl'];
  let currentIndex = sizes.findIndex(sz => document.documentElement.classList.contains(sz));
  if (currentIndex === -1) currentIndex = 1;
  const newIndex = Math.min(Math.max(currentIndex + direction, 0), sizes.length - 1);
  if (newIndex === currentIndex) return;
  document.documentElement.classList.remove(...sizes);
  document.documentElement.classList.add(sizes[newIndex]);
  localStorage.setItem('fontSize', sizes[newIndex]);
  eventBus.publish('fontSizeChanged', { fontSize: sizes[newIndex], sizeIndex: newIndex });
}

function applyFontSize(sizeClass) {
  const sizes = ['text-sm','text-base','text-lg','text-xl'];
  document.documentElement.classList.remove(...sizes);
  if (sizes.includes(sizeClass)) document.documentElement.classList.add(sizeClass);
  else document.documentElement.classList.add('text-base');
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

function clearConversation() {
  showConfirmDialog('Clear Conversation','Are you sure you want to clear the current conversation? This action cannot be undone.',() => {
    const sessionId = getSessionId();
    if (sessionId) localStorage.removeItem(`conversation_${sessionId}`);
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
    
    // Hide save button when conversation is cleared
    const saveBtn = document.getElementById('save-older-btn');
    if (saveBtn) {
      saveBtn.classList.add('hidden');
    }
    
    showNotification('Conversation cleared', 'success');
  });
}

export {
  initDisplayManager,
  clearConversation,
  saveConversation
};
