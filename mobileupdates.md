# Mobile UI Improvements for Azure OpenAI o1 Chat Application

After analyzing the codebase in detail, I've identified several areas where the mobile experience can be enhanced. Below are comprehensive, tailored solutions that fit within the existing architecture.

## 1. Optimize Mobile Layout in index.html

The primary HTML layout needs responsive adjustments for mobile devices:

```html
<!-- Modify in static/index.html -->
<header class="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 p-2 border-b border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
    <div class="flex items-center justify-between w-full md:w-auto">
        <h1 class="text-lg font-semibold">Azure OpenAI o1 Chat</h1>
        <!-- Mobile-only controls -->
        <div class="flex items-center space-x-2 md:hidden">
            <button id="mobile-stats-toggle" aria-label="Toggle statistics" class="p-1 text-sm bg-gray-200 dark:bg-gray-700 rounded">
                📊
            </button>
            <button id="mobile-font-toggle" aria-label="Font size" class="p-1 text-sm bg-gray-200 dark:bg-gray-700 rounded">
                Aa
            </button>
        </div>
    </div>
    
    <!-- Desktop-only info -->
    <div class="hidden md:block text-sm text-gray-600 dark:text-gray-400">
        <p><strong>Model Info:</strong> Using Azure OpenAI o1 model (no streaming)</p>
    </div>
    
    <!-- Stats - hidden on mobile by default -->
    <div class="performance-stats hidden md:flex" id="performance-stats">
        <!-- Stats content remains the same -->
    </div>
    
    <!-- Desktop font controls -->
    <div class="hidden md:flex items-center space-x-2">
        <button id="font-size-down" class="btn-secondary" title="Decrease font size">A-</button>
        <button id="font-size-up" class="btn-secondary" title="Increase font size">A+</button>
    </div>
</header>

<!-- Add mobile stats panel (initially hidden) -->
<div id="mobile-stats-panel" class="hidden md:hidden p-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
    <div class="grid grid-cols-2 gap-2 text-xs">
        <div>
            <span class="text-gray-500 dark:text-gray-400">Prompt:</span>
            <span id="mobile-prompt-tokens" class="font-mono">0</span>
        </div>
        <div>
            <span class="text-gray-500 dark:text-gray-400">Completion:</span>
            <span id="mobile-completion-tokens" class="font-mono">0</span>
        </div>
        <div>
            <span class="text-gray-500 dark:text-gray-400">Total:</span>
            <span id="mobile-total-tokens" class="font-mono font-medium">0</span>
        </div>
        <div>
            <span class="text-gray-500 dark:text-gray-400">Speed:</span>
            <span id="mobile-tokens-per-second" class="font-mono">0 t/s</span>
        </div>
    </div>
    <!-- Mobile font controls -->
    <div class="flex justify-center mt-2">
        <button id="mobile-font-down" class="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-l-md">A-</button>
        <button id="mobile-font-up" class="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded-r-md">A+</button>
    </div>
</div>
```

## 2. Enhance Sidebar for Mobile in index.html

```html
<!-- Modify the sidebar in static/index.html -->
<aside class="fixed top-0 right-0 h-full w-80 transform translate-x-full md:translate-x-0 transition-transform duration-300 ease-in-out z-40 md:relative md:z-auto bg-white dark:bg-gray-800 border-l border-gray-300 dark:border-gray-700 shadow-lg md:shadow-none overflow-hidden">
    <!-- Add close button for mobile -->
    <button id="close-sidebar" class="absolute top-3 left-3 md:hidden p-2 rounded-full bg-gray-200 dark:bg-gray-700 z-10">
        ✕
    </button>
    
    <!-- Tab navigation - adjust for better touch targets -->
    <div class="flex border-b border-gray-300 dark:border-gray-700 mt-12 md:mt-0" role="tablist">
        <button 
            class="px-3 py-3 md:py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 flex-1 text-center" 
            id="config-tab"
            role="tab" 
            data-target-tab="config-content"
            aria-selected="true"
            aria-controls="config-content">
            Configuration
        </button>
        <!-- Other tab buttons remain similar but with flex-1 and text-center classes -->
    </div>
    
    <!-- The tab content divs remain largely unchanged -->
</aside>

<!-- Add modal overlay for mobile -->
<div id="sidebar-overlay" class="fixed inset-0 bg-black bg-opacity-50 z-30 hidden md:hidden"></div>

<!-- Adjust mobile sidebar toggle -->
<button 
    class="fixed bottom-24 right-4 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 md:hidden z-50"
    aria-label="Settings"
    aria-controls="config-content files-content"
    aria-expanded="false">
    <span class="sr-only">Toggle settings</span>
    <span aria-hidden="true">⚙️</span>
</button>
```

