import { sendMessage } from './chat.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';
import { modelManager } from './models.js';
import { initThemeSwitcher } from './ui/themeSwitcher.js';
import { initTabSystem } from './ui/tabManager.js';
import { initSidebar } from './ui/sidebarManager.js';
import { configureMarkdown } from './ui/markdownParser.js';
import { loadConversationFromDb, loadOlderMessages } from './ui/displayManager.js';
import { StatsDisplay } from './ui/statsDisplay.js';
import fileManager from './fileManager.js';
import { showNotification } from './ui/notificationManager.js';
import { getSessionId, createNewConversation } from './session.js';
import { initSentry, captureError, captureMessage } from './sentryInit.js';

// Configure DOMPurify
if (typeof DOMPurify !== 'undefined') {
  DOMPurify.setConfig({
    ADD_TAGS: ['div', 'pre'],
    ADD_ATTR: ['class', 'aria-expanded'],
  });
}

// Disable service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      registration.unregister();
      console.log('Service worker unregistered');
    }
  });
}

// A single DOMContentLoaded to kick off the entire app
document.addEventListener('DOMContentLoaded', initApplication);

/**
 * Ensures a valid session exists before proceeding with app initialization
 * Handles 404 errors and other issues gracefully
 */
async function ensureValidSession() {
  try {
    // Start a Sentry transaction for session initialization
    const transaction = await import('./sentryInit.js').then(module => {
      return module.startTransaction('session_initialization', 'session');
    });
    
    // Get or create a session ID - this function handles validation internally
    // and will create a new session if the existing one is invalid
    const sessionId = await getSessionId();

    if (!sessionId) {
      console.warn('Failed to get a valid session ID');
      captureMessage('Failed to get a valid session ID', 'warning');

      // Try one more time with a fresh session
      sessionStorage.removeItem('sessionId');
      const newSessionId = await createNewConversation('New Conversation');

      if (!newSessionId) {
        // Show error notification but don't throw to allow the app to continue
        showNotification(
          'Unable to create a session. Some features may not work correctly.',
          'warning',
          10000,
          [{ label: 'Refresh', onClick: () => window.location.reload() }]
        );
        console.error('Failed to create a new session after multiple attempts');
        captureMessage('Failed to create a new session after multiple attempts', 'error');
      } else {
        console.log('Created new session after initial failure:', newSessionId);
        captureMessage('Created new session after initial failure', 'info', { sessionId: newSessionId });
      }
    } else {
      console.log('Session initialization successful:', sessionId);
      captureMessage('Session initialization successful', 'info', { sessionId });
    }
    
    // Finish the transaction
    if (transaction) {
      transaction.finish();
    }

    return sessionId;
  } catch (error) {
    // Log the error but don't throw - let the app continue
    console.error('Session initialization error:', error);
    captureError(error, { context: 'Session initialization' });

    // Show a non-blocking notification
    showNotification(
      'Error initializing session. Please refresh if you encounter problems.',
      'warning',
      10000,
      [{ label: 'Refresh', onClick: () => window.location.reload() }]
    );

    // Return null instead of throwing to allow app to continue
    return null;
  }
}

/**
 * Show fallback UI when initialization fails
 */
