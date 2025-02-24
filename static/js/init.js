import { sendMessage } from './chat.js';

// init.js - Application initialization
// Imports all necessary modules and bootstraps the application with Tailwind CSS

try {
  import('./ui/themeSwitcher.js').then(module => {
    window.initThemeSwitcher = module.initThemeSwitcher;
  }).catch(err => {
    console.error('Error loading themeSwitcher.js:', err);
  });
} catch (error) {
  console.error('Could not import themeSwitcher:', error);
}
import { initTabSystem } from './ui/tabManager.js';
import { configureMarkdown } from './ui/markdownParser.js';
import { loadConversationFromLocalStorage } from './ui/displayManager.js';
import StatsDisplay from './ui/statsDisplay.js';
import fileManager from './fileManager.js';

/**
 * Initialize the application when the DOM is fully loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing Azure OpenAI Chat application...');
  
  // Initialize theme system (dark/light mode) - call it if available
  if (window.initThemeSwitcher) {
    window.initThemeSwitcher();
  } else {
    console.warn('Theme switcher not initialized - UI may be missing the theme toggle');
  }
  
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
  
  initializeFontSizeControls();
  console.log('Application initialization complete');
});

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
  
  // Show welcome message if no conversation exists
  const conversationExists = localStorage.getItem('conversation') && 
    JSON.parse(localStorage.getItem('conversation')).length > 0;
    
  if (!conversationExists) {
    showWelcomeMessage();
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
