/* eslint-disable no-unused-vars */
/* Import statements retained as-is */
import { sendMessage } from './chat.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';
import { modelManager } from './models.js';
import { initThemeSwitcher } from './ui/themeSwitcher.js';
import { initTabSystem } from './ui/tabManager.js';
import { initSidebar, initConversationSidebar } from './ui/sidebarManager.js';
import { configureMarkdown } from './ui/markdownParser.js';
import { loadConversationFromDb, loadOlderMessages } from './ui/displayManager.js';
import { StatsDisplay } from './ui/statsDisplay.js';
import fileManager from './fileManager.js';
import { showNotification } from './ui/notificationManager.js';
import { getSessionId, createNewConversation, refreshSession } from './session.js';
import { initSentry, captureError, captureMessage } from './sentryInit.js';
import { globalStore } from './store.js';

if (typeof DOMPurify !== 'undefined') {
  DOMPurify.setConfig({
    ADD_TAGS: ['div', 'pre'],
    ADD_ATTR: ['class', 'aria-expanded'],
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

document.addEventListener('DOMContentLoaded', initApplication);

async function ensureValidSession() {
  try {
    const transaction = await import('./sentryInit.js').then(module => {
      return module.startTransaction('session_initialization', 'session');
    });
    const { ensureValidSession: sessionValidation, refreshSession } = await import('./session.js');
    const sessionId = await sessionValidation();
    if (!sessionId) {
      console.warn('Failed to get a valid session ID');
      captureMessage('Failed to get a valid session ID', 'warning');
      showNotification(
        'Unable to create a session. Some features may not work correctly.',
        'warning',
        10000,
        [{ label: 'Refresh', onClick: () => window.location.reload() }]
      );
      captureMessage('Failed to create a new session after multiple attempts', 'error');
    } else {
      captureMessage('Session initialization successful', 'info', { sessionId });
      await refreshSession(sessionId);
    }
    if (transaction) {
      transaction.finish();
    }
    return sessionId;
  } catch (error) {
    console.error('Session initialization error:', error);
    captureError(error, { context: 'Session initialization' });
    showNotification(
      'Error initializing session. Please refresh if you encounter problems.',
      'warning',
      10000,
      [{ label: 'Refresh', onClick: () => window.location.reload() }]
    );
    return null;
  }
}

function showFallbackUI(error) {
  const container = document.getElementById('chat-container') || document.body;
  const errorElement = document.createElement('div');
  errorElement.className = 'error-message p-4 m-4 bg-red-50 text-red-700 rounded-md border border-red-200';
  errorElement.innerHTML = `
    <h3 class="text-lg font-semibold mb-2">Application Error</h3>
    <p>The application encountered an error during initialization.</p>
    <p class="mt-2 text-sm text-red-600">${(error && error.message) ? error.message : error.toString()}</p>
    <button class="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
      Refresh Page
    </button>
    <button class="mt-4 ml-2 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300" id="report-error-btn">
      Report Error
    </button>
  `;
  errorElement.querySelector('button').addEventListener('click', () => {
    window.location.reload();
  });
  const reportButton = errorElement.querySelector('#report-error-btn');
  if (reportButton) {
    reportButton.addEventListener('click', () => {
      import('./sentryInit.js').then(module => {
        module.captureMessage('User manually reported error', 'error', {
          error: error.toString(),
          stack: error.stack,
          location: window.location.href
        });
        reportButton.textContent = 'Error Reported';
        reportButton.disabled = true;
        reportButton.classList.add('opacity-50');
      });
    });
  }
  container.innerHTML = '';
  container.appendChild(errorElement);
}

async function initApplication() {
  try {
    if (typeof window.Sentry === 'undefined' || !window.Sentry._initialized) {
      initSentry({
        dsn: window.SENTRY_DSN || 'https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528',
        environment: window.SENTRY_ENVIRONMENT || 'development',
        release: window.SENTRY_RELEASE || '1.0.0',
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        maskAllInputs: true,
      });
    }
    captureMessage('Application initialization started', 'info');
    fixLayoutIssues();
    initThemeSwitcher();
    const sentryInitPromise = import('./sentryInit.js').then(module => {
      if (typeof window.Sentry === "undefined") {
        return module.initSentry({
          dsn: window.SENTRY_DSN || 'https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528',
          environment: window.SENTRY_ENVIRONMENT || 'development',
          release: window.SENTRY_RELEASE || '1.0.0',
          tracesSampleRate: 1.0,
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1.0,
          maskAllInputs: true,
        });
      }
      return module;
    });
    const sessionId = await ensureValidSession();
    await sentryInitPromise.then(module => {
      if (sessionId) {
        window.sentryUser = { id: sessionId };
        module.setUser(window.sentryUser);
        module.setTag('session_id', sessionId);
      }
      module.captureMessage('Application initialization started', 'info');
    });
    initTabSystem();
    const { sidebarManager, initSidebar, toggleSidebar } = await import('./ui/sidebarManager.js');
    if (typeof initSidebar === 'function') {
      initSidebar();
    } else if (typeof sidebarManager?.initEventListeners === 'function') {
      sidebarManager.initEventListeners();
    }
    window.toggleConversationSidebar = function (show) {
      const sidebar = document.getElementById('conversations-sidebar');
      const isOpen = sidebar ? !sidebar.classList.contains('-translate-x-full') : false;
      if (typeof show === 'undefined') {
        show = !isOpen;
      }
      if (typeof toggleSidebar === 'function') {
        toggleSidebar('conversations-sidebar', show);
      } else if (typeof sidebarManager?.toggleSidebar === 'function') {
        sidebarManager.toggleSidebar('conversations-sidebar', show);
      } else {
        console.warn('No sidebar manager found, cannot toggle sidebar properly');
        // No direct DOM manipulation fallback as it bypasses state management
      }
    };
    const { initConversationManager } = await import('./ui/conversationManager.js');
    await initConversationManager();
    deepSeekProcessor.initializeExistingBlocks();
    initMobileUI();
    initPerformanceStats();
    configureMarkdown();
    initChatInterface();
    initUserInput();
    initFontSizeControls();
    enhanceAccessibility();
    detectTouchCapability();
    registerKeyboardShortcuts();
    initConfigHandlers();
    initTokenUsageDisplay();
    await loadConversationFromDb();
    maybeShowWelcomeMessage();
    await modelManager.initialize();
    initModelSelector();
    setupResizeHandler();
    captureMessage('Application initialization complete', 'info');
  } catch (error) {
    console.error('Initialization error:', error);
    captureError(error, { context: 'Application initialization' });
    showFallbackUI(error);
  }
}

function syncTabPanelDisplay() {
  const tabPanels = document.querySelectorAll('[role="tabpanel"]');
  tabPanels.forEach(panel => {
    panel.classList.add('relative', 'w-full', 'h-auto');
    const tabId = panel.id;
    const button = document.querySelector(`[data-target-tab="${tabId}"]`);
    const shouldBeVisible = button && button.getAttribute('aria-selected') === 'true';
    panel.classList.toggle('hidden', !shouldBeVisible);
    panel.setAttribute('aria-hidden', String(!shouldBeVisible));
  });
}

function fixLayoutIssues() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.remove('translate-x-full', 'md:translate-x-0', 'translate-x-0');
    sidebar.classList.add('fixed', 'top-[64px]', 'bottom-0', 'right-0', 'z-50');
    if (window.innerWidth < 768) {
      sidebar.classList.add('w-full');
      sidebar.classList.remove('w-96');
    } else {
      sidebar.classList.remove('w-full');
      sidebar.classList.add('w-96');
    }
    // Use translate class directly for state detection
    const isOpen = !sidebar.classList.contains('translate-x-full');
    if (!isOpen) {
      sidebar.classList.add('translate-x-full');
      sidebar.classList.remove('translate-x-0');
    } else {
      sidebar.classList.add('translate-x-0');
      sidebar.classList.remove('translate-x-full');
    }
  }
  const conversationsSidebar = document.getElementById('conversations-sidebar');
  if (conversationsSidebar) {
    conversationsSidebar.classList.remove('-translate-x-full', 'translate-x-0');
    conversationsSidebar.classList.add('fixed', 'top-[64px]', 'bottom-0', 'left-0', 'z-50');
    if (window.innerWidth < 768) {
      conversationsSidebar.classList.add('w-[85%]', 'max-w-[320px]');
      conversationsSidebar.classList.remove('w-64');
    } else {
      conversationsSidebar.classList.remove('w-[85%]', 'max-w-[320px]');
      conversationsSidebar.classList.add('w-64');
    }
    // Use translate class directly for state detection
    const isOpen = !conversationsSidebar.classList.contains('-translate-x-full');
    if (!isOpen) {
      conversationsSidebar.classList.add('-translate-x-full');
      conversationsSidebar.classList.remove('translate-x-0');
    } else {
      conversationsSidebar.classList.add('translate-x-0');
      conversationsSidebar.classList.remove('-translate-x-full');
    }
  }
  syncTabPanelDisplay();
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    overlay.classList.add('pointer-events-auto');
    overlay.classList.add('z-40');
    if (!overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
  }
}

function setupResizeHandler() {
  const handleResize = debounce(() => {
    const isMobile = window.innerWidth < 768;
    const sidebar = document.getElementById('sidebar');
    const conversationsSidebar = document.getElementById('conversations-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const chatContainer = document.getElementById('chat-container');
    if (sidebar) {
      if (isMobile) {
        sidebar.classList.add('w-full');
        sidebar.classList.remove('w-96');
      } else {
        sidebar.classList.remove('w-full');
        sidebar.classList.add('w-96');
      }
      const isOpen = !sidebar.classList.contains('translate-x-full');
      if (isOpen) {
        if (!isMobile && chatContainer) {
          chatContainer.classList.add('with-sidebar');
        } else if (chatContainer) {
          chatContainer.classList.remove('with-sidebar');
        }
        if (overlay && isMobile) {
          overlay.classList.remove('hidden');
        }
      }
    }
    if (conversationsSidebar) {
      if (isMobile) {
        conversationsSidebar.classList.add('w-[85%]', 'max-w-[320px]');
        conversationsSidebar.classList.remove('w-64');
      } else {
        conversationsSidebar.classList.remove('w-[85%]', 'max-w-[320px]');
        conversationsSidebar.classList.add('w-64');
      }
      const isConversationsOpen = !conversationsSidebar.classList.contains('-translate-x-full');
      if (isConversationsOpen && overlay && isMobile) {
        overlay.classList.remove('hidden');
      }
    }
    if (overlay && isMobile) {
      const rightOpen = sidebar && !sidebar.classList.contains('translate-x-full');
      const leftOpen = conversationsSidebar && !conversationsSidebar.classList.contains('-translate-x-full');
      if (!rightOpen && !leftOpen) {
        overlay.classList.add('hidden');
      }
    } else if (overlay && !isMobile) {
      overlay.classList.add('hidden');
    }
    syncTabPanelDisplay();
  }, 250);
  window.addEventListener('resize', handleResize);
}

function initPerformanceStats() {
  try {
    if (!globalStore.statsDisplay) {
      globalStore.statsDisplay = new StatsDisplay('performance-stats');
    }
  } catch (err) {
    console.error('Failed to initialize performance stats:', err);
  }
}

function initChatInterface() {
  initErrorDisplay();
}

function initErrorDisplay() {
  const errorDisplay = document.getElementById('error-display');
  if (!errorDisplay) return;
  const dismissButton = errorDisplay.querySelector('button');
  if (dismissButton) {
    dismissButton.addEventListener('click', () => {
      errorDisplay.classList.add('hidden');
    });
  }
}

function maybeShowWelcomeMessage() {
  const conversationExists = globalStore.conversation && globalStore.conversation.length > 0;
  const welcomeShown = globalStore.welcomeMessageShown ? 'true' : '';
  if (!conversationExists && !welcomeShown) {
    showWelcomeMessage();
    globalStore.welcomeMessageShown = true;
  }
}

function showWelcomeMessage() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  const welcomeMessage = document.createElement('div');
  welcomeMessage.className =
    'mx-auto max-w-2xl text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-8';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-gray-900 dark:text-white mb-4';
  heading.textContent = 'Welcome to Azure OpenAI Chat';
  const para1 = document.createElement('p');
  para1.className = 'text-gray-600 dark:text-gray-300 mb-4';
  para1.textContent = 'This chat application uses Azure OpenAI\'s powerful language models.';
  const para2 = document.createElement('p');
  para2.className = 'text-gray-600 dark:text-gray-300';
  para2.textContent = 'Type a message below to get started!';
  welcomeMessage.append(heading, para1, para2);
  chatHistory.appendChild(welcomeMessage);
}

function initUserInput() {
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  window.triggerSendMessage = function () {
    window.dispatchEvent(new CustomEvent('send-message'));
  };
  const saveConvoBtn = document.getElementById('save-older-btn');
  if (saveConvoBtn) {
    safeAddEventListener(saveConvoBtn, 'click', async () => {
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.saveConversation === 'function') {
          module.saveConversation();
        } else {
          captureMessage('saveConversation function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to save conversation:', err);
        captureError(err, { context: 'Save conversation' });
      }
    });
  }
  const clearConvoBtn = document.getElementById('clear-convo-btn');
  if (clearConvoBtn) {
    safeAddEventListener(clearConvoBtn, 'click', async () => {
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.deleteConversation === 'function') {
          module.deleteConversation();
        } else {
          captureMessage('deleteConversation function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to clear conversation:', err);
        captureError(err, { context: 'Clear conversation' });
      }
    });
  }
  const newConvoBtn = document.getElementById('new-convo-btn');
  if (newConvoBtn) {
    safeAddEventListener(newConvoBtn, 'click', async () => {
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.createNewConversation === 'function') {
          module.createNewConversation();
        } else {
          captureMessage('createNewConversation function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to create new conversation:', err);
        captureError(err, { context: 'Create new conversation' });
      }
    });
  }
  const loadOlderBtn = document.getElementById('load-older-btn');
  if (loadOlderBtn) {
    safeAddEventListener(loadOlderBtn, 'click', async () => {
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.loadOlderMessages === 'function') {
          module.loadOlderMessages();
        } else {
          captureMessage('loadOlderMessages function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to load older messages:', err);
        captureError(err, { context: 'Load older messages' });
      }
    });
  }
  document.addEventListener('click', e => {
    const link = e.target.closest('.file-ref-link');
    if (link) {
      e.preventDefault();
      const fname = link.getAttribute('data-file-name');
      openFileInSidebar(fname);
    }
  });
  if (userInput && sendButton) {
    setTimeout(() => userInput.focus(), 100);
    userInput.addEventListener('input', () => {
      const charCount = document.getElementById('char-count');
      if (charCount) {
        charCount.textContent = userInput.value.length;
      }
      userInput.classList.add('h-auto', 'overflow-y-auto', 'max-h-52');
    });
    sendButton.addEventListener('click', () => {
      if (typeof sendMessage === 'function') {
        sendMessage();
      } else if (typeof window.sendMessage === 'function') {
        window.sendMessage();
      }
    });
    userInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (typeof sendMessage === 'function') {
          sendMessage();
        } else if (typeof window.sendMessage === 'function') {
          window.sendMessage();
        }
      }
    });
  }
}