function showFallbackUI(error) {
  const container = document.getElementById('chat-container') || document.body;

  const errorElement = document.createElement('div');
  errorElement.className = 'error-message p-4 m-4 bg-red-50 text-red-700 rounded-md border border-red-200';
  errorElement.innerHTML = `
    <h3 class="text-lg font-semibold mb-2">Application Error</h3>
    <p>The application encountered an error during initialization.</p>
    <p class="mt-2 text-sm text-red-600">${error.message}</p>
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
  
  // Add error reporting button
  const reportButton = errorElement.querySelector('#report-error-btn');
  if (reportButton) {
    reportButton.addEventListener('click', () => {
      import('./sentryInit.js').then(module => {
        module.captureMessage('User manually reported error', 'error', { 
          error: error.toString(),
          stack: error.stack,
          location: window.location.href
        });
        
        // Show feedback to user
        reportButton.textContent = 'Error Reported';
        reportButton.disabled = true;
        reportButton.classList.add('opacity-50');
      });
    });
  }

  container.innerHTML = '';
  container.appendChild(errorElement);
}

/**
 * Main initialization entry point
 */
async function initApplication() {
  console.log('Initializing application...');

  try {
    // Initialize Sentry with Session Replay only if not already initialized
    // Using the isSentryInitialized flag from sentryInit.js to prevent multiple initializations
    if (typeof window.Sentry === 'undefined' || !window.Sentry._initialized) {
      initSentry({
        dsn: window.SENTRY_DSN || 'https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528',
        environment: window.SENTRY_ENVIRONMENT || 'development',
        release: window.SENTRY_RELEASE || '1.0.0',
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1, // Record 10% of sessions
        replaysOnErrorSampleRate: 1.0, // Record 100% of sessions with errors
        maskAllInputs: true, // Mask all input fields for privacy
      });
    } else {
      console.log('Sentry already initialized, skipping initialization in initApplication');
    }
    
    // Add initial breadcrumb
    captureMessage('Application initialization started', 'info');

    // Fix UI layout issues immediately
    fixLayoutIssues();

    // 1. Initialize theme switcher
    initThemeSwitcher();

    // 2. Initialize session FIRST before other components
    const sessionId = await ensureValidSession();
    
    // Set session ID as user ID for Sentry
    if (sessionId) {
      window.sentryUser = { id: sessionId };
      import('./sentryInit.js').then(module => {
        module.setUser(window.sentryUser);
        module.setTag('session_id', sessionId);
      });
    }

    // 3. Initialize tab system with proper handling
    initTabSystem();

    // 4. Initialize sidebar with corrected mobile/desktop behavior
    initSidebar();

    // 5. Initialize conversation manager (for sidebar)
    import('./ui/conversationManager.js').then(module => {
      module.initConversationManager();
    }).catch(err => {
      console.error('Failed to load conversationManager:', err);
      captureError(err, { context: 'Loading conversation manager' });
    });

    // 6. Initialize existing thinking blocks
    deepSeekProcessor.initializeExistingBlocks();

    // 7. Initialize stats display
    window.statsDisplay = new StatsDisplay('performance-stats');

    // 8. Initialize mobile or desktop features
    // Always run initMobileUI even on desktop so that all interactive elements have listeners
    initMobileUI();

    // 9. Additional UI init
    initPerformanceStats();
    configureMarkdown();
    initChatInterface();
    initUserInput();
    initConversationControls();
    initFontSizeControls();
    initTokenUsageDisplay();
    /* Removed initThinkingModeToggle call */
    enhanceAccessibility();
    detectTouchCapability();
    registerKeyboardShortcuts();
    initModelSelector();
    initConfigHandlers();

    // 10. Load conversation from database
    await loadConversationFromDb();
    maybeShowWelcomeMessage();

    // 11. Initialize model manager
    await modelManager.initialize();

    // 12. Set up window resize event listener for responsive UI
    setupResizeHandler();

    // Add completion breadcrumb
    captureMessage('Application initialization complete', 'info');
    console.log('Application initialization complete');
  } catch (error) {
    console.error('Initialization error:', error);
    captureError(error, { context: 'Application initialization' });
    showFallbackUI(error);
  }
}

/**
 * Fix layout issues by directly manipulating the DOM
 * This runs before any other initialization to ensure proper rendering
 */
function fixLayoutIssues() {
  console.log('Applying layout fixes...');

  // 1. Fix sidebar positioning
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    // Remove any transforms from HTML
    sidebar.classList.remove('translate-x-full', 'md:translate-x-0', 'translate-x-0');

    // Apply correct positioning and width
    const isMobile = window.innerWidth < 768;

    // Set fixed position with correct dimensions
    sidebar.style.position = 'fixed';
    sidebar.style.top = '64px';
    sidebar.style.bottom = '0';
    sidebar.style.right = '0';
    sidebar.style.zIndex = '50';
    sidebar.style.width = isMobile ? '100%' : '384px';
    if (!sidebar.classList.contains('sidebar-open')) {
        sidebar.style.transform = 'translateX(100%)';
    } else {
        sidebar.style.transform = 'translateX(0)';
    }
  }

  // 2. Fix tab panels display
  document.querySelectorAll('[role="tabpanel"]').forEach(panel => {
    panel.style.position = 'relative';
    panel.style.width = '100%';
    panel.style.height = 'auto';

    // Make sure active panel is visible, others are hidden
    const tabId = panel.id;
    const button = document.querySelector(`[data-target-tab="${tabId}"]`);
    if (button && button.getAttribute('aria-selected') === 'true') {
      panel.classList.remove('hidden');
      panel.setAttribute('aria-hidden', 'false');
    } else {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  });

  // 3. Fix overlay pointer events
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    overlay.style.pointerEvents = 'auto';
  }
}

/**
 * Set up a window resize event handler to maintain proper layout
 */
function setupResizeHandler() {
  const handleResize = debounce(() => {
    const isMobile = window.innerWidth < 768;
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const chatContainer = document.getElementById('chat-container');

    if (sidebar) {
      // Update sidebar dimensions based on viewport
      sidebar.style.width = isMobile ? '100%' : '384px';

      // Check if sidebar is open and update layout accordingly
      const isOpen = sidebar.classList.contains('sidebar-open');
      if (isOpen) {
        if (!isMobile && chatContainer) {
          chatContainer.classList.add('sidebar-open');
        } else if (chatContainer) {
          chatContainer.classList.remove('sidebar-open');
        }

        if (overlay) {
          overlay.classList.toggle('hidden', !isMobile);
        }
      }
    }

    // Re-apply tab panel fixes in case they were lost
    document.querySelectorAll('[role="tabpanel"]').forEach(panel => {
      if (panel.id) {
        const button = document.querySelector(`[data-target-tab="${panel.id}"]`);
        const shouldBeVisible = button && button.getAttribute('aria-selected') === 'true';
        panel.classList.toggle('hidden', !shouldBeVisible);
        panel.setAttribute('aria-hidden', String(!shouldBeVisible));

        // Ensure proper positioning
        panel.style.position = 'relative';
        panel.style.width = '100%';
      }
    });
  }, 250);

  window.addEventListener('resize', handleResize);
}

/* ------------------------------------------------------------------
                          INITIALIZATION HELPERS
   ------------------------------------------------------------------ */


/**
 * Initialize performance stats
 */
function initPerformanceStats() {
  try {
    // Only initialize once to avoid duplicate instances
    if (!window.statsDisplay) {
      window.statsDisplay = new StatsDisplay('performance-stats');
    }
  } catch (err) {
    console.error('Failed to initialize performance stats:', err);
  }
}

/**
 * Sets up the main chat interface
 */
function initChatInterface() {
  initErrorDisplay();
}

/**
 * Error display setup
 */
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

/**
 * Checks localStorage for a conversation; if not found, show welcome once
 */
function maybeShowWelcomeMessage() {
  const conversationExists =
    localStorage.getItem('conversation') &&
    JSON.parse(localStorage.getItem('conversation')).length > 0;
  const welcomeShown = sessionStorage.getItem('welcome_message_shown');

  if (!conversationExists && !welcomeShown) {
    showWelcomeMessage();
    sessionStorage.setItem('welcome_message_shown', 'true');
  }
}

/**
 * Renders a basic welcome message
 */
function showWelcomeMessage() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  const welcomeMessage = document.createElement('div');
  welcomeMessage.className =
    'mx-auto max-w-2xl text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-8';
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
}

/**
 * Sets up user input controls, conversation save/clear, and older messages
 */
function initUserInput() {
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  window.triggerSendMessage = function () {
    window.dispatchEvent(new CustomEvent('send-message'));
  };

  // Handle save conversation button
  const saveConvoBtn = document.getElementById('save-older-btn');
  if (saveConvoBtn) {
    safeAddEventListener(saveConvoBtn, 'click', async () => {
      try {
        // Add breadcrumb for user action
        import('./sentryInit.js').then(module => {
          module.addBreadcrumb({
            category: 'ui.action',
            message: 'User clicked save conversation button',
            level: 'info'
          });
        });
        
        const module = await import('./ui/displayManager.js');
        if (typeof module.saveConversation === 'function') {
          module.saveConversation();
        } else {
          console.error('saveConversation function not found');
          captureMessage('saveConversation function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to save conversation:', err);
        captureError(err, { context: 'Save conversation' });
      }
    });
  }

  // Handle clear conversation button
  const clearConvoBtn = document.getElementById('clear-convo-btn');
  if (clearConvoBtn) {
    safeAddEventListener(clearConvoBtn, 'click', async () => {
      try {
        // Add breadcrumb for user action
        import('./sentryInit.js').then(module => {
          module.addBreadcrumb({
            category: 'ui.action',
            message: 'User clicked clear conversation button',
            level: 'info'
          });
        });
        
        const module = await import('./ui/displayManager.js');
        if (typeof module.deleteConversation === 'function') {
          module.deleteConversation();
        } else {
          console.error('deleteConversation function not found');
          captureMessage('deleteConversation function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to clear conversation:', err);
        captureError(err, { context: 'Clear conversation' });
      }
    });
  }

  // Handle new conversation button
  const newConvoBtn = document.getElementById('new-convo-btn');
  if (newConvoBtn) {
    safeAddEventListener(newConvoBtn, 'click', async () => {
      try {
        // Add breadcrumb for user action
        import('./sentryInit.js').then(module => {
          module.addBreadcrumb({
            category: 'ui.action',
            message: 'User clicked new conversation button',
            level: 'info'
          });
        });
        
        const module = await import('./ui/displayManager.js');
        if (typeof module.createNewConversation === 'function') {
          module.createNewConversation();
        } else {
          console.error('createNewConversation function not found');
          captureMessage('createNewConversation function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to create new conversation:', err);
        captureError(err, { context: 'Create new conversation' });
      }
    });
  }

  // Handle load older messages button
  const loadOlderBtn = document.getElementById('load-older-btn');
  if (loadOlderBtn) {
    safeAddEventListener(loadOlderBtn, 'click', async () => {
      try {
        // Add breadcrumb for user action
        import('./sentryInit.js').then(module => {
          module.addBreadcrumb({
            category: 'ui.action',
            message: 'User clicked load older messages button',
            level: 'info'
          });
        });
        
        const module = await import('./ui/displayManager.js');
        if (typeof module.loadOlderMessages === 'function') {
          module.loadOlderMessages();
        } else {
          console.error('loadOlderMessages function not found');
          captureMessage('loadOlderMessages function not found', 'error');
        }
      } catch (err) {
        console.error('Failed to load older messages:', err);
        captureError(err, { context: 'Load older messages' });
      }
    });
  }

  // File reference links
  document.addEventListener('click', e => {
    const link = e.target.closest('.file-ref-link');
    if (link) {
      e.preventDefault();
      const fname = link.getAttribute('data-file-name');
      
      // Add breadcrumb for file reference click
      import('./sentryInit.js').then(module => {
        module.addBreadcrumb({
          category: 'ui.action',
          message: 'User clicked file reference link',
          data: { filename: fname },
          level: 'info'
        });
      });
      
      openFileInSidebar(fname);
    }
  });

  // Autosize the user input
  if (userInput && sendButton) {
    setTimeout(() => userInput.focus(), 100);

    // Add event listener for user input
    userInput.addEventListener('input', () => {
      const charCount = document.getElementById('char-count');
      if (charCount) {
        charCount.textContent = userInput.value.length;
      }

      // Auto-resize the textarea
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
    });

    // Add event listener for send button
    sendButton.addEventListener('click', () => {
      // Add breadcrumb for send message
      import('./sentryInit.js').then(module => {
        module.addBreadcrumb({
          category: 'ui.action',
          message: 'User clicked send message button',
          level: 'info'
        });
      });
      
      if (typeof sendMessage === 'function') {
        sendMessage();
      } else if (typeof window.sendMessage === 'function') {
        window.sendMessage();
      }
    });

    // Add event listener for Enter key
    userInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        
        // Add breadcrumb for keyboard shortcut
        import('./sentryInit.js').then(module => {
          module.addBreadcrumb({
            category: 'ui.action',
            message: 'User used Ctrl+Enter keyboard shortcut',
            level: 'info'
          });
        });
        
        if (typeof sendMessage === 'function') {
          sendMessage();
        } else if (typeof window.sendMessage === 'function') {
          window.sendMessage();
        }
      }
    });
  }
}

/**
 * Open a file in the sidebar
 */
function openFileInSidebar(filename) {
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar?.classList.contains('translate-x-full') || !sidebar?.classList.contains('sidebar-open')) {
      sidebarToggle.click();
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
}

/**
 * Conversation controls container
 */
function initConversationControls() {
  console.log('Initializing conversation control buttons...');

  // Make sure buttons are initialized with proper event handlers
  // This is already handled in initUserInput
}

/**
 * Initialize token usage display toggle
 */
function initTokenUsageDisplay() {
  const tokenUsage = document.getElementById('token-usage');
  const toggleButton = document.getElementById('token-usage-toggle');
  const tokenDetails = document.getElementById('token-details');
  const tokenChevron = document.getElementById('token-chevron');

  if (tokenUsage && toggleButton) {
    // Remove any existing event listeners to prevent duplicates
    safeAddEventListener(toggleButton, 'click', () => {
      if (tokenDetails) {
        tokenDetails.classList.toggle('hidden');
      }
      if (tokenChevron) {
        tokenChevron.classList.toggle('rotate-180');
      }
      localStorage.setItem('tokenDetailsVisible', !tokenDetails.classList.contains('hidden'));
    });

    // Check for stored preference
    const tokenDetailsVisible = localStorage.getItem('tokenDetailsVisible') === 'true';
    if (tokenDetailsVisible && tokenDetails) {
      tokenDetails.classList.remove('hidden');
      if (tokenChevron) {
        tokenChevron.classList.add('rotate-180');
      }
    }
  }
}

/**
 * Initialize the thinking mode toggle
 */
/* Removed the initThinkingModeToggle function and all references to enableThinkingMode */

/**
 * Register global keyboard shortcuts
 */
function registerKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ctrl/Cmd + Enter => Send
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const sendButton = document.getElementById('send-button');
      if (sendButton) sendButton.click();
    }
    // Esc => close sidebar on mobile
    if (e.key === 'Escape') {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('sidebar-open') && window.innerWidth < 768) {
        const sidebarToggle = document.getElementById('sidebar-toggle');
        if (sidebarToggle) sidebarToggle.click();
      }
    }
  });
}

/**
 * Additional ARIA enhancements
 */
function enhanceAccessibility() {
  const liveRegion = document.createElement('div');
  liveRegion.id = 'a11y-announcements';
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(liveRegion);

  // Provide default aria-label to unlabeled buttons with no text
  document.querySelectorAll('button:not([aria-label])').forEach(button => {
    if (!button.textContent.trim()) {
      button.setAttribute('aria-label', 'Button');
    }
  });
}

/**
 * Detects if device is a touch device; sets default mobile font sizing
 */
function detectTouchCapability() {
  const isTouchDevice =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    navigator.msMaxTouchPoints > 0;

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

/**
 * Model selector initialization
 */
function initModelSelector() {
  const modelSelect = document.getElementById('model-select');
  if (!modelSelect) return;

  // Load default models
  import('./models.js').then(module => {
    const { modelManager } = module;

    // Make sure the local model configs are created first before trying to use them
    modelManager.ensureLocalModelConfigs();
    console.log("Local model configs initialized:", Object.keys(modelManager.modelConfigs));

    // Add with a slight delay to ensure model configs are fully processed
    setTimeout(() => {
      if (modelSelect.options.length === 0) {
        const models = modelManager.modelConfigs;
        if (Object.keys(models).length > 0) {
          modelSelect.innerHTML = '';
          for (const [id, config] of Object.entries(models)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = `${id}${config.description ? ` (${config.description})` : ''}`;
            modelSelect.appendChild(option);
          }

          // Default to DeepSeek-R1 if available, otherwise fall back to o1
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
  });

  // Asynchronously initialize the model manager
  setTimeout(() => {
    import('./models.js')
      .then(module => {
        const { modelManager } = module;
        // Ensure model configs exist
        if (Object.keys(modelManager.modelConfigs).length === 0) {
          modelManager.ensureLocalModelConfigs();
        }

        // Initialize model manager
        modelManager.initialize()
          .then(() => {
            console.log("Model manager initialized with models:", Object.keys(modelManager.modelConfigs));

            // Initialize model management UI
            modelManager.initModelManagement();

            // Force refresh models list
            modelManager.refreshModelsList();
          })
          .catch(err => console.error('Error initializing ModelManager:', err));
      })
      .catch(err => console.error('Failed to load models.js:', err));
  }, 1000);
}

/* ------------------------------------------------------------------
                      MOBILE-SPECIFIC FUNCTIONS
   ------------------------------------------------------------------ */

/**
 * Initialize all mobile-specific UI features
 */
function initMobileUI() {
  console.log('Initializing mobile features...');
  initDoubleTapToCopy();
  initPullToRefresh();
  setupMobileStatsToggle();
  setupMobileFontControls();
}

/**
 * Double-tap to copy for assistant messages
 */
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
          
          // Add breadcrumb for copy action
          import('./sentryInit.js').then(module => {
            module.addBreadcrumb({
              category: 'ui.action',
              message: 'User double-tapped to copy message',
              level: 'info'
            });
          });
        });
        e.preventDefault();
      }
      lastTap = currentTime;
      lastElement = messageDiv;
    },
    { passive: false }
  );
}

/**
 * Mobile "pull-to-refresh" for loading older messages
 */
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
        chatHistory.style.setProperty('--pull-distance', `${Math.min(
          pullDistance / 2,
          threshold
        )}px`);
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
        
        // Add breadcrumb for pull-to-refresh action
        import('./sentryInit.js').then(module => {
          module.addBreadcrumb({
            category: 'ui.action',
            message: 'User pulled to refresh messages',
            level: 'info'
          });
        });

        // Load older messages
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

/**
 * Toggles the stats panel in mobile view
 */
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

    if ('vibrate' in navigator) navigator.vibrate(10);

    const liveRegion = document.getElementById('a11y-announcements');
    if (liveRegion) {
      liveRegion.textContent = hidden
        ? 'Settings panel opened'
        : 'Settings panel closed';
    }
    
    // Add breadcrumb for stats toggle
    import('./sentryInit.js').then(module => {
      module.addBreadcrumb({
        category: 'ui.action',
        message: `User ${hidden ? 'opened' : 'closed'} mobile stats panel`,
        level: 'info'
      });
    });
  });

  mobileStatsPanel.setAttribute('aria-hidden', 'true');
  mobileStatsToggle.setAttribute('aria-expanded', 'false');
}

/**
 * Controls for changing font size on mobile
 */
function setupMobileFontControls() {
  const mobileFontUp = document.getElementById('mobile-font-up');
  const mobileFontDown = document.getElementById('mobile-font-down');

  if (mobileFontUp) {
    safeAddEventListener(mobileFontUp, 'click', () => {
      adjustFontSize(1);
      // Add breadcrumb for font size change
      import('./sentryInit.js').then(module => {
        module.addBreadcrumb({
          category: 'ui.action',
          message: 'User increased font size on mobile',
          level: 'info'
        });
      });
    });
  }

  if (mobileFontDown) {
    safeAddEventListener(mobileFontDown, 'click', () => {
      adjustFontSize(-1);
      // Add breadcrumb for font size change
      import('./sentryInit.js').then(module => {
        module.addBreadcrumb({
          category: 'ui.action',
          message: 'User decreased font size on mobile',
          level: 'info'
        });
      });
    });
  }
}

/* ------------------------------------------------------------------
                  SHARED FONT-SIZE ADJUSTMENT LOGIC
   ------------------------------------------------------------------ */

/**
 * Adjust font size of the document
 * @param {number} direction - 1 to increase, -1 to decrease, 0 to reset
 */
function adjustFontSize(direction) {
  const sizes = ['text-sm', 'text-base', 'text-lg', 'text-xl'];

  // Handle reset
  if (direction === 0) {
    document.documentElement.classList.remove(...sizes);
    document.documentElement.classList.add('text-base');
    localStorage.removeItem('fontSize');
    return;
  }

  // Find current size
  let currentIndex = sizes.findIndex(size =>
    document.documentElement.classList.contains(size)
  );
  if (currentIndex === -1) currentIndex = 1; // default to text-base

  // Calculate new index within bounds
  const newIndex = Math.max(0, Math.min(sizes.length - 1, currentIndex + direction));

  // Apply new size
  document.documentElement.classList.remove(...sizes);
  document.documentElement.classList.add(sizes[newIndex]);
  localStorage.setItem('fontSize', sizes[newIndex]);
}

/**
 * Set up "increase"/"decrease" font size controls (desktop)
 */
function initFontSizeControls() {
  const smallerBtn = document.getElementById('font-size-down');
  const biggerBtn = document.getElementById('font-size-up');
  const resetBtn = document.getElementById('font-size-reset');

  // Apply stored font size
  const storedSize = localStorage.getItem('fontSize') || 'text-base';
  document.documentElement.classList.add(storedSize);

  if (smallerBtn) {
    safeAddEventListener(smallerBtn, 'click', () => {
      adjustFontSize(-1);
      // Add breadcrumb for font size change
      import('./sentryInit.js').then(module => {
        module.addBreadcrumb({
          category: 'ui.action',
          message: 'User decreased font size',
          level: 'info'
        });
      });
    });
  }

  if (biggerBtn) {
    safeAddEventListener(biggerBtn, 'click', () => {
      adjustFontSize(1);
      // Add breadcrumb for font size change
      import('./sentryInit.js').then(module => {
        module.addBreadcrumb({
          category: 'ui.action',
          message: 'User increased font size',
          level: 'info'
        });
      });
    });
  }

  if (resetBtn) {
    safeAddEventListener(resetBtn, 'dblclick', () => {
      adjustFontSize(0);
      // Add breadcrumb for font size reset
      import('./sentryInit.js').then(module => {
        module.addBreadcrumb({
          category: 'ui.action',
          message: 'User reset font size',
          level: 'info'
        });
      });
    });
  }
}

/* ------------------------------------------------------------------
                  EXPORTED MOBILE STATS SYNC FUNCTION
   ------------------------------------------------------------------ */

/**
 * Sync stats on mobile displays
 */
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

/**
 * Initialize config form event handlers
 */
function initConfigHandlers() {
  // Import the config module and call setupConfigEventHandlers
  import('./config.js')
    .then(module => {
      if (typeof module.setupConfigEventHandlers === 'function') {
        module.setupConfigEventHandlers();
      } else {
        console.error('setupConfigEventHandlers function not found in config.js');
        captureMessage('setupConfigEventHandlers function not found', 'error');
      }
    })
    .catch(err => {
      console.error('Failed to load config module:', err);
      captureError(err, { context: 'Config initialization' });
    });
}

/**
 * Safely add event listener ensuring no duplicates
 * @param {Element} element - DOM element to attach listener to
 * @param {string} eventType - Event type (e.g., 'click')
 * @param {Function} handler - Event handler function
 * @param {Object} options - addEventListener options
 */
function safeAddEventListener(element, eventType, handler, options = {}) {
  if (!element) return false;

  // Store event handlers on the element
  if (!element._eventHandlers) {
    element._eventHandlers = {};
  }

  // Create a unique key for this handler
  const handlerKey = `${eventType}_${handler.name || 'anonymous'}`;

  // If handler with this key exists, remove it first
  if (element._eventHandlers[handlerKey]) {
    element.removeEventListener(
      eventType,
      element._eventHandlers[handlerKey].fn,
      element._eventHandlers[handlerKey].options
    );
  }

  // Store reference to handler
  element._eventHandlers[handlerKey] = {
    fn: handler,
    options
  };

  // Add the event listener
  element.addEventListener(eventType, handler, options);
  return true;
}

/**
 * Simple debounce function to prevent excessive function calls
 * @param {Function} func - The function to debounce
 * @param {number} wait - Debounce wait time in milliseconds
 */
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