## 3. Optimize Input Area for Mobile

```html
<!-- Modify input area in static/index.html -->
<section class="border-t border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
    <!-- Input and Send - with better touch handling -->
    <div class="flex space-x-2 items-end p-2 relative">
        <textarea 
            id="user-input" 
            placeholder="Type your message..."
            aria-label="Your message"
            rows="1"
            class="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:outline-none resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        ></textarea>
        <button 
            id="send-button" 
            type="button"
            class="bg-blue-600 hover:bg-blue-700 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-md"
            aria-label="Send message"
        >
            <span aria-hidden="true" class="text-xl">↑</span>
        </button>
    </div>
    
    <!-- Simplified token usage display -->
    <div class="token-usage-compact h-8 overflow-hidden hover:h-auto transition-all duration-300 p-2 text-xs border-t border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800" aria-label="Token usage statistics">
        <!-- Content remains the same -->
    </div>
</section>
```

## 4. Enhance CSS for Mobile in tailwind.css

```css
/* Add to static/css/tailwind.css */
@layer components {
  /* Mobile-optimized message bubbles */
  .user-message {
    @apply ml-auto max-w-[85%] sm:max-w-[80%] md:max-w-3xl rounded-lg rounded-br-none bg-blue-600 p-2.5 md:p-3 text-white shadow-md relative my-2;
  }

  .assistant-message {
    @apply mr-auto max-w-[85%] sm:max-w-[80%] md:max-w-3xl rounded-lg rounded-bl-none bg-white dark:bg-gray-700 p-2.5 md:p-3 border border-gray-200 dark:border-gray-600 shadow-sm text-gray-800 dark:text-gray-100 relative my-2;
  }
  
  /* Other message types */
  .system-message {
    @apply mx-auto max-w-[92%] md:max-w-xl bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-400 dark:border-yellow-600 p-2 md:p-3 text-yellow-800 dark:text-yellow-200 rounded my-2;
  }
  
  /* Improved copy button for touch */
  .copy-button {
    @apply absolute top-1 right-1 md:top-2 md:right-2 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 backdrop-blur-sm transition-colors text-white/80 dark:text-gray-200/80 touch-action-manipulation;
  }
  
  /* Mobile-optimized tab buttons */
  .tab-button {
    @apply px-3 py-3 md:py-2 text-sm font-medium border-b-2 flex-1 text-center touch-action-manipulation;
  }
  
  .tab-active {
    @apply border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400;
  }
  
  .tab-inactive {
    @apply border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200;
  }
}

@layer utilities {
  /* Utility for better touch targets */
  .touch-action-manipulation {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  
  /* Mobile font sizes */
  .mobile-text-adjust {
    font-size: 16px; /* Minimum readable size for mobile */
    line-height: 1.5;
  }
  
  /* Safe area handling for notched phones */
  .safe-area-inset-bottom {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  
  .safe-area-inset-top {
    padding-top: env(safe-area-inset-top, 0px);
  }
}
```

## 5. Add Mobile Initialization in init.js

