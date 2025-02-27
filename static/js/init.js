import { sendMessage } from './chat.js';

// init.js - Application initialization
// Imports all necessary modules and bootstraps the application with Tailwind CSS

import { initThemeSwitcher } from './ui/themeSwitcher.js';
import { initTabSystem } from './ui/tabManager.js';
import { configureMarkdown } from './ui/markdownParser.js';
import { loadConversationFromLocalStorage, loadOlderMessages } from './ui/displayManager.js';
import StatsDisplay from './ui/statsDisplay.js';
import fileManager from './fileManager.js';
import { initializeConfig } from './config.js';

/**
 * Initialize the application when the DOM is fully loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing Azure OpenAI Chat application...');
  
  // Add special checks for model dropdown
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    console.log(`Initial model dropdown options: ${modelSelect.options.length}`);
    
    // Add event listener to report when options change
    const observer = new MutationObserver((mutations) => {
      console.log(`Model dropdown options changed: ${modelSelect.options.length}`);
    });
    
    observer.observe(modelSelect, {childList: true});
    
    // Force check if model dropdown is empty after 2 seconds
    setTimeout(() => {
      if (modelSelect.options.length === 0) {
        console.warn('Model dropdown is still empty after 2 seconds, forcing population');
        import('./models.js').then(module => {
          const { modelManager } = module;
          // Force repopulation of model dropdown
          modelManager.ensureLocalModelConfigs();
          
          // Manually populate dropdown if still empty
          const models = modelManager.modelConfigs;
          if (Object.keys(models).length > 0 && modelSelect.options.length === 0) {
            console.log('Manually populating model dropdown with:', Object.keys(models));
            
            // Clear dropdown first
            modelSelect.innerHTML = '';
            
            // Add each model as an option
            for (const [id, config] of Object.entries(models)) {
              const option = document.createElement('option');
              option.value = id;
              option.textContent = `${id}${config.description ? ` (${config.description})` : ''}`;
              modelSelect.appendChild(option);
            }
            
            // Set a default selection if possible
            if (models["DeepSeek-R1"]) {
              modelSelect.value = "DeepSeek-R1";
              modelManager.updateModelSpecificUI("DeepSeek-R1");
            } else if (models["o1hp"]) {
              modelSelect.value = "o1hp";
              modelManager.updateModelSpecificUI("o1hp");
            }
          }
        });
      }
    }, 2000);
  }
  
  // Initialize the model manager early
  import('./models.js').then(module => {
    const { modelManager } = module;
    modelManager.initialize().then(() => {
      console.log('ModelManager initialized successfully');
      
      // Force populate the model dropdown
      const modelSelect = document.getElementById('model-select');
      if (modelSelect && modelSelect.options.length === 0) {
        console.log('Manually populating model dropdown');
        
        // Add default options if the dropdown is empty
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
    }).catch(err => {
      console.error('Error initializing ModelManager:', err);
    });
  });
  
  initThemeSwitcher();
  
  // Initialize the sidebar tab system
  initTabSystem();
  
  // Configure markdown parser for chat messages
  configureMarkdown();
  
  // Initialize performance stats display
  initPerformanceStats();
  
  // Load previous conversation if it exists
  loadConversationFromLocalStorage();
  
  // Initialize chat interface
  initChatInterface();
  
  // Initialize user input handling
  initUserInput();
  
  // Initialize token usage display
  initTokenUsageDisplay();
  
  // Add keyboard shortcuts
  registerKeyboardShortcuts();
  
  // Add accessibility features
  enhanceAccessibility();
  
  // Initialize font size controls
  initializeFontSizeControls();
  
  // Initialize mobile UI enhancements
  initMobileUI();
  
  // Initialize app configuration
  initializeConfig().catch(err => {
    console.error('Error during config initialization:', err);
  });

  console.log('Application initialization complete');
});

/**
 * Initialize mobile-specific enhancements
 */
