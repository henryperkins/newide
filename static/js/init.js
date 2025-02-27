import { sendMessage } from './chat.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';
import { initThemeSwitcher } from './ui/themeSwitcher.js';
import { initTabSystem } from './ui/tabManager.js';
import { configureMarkdown } from './ui/markdownParser.js';
import { loadConversationFromLocalStorage, loadOlderMessages } from './ui/displayManager.js';
import StatsDisplay from './ui/statsDisplay.js';
import fileManager from './fileManager.js';
import { initializeConfig } from './config.js';
import './update_deepseek.js'; // Import DeepSeek-R1 configuration updater

document.addEventListener('DOMContentLoaded', () => {
  initThemeSwitcher();
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    const observer = new MutationObserver(() => {});
    observer.observe(modelSelect, { childList: true });
    setTimeout(() => {
      if (modelSelect.options.length === 0) {
        import('./models.js').then(module => {
          const { modelManager } = module;
          modelManager.ensureLocalModelConfigs();
          const models = modelManager.modelConfigs;
          if (Object.keys(models).length > 0 && modelSelect.options.length === 0) {
            modelSelect.innerHTML = '';
            for (const [id, config] of Object.entries(models)) {
              const option = document.createElement('option');
              option.value = id;
              option.textContent = `${id}${config.description ? ` (${config.description})` : ''}`;
              modelSelect.appendChild(option);
            }
            if (models['DeepSeek-R1']) {
              modelSelect.value = 'DeepSeek-R1';
              modelManager.updateModelSpecificUI('DeepSeek-R1');
            } else if (models['o1hp']) {
              modelSelect.value = 'o1hp';
              modelManager.updateModelSpecificUI('o1hp');
            }
          }
        });
      }
    }, 2000);
  }
  import('./models.js').then(module => {
    const { modelManager } = module;
    modelManager.initialize().then(() => {
      if (modelSelect && modelSelect.options.length === 0) {
        const defaultModels = [
          { id: 'o1hp', description: 'Advanced reasoning model for complex tasks' },
          { id: 'DeepSeek-R1', description: 'Model that supports chain-of-thought reasoning' }
        ];
        defaultModels.forEach(model => {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = `${model.id} (${model.description})`;
          modelSelect.appendChild(option);
        });
      }
    }).catch(err => console.error('Error initializing ModelManager:', err));
  });
  initThemeSwitcher();
  initTabSystem();
  configureMarkdown();
  initPerformanceStats();
  loadConversationFromLocalStorage();
  initChatInterface();
  initUserInput();
  document.addEventListener('DOMContentLoaded', () => {
    initTokenUsageDisplay();
  });
  registerKeyboardShortcuts();
  enhanceAccessibility();
  initializeFontSizeControls();
  initMobileUI();
  initializeConfig().catch(err => console.error('Error during config initialization:', err));
});

function initMobileUI() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    document.documentElement.classList.add('mobile-view');
    const statsToggle = document.getElementById('mobile-stats-toggle');
    const statsPanel = document.getElementById('mobile-stats-panel');
    if (statsToggle && statsPanel) {
      statsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const hidden = statsPanel.classList.contains('hidden');
        statsPanel.classList.toggle('hidden', !hidden);
        statsPanel.setAttribute('aria-hidden', String(!hidden));
        statsToggle.setAttribute('aria-expanded', String(hidden));
        statsToggle.classList.toggle('bg-gray-100', hidden);
        statsToggle.classList.toggle('dark:bg-gray-700', hidden);
        if ('vibrate' in navigator) navigator.vibrate(10);
        const liveRegion = document.getElementById('a11y-announcements');
        if (liveRegion) {
          liveRegion.textContent = hidden ? 'Settings panel opened' : 'Settings panel closed';
        }
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
    const fontToggle = document.getElementById('mobile-font-toggle');
    if (fontToggle && statsPanel) {
      fontToggle.addEventListener('click', () => {
        statsPanel.classList.toggle('hidden');
        if (!statsPanel.classList.contains('hidden') && mobileFontUp) {
          setTimeout(() => mobileFontUp.focus(), 100);
        }
      });
    }
    initMobileSidebar();
    initDoubleTapToCopy();
    initPullToRefresh();
  } else {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) {
      sidebar.classList.add('translate-x-full');
      sidebar.classList.remove('translate-x-0');
    }
    if (overlay) overlay.classList.add('hidden');
  }
}