```javascript
// Add to static/js/init.js

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
 * Initialize enhanced mobile sidebar handling
 */
function initMobileSidebar() {
  const sidebar = document.querySelector('aside');
  const overlay = document.getElementById('sidebar-overlay');
  const toggleButton = document.querySelector('[aria-controls="config-content files-content"]');
  const closeButton = document.getElementById('close-sidebar');
  
  if (!sidebar || !overlay || !toggleButton) return;
  
  // Close button handling
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      sidebar.classList.add('translate-x-full');
      sidebar.classList.remove('translate-x-0');
      overlay.classList.add('hidden');
      toggleButton.setAttribute('aria-expanded', 'false');
    });
  }
  
  // Enhance existing toggle button functionality
  toggleButton.addEventListener('click', () => {
    const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
    
    if (isExpanded) {
      sidebar.classList.add('translate-x-full');
      sidebar.classList.remove('translate-x-0');
      overlay.classList.add('hidden');
    } else {
      sidebar.classList.remove('translate-x-full');
      sidebar.classList.add('translate-x-0');
      overlay.classList.remove('hidden');
    }
    
    toggleButton.setAttribute('aria-expanded', !isExpanded);
  });
  
  // Close sidebar when overlay is clicked
  overlay.addEventListener('click', () => {
    sidebar.classList.add('translate-x-full');
    sidebar.classList.remove('translate-x-0');
    overlay.classList.add('hidden');
    toggleButton.setAttribute('aria-expanded', 'false');
  });
  
  // Handle swipe to close
  let startX, startY;
  sidebar.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  
  sidebar.addEventListener('touchmove', (e) => {
    if (!startX) return;
    
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX;
    const diffY = currentY - startY;
    
    // Only handle horizontal swipes (ignore more vertical swipes)
    if (Math.abs(diffX) > Math.abs(diffY) && diffX > 50) {
      sidebar.style.transform = `translateX(${diffX}px)`;
    }
  }, { passive: true });
  
  sidebar.addEventListener('touchend', (e) => {
    if (!startX) return;
    
    const currentX = e.changedTouches[0].clientX;
    const diffX = currentX - startX;
    
    if (diffX > 100) {
      // Close the sidebar if swiped right enough
      sidebar.classList.add('translate-x-full');
      sidebar.classList.remove('translate-x-0');
      overlay.classList.add('hidden');
      toggleButton.setAttribute('aria-expanded', 'false');
    }
    
    // Reset transform
    sidebar.style.transform = '';
    startX = null;
    startY = null;
  }, { passive: true });
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

// Update existing tokenUsage function to sync with mobile
// In updateTokenUsage function in utils/helpers.js, add:
// syncMobileStats({
//   promptTokens: usage.prompt_tokens || 0,
//   completionTokens: usage.completion_tokens || 0,
//   totalTokens: usage.total_tokens || 0
// });

// Add to the document ready function or event:
document.addEventListener('DOMContentLoaded', () => {
  // ... existing initializations
  
  // Initialize mobile UI enhancements
  initMobileUI();
  
  // ...
});
```

## 6. Enhance tabManager.js for Mobile

```javascript
// Modify static/js/ui/tabManager.js

/**
 * Initializes the tab functionality with improved mobile support
 */
export function initTabSystem() {
  const tabButtons = document.querySelectorAll('[data-target-tab]');
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  // Updated button classes
  if (isMobile) {
    tabButtons.forEach(button => {
      button.classList.add('tab-button');
      
      if (button.getAttribute('aria-selected') === 'true') {
        button.classList.add('tab-active');
      } else {
        button.classList.add('tab-inactive');
      }
    });
  }
  
  // Add arrow-key navigation
  tabButtons.forEach((button, index) => {
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextBtn = tabButtons[(index + 1) % tabButtons.length];
        nextBtn.focus();
        handleTabChange(nextBtn);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevBtn = tabButtons[(index - 1 + tabButtons.length) % tabButtons.length];
        prevBtn.focus();
        handleTabChange(prevBtn);
      }
    });
  });

  // Setup event listeners for tab buttons
  tabButtons.forEach(button => {
    button.addEventListener('click', () => handleTabChange(button));
  });
}

/**
 * Handles changing the active tab with improved mobile classes
 * @param {HTMLElement} clickedTab The tab button that was clicked
 */
function handleTabChange(clickedTab) {
  const tabId = clickedTab.getAttribute('data-target-tab');
  if (!tabId) return;
  
  // Get all tab buttons and content panels
  const allTabButtons = document.querySelectorAll('[data-target-tab]');
  const allTabContents = document.querySelectorAll('[role="tabpanel"]');
  
  // Deactivate all tabs
  allTabButtons.forEach(button => {
    // Remove active styles and add inactive styles
    button.classList.remove('border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400', 'tab-active');
    button.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200', 'tab-inactive');
    button.setAttribute('aria-selected', 'false');
  });
  
  // Hide all tab contents
  allTabContents.forEach(content => {
    content.classList.add('hidden');
    content.setAttribute('aria-hidden', 'true');
  });
  
  // Activate clicked tab
  clickedTab.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200', 'tab-inactive');
  clickedTab.classList.add('border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400', 'tab-active');
  clickedTab.setAttribute('aria-selected', 'true');
  
  // Show corresponding content
  const activeContent = document.getElementById(tabId);
  if (activeContent) {
    activeContent.classList.remove('hidden');
    activeContent.setAttribute('aria-hidden', 'false');
  }
}
```