function initMobileUI() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  if (isMobile) {
    // Apply mobile-specific classes
    document.documentElement.classList.add('mobile-view');
    
    // Initialize mobile stats panel
    const statsToggle = document.getElementById('mobile-stats-toggle');
    const statsPanel = document.getElementById('mobile-stats-panel');
    
    if (statsToggle && statsPanel) {
      statsToggle.addEventListener('click', () => {
        statsPanel.classList.toggle('hidden');
      });
    }
    
    // Link desktop and mobile font controls
    const mobileFontUp = document.getElementById('mobile-font-up');
    const mobileFontDown = document.getElementById('mobile-font-down');
    
    if (mobileFontUp && mobileFontDown) {
      mobileFontUp.addEventListener('click', () => adjustFontSize(1));
      mobileFontDown.addEventListener('click', () => adjustFontSize(-1));
    }
    
    // Initialize mobile font toggle
    const fontToggle = document.getElementById('mobile-font-toggle');
    if (fontToggle && statsPanel) {
      fontToggle.addEventListener('click', () => {
        statsPanel.classList.toggle('hidden');
        // Focus on font controls
        if (!statsPanel.classList.contains('hidden') && mobileFontUp) {
          setTimeout(() => mobileFontUp.focus(), 100);
        }
      });
    }
    
    // Enhanced sidebar controls for mobile
    initMobileSidebar();
    
    // Add double-tap to copy for messages
    initDoubleTapToCopy();
    
    // Add pull-to-refresh for loading older messages
    initPullToRefresh();
  }
}

/**
 * Initialize double-tap to copy functionality for messages
 */
function initDoubleTapToCopy() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  
  let lastTap = 0;
  let lastElement = null;
  
  chatHistory.addEventListener('touchend', (e) => {
    const messageDiv = e.target.closest('.assistant-message');
    if (!messageDiv) return;
    
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    
    if (tapLength < 500 && lastElement === messageDiv) {
      // Double tap detected
      const content = messageDiv.textContent;
      navigator.clipboard.writeText(content)
        .then(() => {
          // Show feedback
          const feedback = document.createElement('div');
          feedback.className = 'fixed top-4 right-4 bg-black/70 text-white py-2 px-4 rounded-md z-50';
          feedback.textContent = 'Copied to clipboard';
          document.body.appendChild(feedback);
          
          setTimeout(() => {
            feedback.remove();
          }, 1500);
        })
        .catch(err => console.error('Could not copy text: ', err));
      
      e.preventDefault();
    }
    
    lastTap = currentTime;
    lastElement = messageDiv;
  }, { passive: false });
}

/**
 * Initialize pull-to-refresh for loading older messages
 */
function initPullToRefresh() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory || typeof window.loadOlderMessages !== 'function') return;
  
  let startY = 0;
  let isPulling = false;
  const threshold = 80;
  let indicator;
  
  chatHistory.addEventListener('touchstart', (e) => {
    // Only activate when at top of chat
    if (chatHistory.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });
  
  chatHistory.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    
    const currentY = e.touches[0].clientY;
    const pullDistance = currentY - startY;
    
    if (pullDistance > 0 && chatHistory.scrollTop <= 0) {
      // Prevent default scrolling behavior
      e.preventDefault();
      
      // Apply a transform to show visual feedback
      chatHistory.style.transform = `translateY(${Math.min(pullDistance / 2, threshold)}px)`;
      
      // Show/update pull indicator
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'text-center text-gray-500 absolute top-0 left-0 right-0 z-10 py-2 bg-gray-100/80 dark:bg-gray-800/80 backdrop-blur-sm';
        indicator.textContent = 'Pull to load older messages';
        chatHistory.parentNode.prepend(indicator);
      }
      
      if (pullDistance > threshold) {
        indicator.textContent = 'Release to load older messages';
      } else {
        indicator.textContent = 'Pull to load older messages';
      }
    }
  }, { passive: false });
  
  chatHistory.addEventListener('touchend', (e) => {
    if (!isPulling) return;
    
    const currentY = e.changedTouches[0].clientY;
    const pullDistance = currentY - startY;
    
    // Reset the transform
    chatHistory.style.transform = '';
    
    if (pullDistance > threshold && chatHistory.scrollTop <= 0) {
      // Show loading indicator
      if (indicator) {
        indicator.textContent = 'Loading...';
      }
      
      // Load older messages
      window.loadOlderMessages();
    }
    
    // Remove indicator after animation
    setTimeout(() => {
      if (indicator) {
        indicator.remove();
        indicator = null;
      }
    }, 300);
    
    isPulling = false;
  }, { passive: true });
}