function initDoubleTapToCopy() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  let lastTap = 0, lastElement = null;
  chatHistory.addEventListener('touchend', (e) => {
    const messageDiv = e.target.closest('.assistant-message');
    if (!messageDiv) return;
    const currentTime = new Date().getTime();
    if (currentTime - lastTap < 500 && lastElement === messageDiv) {
      const content = messageDiv.textContent;
      navigator.clipboard.writeText(content).then(() => {
        const feedback = document.createElement('div');
        feedback.className = 'fixed top-4 right-4 bg-black/70 text-white py-2 px-4 rounded-md z-50';
        feedback.textContent = 'Copied to clipboard';
        document.body.appendChild(feedback);
        setTimeout(() => feedback.remove(), 1500);
      });
      e.preventDefault();
    }
    lastTap = currentTime;
    lastElement = messageDiv;
  }, { passive: false });
}

function initMobileSidebar() {}

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
      window.loadOlderMessages();
    }
    setTimeout(() => { if (indicator) { indicator.remove(); indicator = null; } }, 300);
    isPulling = false;
  }, { passive: true });
}

export function syncMobileStats(stats) {
  const mobilePromptTokens = document.getElementById('mobile-prompt-tokens');
  const mobileCompletionTokens = document.getElementById('mobile-completion-tokens');
  const mobileTotalTokens = document.getElementById('mobile-total-tokens');
  const mobileTokensPerSecond = document.getElementById('mobile-tokens-per-second');
  if (mobilePromptTokens) mobilePromptTokens.textContent = stats.promptTokens || 0;
  if (mobileCompletionTokens) mobileCompletionTokens.textContent = stats.completionTokens || 0;
  if (mobileTotalTokens) mobileTotalTokens.textContent = stats.totalTokens || 0;
  if (mobileTokensPerSecond) {
    mobileTokensPerSecond.textContent = `${(stats.tokensPerSecond || 0).toFixed(1)} t/s`;
  }
}

function initializeFontSizeControls() {
  const smallerBtn = document.getElementById('font-size-down');
  const biggerBtn = document.getElementById('font-size-up');
  if (!smallerBtn || !biggerBtn) return;
  const storedSize = localStorage.getItem('fontSize') || 'text-base';
  document.documentElement.classList.add(storedSize);
  smallerBtn.addEventListener('click', () => adjustFontSize(-1));
  biggerBtn.addEventListener('click', () => adjustFontSize(1));
}

function adjustFontSize(direction) {
  const sizes = ['text-sm','text-base','text-lg','text-xl'];
  let currentIndex = sizes.findIndex(sz => document.documentElement.classList.contains(sz));
  if (currentIndex === -1) currentIndex = 1;
  const newIndex = Math.min(Math.max(currentIndex + direction, 0), sizes.length - 1);
  document.documentElement.classList.remove(...sizes);
  document.documentElement.classList.add(sizes[newIndex]);
  localStorage.setItem('fontSize', sizes[newIndex]);
}

function initPerformanceStats() {
  const statsDisplay = new StatsDisplay('performance-stats');
  window.statsDisplay = statsDisplay;
  statsDisplay.updateStats({ latency: 0, tokensPerSecond: 0, activeConnections: 0, totalTokens: 0 });
}

function initChatInterface() {
  initErrorDisplay();
  const conversationExists = localStorage.getItem('conversation') && JSON.parse(localStorage.getItem('conversation')).length > 0;
  const welcomeShown = sessionStorage.getItem('welcome_message_shown');
  if (!conversationExists && !welcomeShown) {
    showWelcomeMessage();
    sessionStorage.setItem('welcome_message_shown', 'true');
  }
}

function initErrorDisplay() {
  const errorDisplay = document.getElementById('error-display');
  const dismissButton = errorDisplay?.querySelector('button');
  if (dismissButton) {
    dismissButton.addEventListener('click', () => {
      errorDisplay.classList.add('hidden');
    });
  }
}

function showWelcomeMessage() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  if (sessionStorage.getItem('welcome_message_shown') === 'true') return;
  const welcomeMessage = document.createElement('div');
  welcomeMessage.className = 'mx-auto max-w-2xl text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-8';
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