function openFileInSidebar(filename) {
  import('./ui/sidebarManager.js').then(module => {
    if (typeof module.toggleSidebar === 'function') {
      module.toggleSidebar('sidebar', true);
    } else if (typeof module.sidebarManager?.toggleSidebar === 'function') {
      module.sidebarManager.toggleSidebar('sidebar', true);
    } else {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.classList.remove('translate-x-full');
        sidebar.classList.add('translate-x-0'); // Removed sidebar-open class
        if (window.innerWidth < 768) {
          const overlay = document.getElementById('sidebar-overlay');
          if (overlay) overlay.classList.remove('hidden');
        }
      }
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
  }).catch(err => {
    console.error("Error opening file in sidebar:", err);
  });
}

function initTokenUsageDisplay() {
  const tokenUsage = document.getElementById('token-usage');
  const toggleButton = document.getElementById('token-usage-toggle');
  const tokenDetails = document.getElementById('token-details');
  const tokenChevron = document.getElementById('token-chevron');
  if (tokenUsage && toggleButton) {
    safeAddEventListener(toggleButton, 'click', () => {
      if (tokenDetails) {
        tokenDetails.classList.toggle('hidden');
      }
      if (tokenChevron) {
        tokenChevron.classList.toggle('rotate-180');
      }
      globalStore.tokenDetailsVisible = !tokenDetails || !tokenDetails.classList.contains('hidden');
    });
    const tokenDetailsVisible = globalStore.tokenDetailsVisible;
    if (tokenDetailsVisible && tokenDetails) {
      tokenDetails.classList.remove('hidden');
      if (tokenChevron) {
        tokenChevron.classList.add('rotate-180');
      }
    }
  }
}

function registerKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const sendButton = document.getElementById('send-button');
      if (sendButton) sendButton.click();
    }
    if (e.key === 'Escape') {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && !sidebar.classList.contains('translate-x-full') && window.innerWidth < 768) {
        const sidebarToggle = document.getElementById('sidebar-toggle');
        if (sidebarToggle) sidebarToggle.click();
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
  const isTouchDevice =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    navigator.msMaxTouchPoints > 0;
  if (isTouchDevice) {
    document.documentElement.classList.add('touch-device');
    const currentFontSize = globalStore.fontSize;
    if (currentFontSize === 'text-base' && window.matchMedia('(max-width: 640px)').matches) {
      document.documentElement.classList.add('text-lg');
      globalStore.fontSize = 'text-lg';
    } else {
      document.documentElement.classList.add(currentFontSize);
    }
  }
}

function initModelSelector() {
  const modelSelect = document.getElementById('model-select');
  if (!modelSelect) return;
  import('./models.js').then(async ({ modelManager }) => {
    modelManager.ensureLocalModelConfigs();
    if (!modelManager.modelConfigs) {
      return;
    }
    setTimeout(() => {
      if (modelSelect.options.length === 0) {
        const models = modelManager.modelConfigs;
        if (!models) return;
        if (Object.keys(models).length > 0) {
          modelSelect.innerHTML = '';
          for (const [id, config] of Object.entries(models)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = id + (config.description ? ' (' + config.description + ')' : '');
            modelSelect.appendChild(option);
          }
          if (models['DeepSeek-R1']) {
            modelSelect.value = 'DeepSeek-R1';
            modelManager.updateModelSpecificUI('DeepSeek-R1');
          } else if (models['o1']) {
            modelSelect.value = 'o1';
            modelManager.updateModelSpecificUI('o1');
          }
        }
      }
    }, 500);
    try {
      await modelManager.refreshModelsList();
    } catch (err) { }
    try {
      await modelManager.initialize();
      modelManager.initModelManagement();
      await modelManager.refreshModelsList();
    } catch (err) {
      console.error('Error initializing ModelManager:', err);
    }
  })
    .catch(err => console.error('Failed to load models.js:', err));
}

