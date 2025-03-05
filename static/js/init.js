import { sendMessage } from './chat.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';
import { initThemeSwitcher } from './ui/themeSwitcher.js';
import { initTabSystem } from './ui/tabManager.js';
import { initSidebar } from './ui/sidebarManager.js';
import { configureMarkdown } from './ui/markdownParser.js';
import { loadConversationFromDb, loadOlderMessages } from './ui/displayManager.js';
import StatsDisplay from './ui/statsDisplay.js';
import fileManager from './fileManager.js';

// Configure DOMPurify
DOMPurify.setConfig({
  ADD_TAGS: ['div', 'pre'],
  ADD_ATTR: ['class', 'aria-expanded'],
});

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
 * Main initialization entry point
 */
function initApplication() {
  console.log('Initializing application...');

  // 1. Initialize theme switcher
  try {
    initThemeSwitcher();
  } catch (err) {
    console.error('Failed to initialize theme switcher:', err);
  }

  // 2. Initialize tab system
  try {
    initTabSystem();
  } catch (err) {
    console.error('Failed to initialize tab system:', err);
  }

  // 3. Initialize sidebar
  try {
    initSidebar();
  } catch (err) {
    console.error('Failed to initialize sidebar:', err);
  }

  // 4. Initialize existing thinking blocks
  try {
    deepSeekProcessor.initializeExistingBlocks();
  } catch (err) {
    console.error('Failed to initialize thinking blocks:', err);
  }

  // 5. Initialize stats display
  try {
    window.statsDisplay = new StatsDisplay('performance-stats');
  } catch (err) {
    console.error('Failed to initialize stats display:', err);
  }

  // 6. Initialize mobile or desktop features
  // Always run initMobileUI even on desktop so that all interactive elements have listeners
  initMobileUI();

  // 7. Additional UI init
  initPerformanceStats();
  configureMarkdown();
  initChatInterface();
  initUserInput();
  initConversationControls();
  initFontSizeControls();
  initTokenUsageDisplay();
  initThinkingModeToggle();
  enhanceAccessibility();
  detectTouchCapability();
  registerKeyboardShortcuts();
  initModelSelector();
  initConfigHandlers();

  // 8. Load conversation from local storage, show welcome message if needed
  loadConversationFromDb();
  maybeShowWelcomeMessage();

  console.log('Application initialization complete');
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

  const saveConvoBtn = document.getElementById('save-convo-btn');
  const clearConvoBtn = document.getElementById('clear-convo-btn');
  const convoList = document.getElementById('conversation-list');
  const loadOlderBtn = document.getElementById('load-older-btn');

  // Save conversation
  if (saveConvoBtn) {
    saveConvoBtn.addEventListener('click', () => {
      // Use the DB-based saveConversation from displayManager
      import('./ui/displayManager.js')
        .then(module => {
          const { saveConversation } = module;
          saveConversation();
        })
        .catch(err => console.error('Failed to load displayManager:', err));
    });
  }

  // Clear conversation
  if (clearConvoBtn) {
    clearConvoBtn.addEventListener('click', () => {
      // Call the DB-based clearConversation from displayManager
      import('./ui/displayManager.js')
        .then(module => {
          const { deleteConversation } = module;
          deleteConversation();
        })
        .catch(err => console.error('Failed to load displayManager:', err));
    });
  }

  // The local "conversation list" is not needed for DB-based approach.
  // Hide or remove the conversation dropdown logic.
  if (convoList) {
    convoList.classList.add('hidden');
  }

  // Load older messages
  if (loadOlderBtn) {
    loadOlderBtn.addEventListener('click', () => {
      // Use the DB-based loadOlderMessages
      import('./ui/displayManager.js')
        .then(module => {
          const { loadOlderMessages } = module;
          loadOlderMessages();
        })
        .catch(err => console.error('Failed to load displayManager:', err));
    });
  }

  // File reference links
  document.addEventListener('click', e => {
    const link = e.target.closest('.file-ref-link');
    if (link) {
      e.preventDefault();
      const fname = link.getAttribute('data-file-name');
      openFileInSidebar(fname);
    }
  });

  // Autosize the user input
  if (userInput && sendButton) {
    setTimeout(() => userInput.focus(), 100);
  }
}

/**
 * Refreshes the <select> of saved conversations
 */
function refreshConversationList() {
  const convoList = document.getElementById('conversation-list');
  if (!convoList) return;

  convoList.innerHTML = '<option value="">-- Select --</option>';
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('conversation_')) {
      const option = document.createElement('option');
      option.value = k;
      option.textContent = k
        .replace('conversation_', '')
        .replace(/_/g, ' ');
      convoList.appendChild(option);
    }
  }
}