## 7. Enhance displayManager.js for Mobile

```javascript
// Modify in static/js/ui/displayManager.js

/**
 *  Create a copy button with improved mobile support
 */
function createCopyButton(content) {
  const button = document.createElement('button');
  button.className = 'copy-button touch-action-manipulation';
  button.innerHTML = '📋';
  button.title = 'Copy to clipboard';
  
  // Better touch event handling
  button.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    copyToClipboard(typeof content === 'string' ? content : JSON.stringify(content))
      .then(() => {
        // Show success indicator
        button.innerHTML = '✓';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      })
      .catch(err => {
        console.error('Copy failed:', err);
        // Show failure indicator
        button.innerHTML = '❌';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      });
  });
  
  // Also handle regular click for desktop
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    copyToClipboard(typeof content === 'string' ? content : JSON.stringify(content))
      .then(() => {
        // Show success indicator
        button.innerHTML = '✓';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      })
      .catch(err => {
        console.error('Copy failed:', err);
        // Show failure indicator
        button.innerHTML = '❌';
        setTimeout(() => {
          button.innerHTML = '📋';
        }, 1000);
      });
  });
  
  return button;
}

/**
 * Highlight new message with improved mobile visibility
 */
function highlightNewMessage(element) {
  // More visible highlight on mobile
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  if (isMobile) {
    element.classList.add('bg-blue-50', 'dark:bg-blue-900/20', 'transition-colors', 'duration-1000');
    setTimeout(() => {
      element.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
    }, 1500);
  } else {
    element.classList.add('bg-yellow-50', 'transition-colors');
    setTimeout(() => {
      element.classList.remove('bg-yellow-50');
    }, 1200);
  }
}

/**
 * Improved scroll behavior for mobile
 */
function scheduleScroll(element) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const scrollOptions = {
    behavior: 'smooth',
    block: isMobile ? 'end' : 'nearest',
    inline: 'nearest'
  };

  // More generous scroll threshold on mobile
  const scrollThreshold = isMobile ? 200 : 300;
  const fromBottom = chatHistory.scrollHeight - (chatHistory.scrollTop + chatHistory.clientHeight);

  if (fromBottom <= scrollThreshold) {
    setTimeout(() => {
      element.scrollIntoView(scrollOptions);
    }, isMobile ? 100 : 50);
  }
}
```

## 8. Implement Meta Viewport Tag

Add this to the `<head>` section of static/index.html to ensure proper rendering on mobile devices:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

## 9. Add Touch Detection and PWA Support

Add to init.js:

```javascript
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
```

## 10. Implement Service Worker Registration for Offline Support

Add to index.html before the closing </body> tag:

```html
<script>
  // Register service worker for PWA support
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/static/js/utils/service-worker.js')
        .then(function(registration) {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
        })
        .catch(function(error) {
          console.log('ServiceWorker registration failed: ', error);
        });
    });
  }
</script>
```

With these comprehensive improvements implemented, the application will be significantly more user-friendly on mobile devices while maintaining the existing functionality and architecture. The changes are focused on responsive design, touch optimization, and performance enhancements specifically for small screens.