function initMobileUI() {
  initDoubleTapToCopy();
  initPullToRefresh();
  setupMobileStatsToggle();
  setupMobileFontControls();
  initMobileSidebarHandlers();
  const chatContainer = document.getElementById('chat-container');
  if (chatContainer) {
    chatContainer.classList.add('flex', 'flex-col', 'h-screen', 'overflow-hidden');
    const chatHistory = document.getElementById('chat-history');
    if (chatHistory) {
      chatHistory.classList.add('flex-grow', 'overflow-y-auto');
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
      const headerHeight = document.querySelector('header')?.offsetHeight || 64;
      const inputHeight = document.querySelector('.input-area')?.offsetHeight || 120;
      chatHistory.style.height = `calc(100dvh - ${headerHeight + inputHeight}px)`;
    }
  }
  const inputArea = document.querySelector('.input-area');
  if (inputArea) {
    inputArea.style.paddingBottom = 'calc(1rem + env(safe-area-inset-bottom, 0))';
  }
}

function initMobileSidebarHandlers() {
  const mobileConversationsToggle = document.getElementById('mobile-conversations-toggle');
  if (mobileConversationsToggle) {
    const newToggleBtn = mobileConversationsToggle.cloneNode(true);
    if (mobileConversationsToggle.parentNode) {
      mobileConversationsToggle.parentNode.replaceChild(newToggleBtn, mobileConversationsToggle);
    }
    newToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window.toggleConversationSidebar === 'function') {
        window.toggleConversationSidebar();
      }
    });
  }
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    const newOverlay = overlay.cloneNode(true);
    if (overlay.parentNode) {
      overlay.parentNode.replaceChild(newOverlay, overlay);
    }
    newOverlay.addEventListener('click', () => {
      import('./ui/sidebarManager.js').then(module => {
        const sidebar = document.getElementById('sidebar');
        const conversationsSidebar = document.getElementById('conversations-sidebar');
        if (sidebar && !sidebar.classList.contains('translate-x-full')) {
          if (typeof module.toggleSidebar === 'function') {
            module.toggleSidebar('sidebar', false);
          } else if (typeof module.sidebarManager?.toggleSidebar === 'function') {
            module.sidebarManager.toggleSidebar('sidebar', false);
          }
        }
        if (conversationsSidebar && !conversationsSidebar.classList.contains('-translate-x-full')) {
          if (typeof module.toggleSidebar === 'function') {
            module.toggleSidebar('conversations-sidebar', false);
          } else if (typeof module.sidebarManager?.toggleSidebar === 'function') {
            module.sidebarManager.toggleSidebar('conversations-sidebar', false);
          }
        }
      }).catch(err => {
        console.error("Error handling overlay click:", err);
      });
    });
  }
}