/**
 * Open a file in the sidebar
 */
function openFileInSidebar(filename) {
  const toggleButton = document.querySelector(
    '[aria-controls="config-content files-content"]'
  );
  if (toggleButton) toggleButton.click();

  const filesTab = document.getElementById('files-tab');
  if (filesTab) filesTab.click();

  const fileManagerList = document.querySelector(
    '.file-drop-area + .space-y-2'
  );
  if (!fileManagerList) return;

  const fileItem = [...fileManagerList.children].find(c =>
    c?.getAttribute('aria-label')?.includes(filename)
  );
  if (fileItem) {
    fileItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fileItem.classList.add('bg-yellow-50', 'transition-colors');
    setTimeout(() => fileItem.classList.remove('bg-yellow-50'), 1200);
  }
}

/**
 * Conversation controls container
 */
function initConversationControls() {
  // Instead of creating duplicative buttons, we'll ensure the existing HTML buttons work properly
  console.log('Initializing conversation control buttons...');

  // Get references to existing buttons in index.html
  const loadOlderBtn = document.getElementById('load-older-btn');
  const saveOlderBtn = document.getElementById('save-older-btn');

  // Set up event handler for the Load Older Messages button
  if (loadOlderBtn) {
    // Remove any existing click handlers to prevent duplicates
    loadOlderBtn.replaceWith(loadOlderBtn.cloneNode(true));
    const newLoadOlderBtn = document.getElementById('load-older-btn');
    
    newLoadOlderBtn.addEventListener('click', async () => {
      console.log('Load Older Messages clicked');
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.loadOlderMessages === 'function') {
          module.loadOlderMessages();
        } else {
          console.error('loadOlderMessages function not found');
        }
      } catch (err) {
        console.error('Failed to load older messages:', err);
      }
    });
    
    // Make sure it's visible
    newLoadOlderBtn.classList.remove('hidden');
  } else {
    console.warn('Load Older Messages button not found in the DOM');
  }

  // Set up event handler for the Save Conversation button
  if (saveOlderBtn) {
    // Remove any existing click handlers to prevent duplicates
    saveOlderBtn.replaceWith(saveOlderBtn.cloneNode(true));
    const newSaveOlderBtn = document.getElementById('save-older-btn');
    
    newSaveOlderBtn.addEventListener('click', async () => {
      console.log('Save Conversation clicked');
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.saveConversation === 'function') {
          module.saveConversation();
        } else {
          console.error('saveConversation function not found');
        }
      } catch (err) {
        console.error('Failed to save conversation:', err);
      }
    });
    
    // Make sure it's visible
    newSaveOlderBtn.classList.remove('hidden');
  } else {
    console.warn('Save Conversation button not found in the DOM');
  }

  // Add clear and new conversation buttons programmatically
  addConversationManagementButtons();
}

/**
 * Adds Clear and New Conversation buttons to the UI
 */
function addConversationManagementButtons() {
  const btnContainer = document.querySelector('.flex.justify-center.items-center.gap-2.py-2.px-4');
  if (!btnContainer) {
    console.warn('Button container not found');
    return;
  }

  // Create Clear Conversation button if it doesn't exist
  if (!document.getElementById('clear-convo-btn')) {
    const clearConvoBtn = document.createElement('button');
    clearConvoBtn.id = 'clear-convo-btn';
    clearConvoBtn.className = 'btn btn-danger conversation-button';
    clearConvoBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v10M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
      </svg>
      Clear Conversation
    `;
    btnContainer.appendChild(clearConvoBtn);
    
    clearConvoBtn.addEventListener('click', async () => {
      console.log('Clear Conversation clicked');
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.deleteConversation === 'function') {
          module.deleteConversation();
        }
      } catch (err) {
        console.error('Failed to clear conversation:', err);
      }
    });
  }

  // Create New Conversation button if it doesn't exist
  if (!document.getElementById('new-convo-btn')) {
    const newConvoBtn = document.createElement('button');
    newConvoBtn.id = 'new-convo-btn';
    newConvoBtn.className = 'btn btn-primary conversation-button';
    newConvoBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      New Conversation
    `;
    btnContainer.appendChild(newConvoBtn);
    
    newConvoBtn.addEventListener('click', async () => {
      console.log('New Conversation clicked');
      try {
        const module = await import('./ui/displayManager.js');
        if (typeof module.createNewConversation === 'function') {
          module.createNewConversation();
        }
      } catch (err) {
        console.error('Failed to create new conversation:', err);
      }
    });
  }
}