/**
 * Initialize enhanced mobile sidebar handling
 */
function initMobileSidebar() {
  // This is now handled in tabManager.js
}

/**
 * Update stats on both desktop and mobile elements
 */
function syncMobileStats(stats) {
  // Update mobile stat elements
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
  
  // Apply stored size at startup
  const storedSize = localStorage.getItem('fontSize') || 'text-base';
  document.documentElement.classList.add(storedSize);

  smallerBtn.addEventListener('click', () => adjustFontSize(-1));
  biggerBtn.addEventListener('click', () => adjustFontSize(1));
}

function adjustFontSize(direction) {
  const sizes = ['text-sm', 'text-base', 'text-lg', 'text-xl'];
  let currentIndex = sizes.findIndex(sz =>
    document.documentElement.classList.contains(sz)
  );
  if (currentIndex === -1) currentIndex = 1;
  
  const newIndex = Math.min(
    Math.max(currentIndex + direction, 0),
    sizes.length - 1
  );

  document.documentElement.classList.remove(...sizes);
  document.documentElement.classList.add(sizes[newIndex]);
  localStorage.setItem('fontSize', sizes[newIndex]);
}

/**
 * Initialize the performance stats display
 */
function initPerformanceStats() {
  const statsDisplay = new StatsDisplay('performance-stats');
  window.statsDisplay = statsDisplay; // Make available globally for updates
  
  // Show initial mock stats
  statsDisplay.updateStats({
    latency: 0,
    tokensPerSecond: 0,
    activeConnections: 0,
    totalTokens: 0
  });
}

/**
 * Initialize the chat interface
 */
function initChatInterface() {
  // Initialize error handling
  initErrorDisplay();
  
  // Show welcome message if no conversation exists and it hasn't been shown yet
  const conversationExists = localStorage.getItem('conversation') && 
    JSON.parse(localStorage.getItem('conversation')).length > 0;
  const welcomeShown = sessionStorage.getItem('welcome_message_shown');
    
  if (!conversationExists && !welcomeShown) {
    showWelcomeMessage();
    sessionStorage.setItem('welcome_message_shown', 'true');
  }
}

/**
 * Initialize error display with dismiss functionality
 */
function initErrorDisplay() {
  const errorDisplay = document.getElementById('error-display');
  const dismissButton = errorDisplay?.querySelector('button');
  
  if (dismissButton) {
    dismissButton.addEventListener('click', () => {
      errorDisplay.classList.add('hidden');
    });
  }
}

/**
 * Show welcome message
 */
function showWelcomeMessage() {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  
  // Check if welcome message has already been shown this session
  if (sessionStorage.getItem('welcome_message_shown') === 'true') {
    console.log('Welcome message already shown in this session');
    return;
  }
  
  const welcomeMessage = document.createElement('div');
  welcomeMessage.className = 'mx-auto max-w-2xl text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-8';
  welcomeMessage.innerHTML = `
    <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">Welcome to Azure OpenAI Chat</h2>
    <p class="text-gray-600 dark:text-gray-300 mb-4">
      This chat application uses Azure OpenAI's powerful language models to provide
      intelligent responses to your questions and requests.
    </p>
    <p class="text-gray-600 dark:text-gray-300">
      Type a message below to get started!
    </p>
  `;
  
  chatHistory.appendChild(welcomeMessage);
  
  // Mark welcome message as shown for this session
  sessionStorage.setItem('welcome_message_shown', 'true');
}

/**
 * Initialize user input functionality
 */
function initUserInput() {
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');

  // Global function for triggering send
  window.triggerSendMessage = function() {
    console.log("Global trigger function called");
    window.dispatchEvent(new CustomEvent('send-message'));
  };

  // Conversation management event binding
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
        alert('Selected conversation not found in localStorage.');
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

  // Remainder of initUserInput function stays here

  // Attach "Load Older Messages" button
  const loadOlderBtn = document.getElementById('load-older-btn');
  if (loadOlderBtn) {
    loadOlderBtn.addEventListener('click', loadOlderMessages);
  }

  // Make file references clickable
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.file-ref-link');
    if (link) {
      e.preventDefault();
      const fname = link.getAttribute('data-file-name');
      openFileInSidebar(fname);
    }
  });
  
  if (!userInput || !sendButton) return;
  
  // Auto-resize textarea as user types
  userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
  });

  // We no longer need this event handler as we're using direct DOM events
  // and the global custom event system instead
  
  // Focus input on page load
  setTimeout(() => {
    userInput.focus();
  }, 100);
}