function initDoubleTapToCopy() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  let lastTap = 0;
  let lastElement = null;
  chatHistory.addEventListener(
    'touchend',
    e => {
      const messageDiv = e.target.closest('.assistant-message');
      if (!messageDiv) return;
      const currentTime = new Date().getTime();
      if (currentTime - lastTap < 500 && lastElement === messageDiv) {
        const content = messageDiv.textContent || '';
        navigator.clipboard.writeText(content).then(() => {
          const feedback = document.createElement('div');
          feedback.className =
            'fixed top-4 right-4 bg-black/70 text-white py-2 px-4 rounded-md z-50';
          feedback.textContent = 'Copied to clipboard';
          document.body.appendChild(feedback);
          setTimeout(() => feedback.remove(), 1500);
        });
        e.preventDefault();
      }
      lastTap = currentTime;
      lastElement = messageDiv;
    },
    { passive: false }
  );
}

function initPullToRefresh() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  let startY = 0;
  let isPulling = false;
  const threshold = 80;
  let indicator = null;
  chatHistory.addEventListener(
    'touchstart',
    e => {
      if (chatHistory.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      isPulling = true;
    },
    { passive: true }
  );
  chatHistory.addEventListener(
    'touchmove',
    e => {
      if (!isPulling) return;
      const currentY = e.touches[0].clientY;
      const pullDistance = currentY - startY;
      if (pullDistance > 0 && chatHistory.scrollTop <= 0) {
        e.preventDefault();
        chatHistory.style.setProperty('--pull-distance', `${Math.min(pullDistance / 2, threshold)}px`);
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className =
            'text-center text-gray-500 absolute top-0 left-0 right-0 z-10 py-2 bg-gray-100/80 dark:bg-gray-800/80 backdrop-blur-sm';
          indicator.textContent = 'Pull to load older messages';
          chatHistory.parentNode.prepend(indicator);
        }
        indicator.textContent =
          pullDistance > threshold
            ? 'Release to load older messages'
            : 'Pull to load older messages';
      }
    },
    { passive: false }
  );
  chatHistory.addEventListener(
    'touchend',
    e => {
      if (!isPulling) return;
      const currentY = e.changedTouches[0].clientY;
      const pullDistance = currentY - startY;
      chatHistory.style.removeProperty('--pull-distance');
      if (pullDistance > threshold && chatHistory.scrollTop <= 0) {
        if (indicator) indicator.textContent = 'Loading...';
        import('./ui/displayManager.js')
          .then(module => {
            if (typeof module.loadOlderMessages === 'function') {
              module.loadOlderMessages();
            }
          })
          .catch(err => {
            console.error('Failed to load displayManager:', err);
            captureError(err, { context: 'Pull to refresh' });
          });
      }
      setTimeout(() => {
        if (indicator) {
          indicator.remove();
          indicator = null;
        }
      }, 300);
      isPulling = false;
    },
    { passive: true }
  );
}