function initUserInput() {
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  window.triggerSendMessage = function() {
    window.dispatchEvent(new CustomEvent('send-message'));
  };
  const saveConvoBtn = document.getElementById('save-convo-btn');
  const clearConvoBtn = document.getElementById('clear-convo-btn');
  const convoList = document.getElementById('conversation-list');
  if (saveConvoBtn) {
    saveConvoBtn.addEventListener('click', () => {
      const conversation = localStorage.getItem('conversation');
      if (!conversation) {
        alert('No conversation to save!');
        return;
      }
      const key = `conversation_${Date.now()}`;
      localStorage.setItem(key, conversation);
      alert('Conversation saved as ' + key);
      refreshConversationList();
    });
  }
  if (clearConvoBtn) {
    clearConvoBtn.addEventListener('click', () => {
      localStorage.removeItem('conversation');
      alert('Current conversation cleared.');
      location.reload();
    });
  }
  if (convoList) {
    convoList.addEventListener('change', (e) => {
      const key = e.target.value;
      if (!key) return;
      const savedConvo = localStorage.getItem(key);
      if (!savedConvo) {
        alert('Selected conversation not found.');
        return;
      }
      localStorage.setItem('conversation', savedConvo);
      alert('Conversation loaded.');
      location.reload();
    });
  }
  function refreshConversationList() {
    if (!convoList) return;
    convoList.innerHTML = '<option value="">-- Select --</option>';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('conversation_')) {
        const option = document.createElement('option');
        option.value = k;
        option.textContent = k;
        convoList.appendChild(option);
      }
    }
  }
  refreshConversationList();
  const loadOlderBtn = document.getElementById('load-older-btn');
  if (loadOlderBtn) {
    loadOlderBtn.addEventListener('click', loadOlderMessages);
  }
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.file-ref-link');
    if (link) {
      e.preventDefault();
      const fname = link.getAttribute('data-file-name');
      openFileInSidebar(fname);
    }
  });
  if (!userInput || !sendButton) return;
  userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
  });
  setTimeout(() => userInput.focus(), 100);
}

function openFileInSidebar(filename) {
  const toggleButton = document.querySelector('[aria-controls="config-content files-content"]');
  if (toggleButton) toggleButton.click();
  const filesTab = document.getElementById('files-tab');
  if (filesTab) filesTab.click();
  const fileManagerList = document.querySelector('.file-drop-area + .space-y-2');
  if (!fileManagerList) return;
  const fileItem = [...fileManagerList.children].find(c => c?.getAttribute('aria-label')?.includes(filename));
  if (fileItem) {
    fileItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fileItem.classList.add('bg-yellow-50', 'transition-colors');
    setTimeout(() => fileItem.classList.remove('bg-yellow-50'), 1200);
  }
}

function initTokenUsageDisplay() {
  const tokenUsage = document.getElementById('token-usage');
  const toggleButton = document.getElementById('toggle-token-details');
  if (tokenUsage && toggleButton) {
    toggleButton.addEventListener('click', () => {
      tokenUsage.querySelector('#token-details').classList.toggle('hidden');
      toggleButton.classList.toggle('active');
    });
  }
}

function registerKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const sendButton = document.getElementById('send-button');
      if (sendButton) sendButton.click();
    }
    if (e.key === 'Escape') {
      const sidebar = document.querySelector('aside');
      if (sidebar && !sidebar.classList.contains('translate-x-full') && window.innerWidth < 768) {
        sidebar.classList.add('translate-x-full');
        sidebar.classList.remove('translate-x-0');
        const overlay = document.getElementById('sidebar-overlay');
        if (overlay) overlay.classList.add('hidden');
        const toggleButton = document.querySelector('[aria-controls="config-content files-content"]');
        if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');
      }
    }
  });
}

function enhanceAccessibility() {
  const liveRegion = document.createElement('div');
  liveRegion.id = 'a11y-announcements';
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(liveRegion);
  document.querySelectorAll('button:not([aria-label])').forEach(button => {
    if (!button.textContent.trim()) {
      button.setAttribute('aria-label', 'Button');
    }
  });
}

function detectTouchCapability() {
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
  if (isTouchDevice) {
    document.documentElement.classList.add('touch-device');
    const defaultFontSize = localStorage.getItem('fontSize') || 'text-base';
    if (!localStorage.getItem('fontSize') && window.matchMedia('(max-width: 640px)').matches) {
      document.documentElement.classList.add('text-lg');
      localStorage.setItem('fontSize', 'text-lg');
    } else {
      document.documentElement.classList.add(defaultFontSize);
    }
  }
}
detectTouchCapability();