function openFileInSidebar(filename) {
  // Show the sidebar, switch to Files tab
  const toggleButton = document.querySelector('[aria-controls="config-content files-content"]');
  if (toggleButton) toggleButton.click();
  const filesTab = document.getElementById('files-tab');
  if (filesTab) filesTab.click();

  // Attempt to scroll to the matching file in the file list
  const fileManagerList = document.querySelector('.file-drop-area + .space-y-2');
  if (!fileManagerList) return;

  const fileItem = [...fileManagerList.children]
    .find(c => c?.getAttribute('aria-label')?.includes(filename));
  if (fileItem) {
    fileItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fileItem.classList.add('bg-yellow-50', 'transition-colors');
    setTimeout(() => fileItem.classList.remove('bg-yellow-50'), 1200);
  }
}

/**
 * Initialize token usage display toggles
 */
function initTokenUsageDisplay() {
  const tokenUsage = document.querySelector('.token-usage-compact');
  if (!tokenUsage) return;
  
  // Create toggle button
  const toggleButton = document.createElement('button');
  toggleButton.className = 'absolute right-2 top-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none';
  toggleButton.setAttribute('aria-label', 'Toggle token usage display');
  toggleButton.innerHTML = '<span aria-hidden="true">⚙️</span>';
  
  tokenUsage.appendChild(toggleButton);
  
  // Add toggle functionality
  toggleButton.addEventListener('click', () => {
    tokenUsage.classList.toggle('h-6');
    tokenUsage.classList.toggle('overflow-hidden');
    const isExpanded = !tokenUsage.classList.contains('h-6');
    toggleButton.setAttribute('aria-expanded', isExpanded);
  });
}

/**
 * Register keyboard shortcuts
 */
function registerKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + Enter to send message
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const sendButton = document.getElementById('send-button');
      if (sendButton) sendButton.click();
    }
    
    // Escape to close sidebar on mobile
    if (e.key === 'Escape') {
      const sidebar = document.querySelector('aside');
      if (sidebar && sidebar.classList.contains('translate-x-0') && window.innerWidth < 768) {
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('translate-x-full');
        
        const overlay = document.getElementById('sidebar-overlay');
        if (overlay) overlay.classList.add('hidden');
      }
    }
  });
}

/**
 * Enhance accessibility features
 */
function enhanceAccessibility() {
  // Create a live region for screen reader announcements
  const liveRegion = document.createElement('div');
  liveRegion.id = 'a11y-announcements';
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(liveRegion);
  
  // Ensure all interactive elements have appropriate aria attributes
  document.querySelectorAll('button:not([aria-label])').forEach(button => {
    // Provide default aria-label if no text content
    if (!button.textContent.trim()) {
      button.setAttribute('aria-label', 'Button');
    }
  });
}

/**
 * Detect touch capability and add appropriate classes
 */
function detectTouchCapability() {
  const isTouchDevice = 
    ('ontouchstart' in window) || 
    (navigator.maxTouchPoints > 0) || 
    (navigator.msMaxTouchPoints > 0);
  
  if (isTouchDevice) {
    document.documentElement.classList.add('touch-device');
    
    // Adjust font size for better readability on mobile
    const defaultFontSize = localStorage.getItem('fontSize') || 'text-base';
    
    // If no font size has been set by user, set a more readable default for mobile
    if (!localStorage.getItem('fontSize') && window.matchMedia('(max-width: 640px)').matches) {
      document.documentElement.classList.add('text-lg');
      localStorage.setItem('fontSize', 'text-lg');
    } else {
      document.documentElement.classList.add(defaultFontSize);
    }
  }
}

// Call this function early in the initialization process
detectTouchCapability();