function setupMobileStatsToggle() {
  const mobileStatsToggle = document.getElementById('mobile-stats-toggle');
  const mobileStatsPanel = document.getElementById('mobile-stats-panel');
  if (!mobileStatsToggle || !mobileStatsPanel) return;
  safeAddEventListener(mobileStatsToggle, 'click', e => {
    e.stopPropagation();
    const hidden = mobileStatsPanel.classList.contains('hidden');
    mobileStatsPanel.classList.toggle('hidden');
    mobileStatsPanel.setAttribute('aria-hidden', String(!hidden));
    mobileStatsToggle.setAttribute('aria-expanded', String(hidden));
    const liveRegion = document.getElementById('a11y-announcements');
    if (liveRegion) {
      liveRegion.textContent = hidden
        ? 'Settings panel opened'
        : 'Settings panel closed';
    }
  });
  mobileStatsPanel.setAttribute('aria-hidden', 'true');
  mobileStatsToggle.setAttribute('aria-expanded', 'false');
}

function setupMobileFontControls() {
  const mobileFontUp = document.getElementById('mobile-font-up');
  const mobileFontDown = document.getElementById('mobile-font-down');
  if (mobileFontUp) {
    safeAddEventListener(mobileFontUp, 'click', () => {
      adjustFontSize(1);
    });
  }
  if (mobileFontDown) {
    safeAddEventListener(mobileFontDown, 'click', () => {
      adjustFontSize(-1);
    });
  }
}