/**
 * Initialize token usage display toggle
 */
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

/**
 * Initialize the thinking mode toggle
 */
function initThinkingModeToggle() {
  const thinkingModeToggle = document.getElementById('enable-thinking-mode');
  if (thinkingModeToggle) {
    // Check if previously enabled
    const thinkingModeEnabled = localStorage.getItem('enableThinkingMode') === 'true';
    thinkingModeToggle.checked = thinkingModeEnabled;
    
    // Set up event listener to save preference
    thinkingModeToggle.addEventListener('change', e => {
      localStorage.setItem('enableThinkingMode', e.target.checked);
      console.log('Thinking mode ' + (e.target.checked ? 'enabled' : 'disabled'));
      
      // Show notification about change
      import('./ui/notificationManager.js').then(module => {
        module.showNotification(
          `Thinking mode ${e.target.checked ? 'enabled' : 'disabled'}. This affects DeepSeek models only.`,
          'info',
          3000
        );
      });
    });
  }
}

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

  // Watch for future changes if needed
  const observer = new MutationObserver(() => {
    // If you want to handle UI changes to the model select, add logic here
  });
  observer.observe(modelSelect, { childList: true });

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
            option.textContent = `${id}${
              config.description ? ` (${config.description})` : ''
            }`;
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

  // Asynchronously initialize the model manager (after ensuring models exist)
  setTimeout(() => {
    import('./models.js')
      .then(module => {
        const { modelManager } = module;
        // Make sure configs are populated
        if (Object.keys(modelManager.modelConfigs).length === 0) {
          console.log("Re-ensuring model configs before initialize");
          modelManager.ensureLocalModelConfigs();
        }
        
        // Then initialize
        modelManager
          .initialize()
          .then(() => {
            console.log("Model manager initialized with models:", Object.keys(modelManager.modelConfigs));
            
            // Ensure we still have models in the dropdown
            if (modelSelect && modelSelect.options.length === 0) {
              const defaultModels = [
                {
                  id: 'o1',
                  description: 'Advanced reasoning model for complex tasks',
                },
                {
                  id: 'DeepSeek-R1',
                  description: 'Model that supports chain-of-thought reasoning',
                },
              ];
              defaultModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = `${model.id} (${model.description})`;
                modelSelect.appendChild(option);
              });
            }
            
            // Explicitly initialize model management UI
            modelManager.initModelManagement();
            // Force refresh the models list
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
  // Mobile sidebar handling is now in sidebarManager.js
  // Additional mobile logic if needed
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

  mobileStatsToggle.addEventListener('click', e => {
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
  const fontToggle = document.getElementById('mobile-font-toggle');
  const mobileStatsPanel = document.getElementById('mobile-stats-panel');

  if (mobileFontUp) {
    mobileFontUp.addEventListener('click', () => adjustFontSize(1));
  }
  if (mobileFontDown) {
    mobileFontDown.addEventListener('click', () => adjustFontSize(-1));
  }
  if (fontToggle && mobileStatsPanel) {
    fontToggle.addEventListener('click', () => {
      mobileStatsPanel.classList.toggle('hidden');
      if (!mobileStatsPanel.classList.contains('hidden') && mobileFontUp) {
        setTimeout(() => mobileFontUp.focus(), 100);
      }
    });
  }
}

// Mobile sidebar functionality moved to sidebarManager.js

/* ------------------------------------------------------------------
                  SHARED FONT-SIZE ADJUSTMENT LOGIC
   ------------------------------------------------------------------ */

/**
 * Adjust font size of the document
 * @param {number} direction - 1 to increase, -1 to decrease
 */
function adjustFontSize(direction) {
  const sizes = ['text-sm', 'text-base', 'text-lg', 'text-xl'];

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
  if (!smallerBtn || !biggerBtn) return;

  const storedSize = localStorage.getItem('fontSize') || 'text-base';
  document.documentElement.classList.add(storedSize);

  smallerBtn.addEventListener('click', () => adjustFontSize(-1));
  biggerBtn.addEventListener('click', () => adjustFontSize(1));
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
      }
    })
    .catch(err => console.error('Failed to load config module:', err));
}

/**
 * For possible future use from UI
 */
function initSettingsButton() {
  const settingsButton = document.getElementById('settings-button');
  if (!settingsButton) return;
  settingsButton.addEventListener('click', () => {
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) {
      settingsPanel.classList.toggle('hidden');
    }
  });
}