function adjustFontSize(direction) {
  const sizes = ['text-sm', 'text-base', 'text-lg', 'text-xl'];
  if (direction === 0) {
    document.documentElement.classList.remove(...sizes);
    document.documentElement.classList.add('text-base');
    globalStore.fontSize = 'text-base';
    return;
  }
  let currentIndex = sizes.findIndex(size =>
    document.documentElement.classList.contains(size)
  );
  if (currentIndex === -1) currentIndex = 1;
  const newIndex = Math.max(0, Math.min(sizes.length - 1, currentIndex + direction));
  document.documentElement.classList.remove(...sizes);
  document.documentElement.classList.add(sizes[newIndex]);
  globalStore.fontSize = sizes[newIndex];
}

function initFontSizeControls() {
  const smallerBtn = document.getElementById('font-size-down');
  const biggerBtn = document.getElementById('font-size-up');
  const resetBtn = document.getElementById('font-size-reset');
  const storedSize = globalStore.fontSize;
  document.documentElement.classList.add(storedSize);
  if (smallerBtn) {
    safeAddEventListener(smallerBtn, 'click', () => {
      adjustFontSize(-1);
    });
  }
  if (biggerBtn) {
    safeAddEventListener(biggerBtn, 'click', () => {
      adjustFontSize(1);
    });
  }
  if (resetBtn) {
    safeAddEventListener(resetBtn, 'dblclick', () => {
      adjustFontSize(0);
    });
  }
}

export function syncMobileStats(stats) {
  const mobilePromptTokens = document.getElementById('mobile-prompt-tokens');
  const mobileCompletionTokens = document.getElementById('mobile-completion-tokens');
  const mobileTotalTokens = document.getElementById('mobile-total-tokens');
  const mobileTokensPerSecond = document.getElementById('mobile-tokens-per-second');
  if (mobilePromptTokens) mobilePromptTokens.textContent = stats.promptTokens || 0;
  if (mobileCompletionTokens) {
    mobileCompletionTokens.textContent = stats.completionTokens || 0;
  }
  if (mobileTotalTokens) mobileTotalTokens.textContent = stats.totalTokens || 0;
  if (mobileTokensPerSecond) {
    mobileTokensPerSecond.textContent = `${(stats.tokensPerSecond || 0).toFixed(1)} t/s`;
  }
}

function initConfigHandlers() {
  import('./config.js')
    .then(module => {
      if (typeof module.setupConfigEventHandlers === 'function') {
        module.setupConfigEventHandlers();
      } else {
        captureMessage('setupConfigEventHandlers function not found', 'error');
      }
    })
    .catch(err => {
      console.error('Failed to load config module:', err);
      captureError(err, { context: 'Config initialization' });
    });
}

function safeAddEventListener(element, eventType, handler, options = {}) {
  if (!element) return false;
  if (!element._eventHandlers) {
    element._eventHandlers = {};
  }
  const handlerKey = `${eventType}_${handler.name || 'anonymous'}`;
  if (element._eventHandlers[handlerKey]) {
    element.removeEventListener(
      eventType,
      element._eventHandlers[handlerKey].fn,
      element._eventHandlers[handlerKey].options
    );
  }
  element._eventHandlers[handlerKey] = {
    fn: handler,
    options
  };
  element.addEventListener(eventType, handler, options);
  return true;
}

function debounce(func, wait) {
  let timeout;
  return function () {
    const context = this;
    const args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(context, args);
    }, wait);
  };
}
