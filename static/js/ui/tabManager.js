// tabManager.js - Handles tab switching with Tailwind CSS

/**
 * Initializes the tab functionality with improved mobile support
 */
export function initTabSystem() {
  console.log("initTabSystem() is being called"); // Debug log
  const tabButtons = document.querySelectorAll('[data-target-tab]');
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  // Initialize tab click handlers first
  tabButtons.forEach(button => {
    button.addEventListener('click', () => handleTabChange(button));
  });
  
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

  // Initialize mobile sidebar toggle
  initMobileSidebarToggle();
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

/**
 * Initialize enhanced mobile sidebar handling
 */
function initMobileSidebarToggle() {
  console.log("initMobileSidebarToggle is running!"); // Debug log
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggleButton = document.getElementById('sidebar-toggle');
  const closeButton = document.getElementById('close-sidebar');
  const chatContainer = document.getElementById('chat-container');
  
  if (!sidebar || !toggleButton) {
    console.error('Sidebar elements missing:', {sidebar, toggleButton});
    return;
  }

  // Add proper ARIA attributes for accessibility
  toggleButton.setAttribute('aria-controls', 'sidebar');
  toggleButton.setAttribute('aria-expanded', 'false');
  
  /**
   * Toggle sidebar visibility with proper state management
   * @param {boolean} isOpen Whether to show the sidebar
   */
  function setSidebarState(isOpen) {
    // Use the improved toggleSidebar function
    toggleSidebar(isOpen);
  }
  
  // Toggle button handler
  toggleButton.addEventListener('click', () => {
    const newState = toggleButton.getAttribute('aria-expanded') !== 'true';
    setSidebarState(newState);
  });
  
  // Close button handler
  if (closeButton) {
    closeButton.addEventListener('click', () => setSidebarState(false));
  }
  
  // Overlay click handler
  if (overlay) {
    overlay.addEventListener('click', () => setSidebarState(false));
  }
  
  // Escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggleButton.getAttribute('aria-expanded') === 'true') {
      setSidebarState(false);
    }
  });
  
  // Handle swipe to dismiss on mobile
  if (sidebar) {
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
      
      // Ignore vertical swipes (for scrolling)
      if (Math.abs(diffY) > 10) return;
      
      // Only handle rightward swipes (to close)
      if (diffX > 0) {
        sidebar.style.transform = `translateX(${diffX}px)`;
      }
    }, { passive: true });
    
    sidebar.addEventListener('touchend', (e) => {
      if (!startX) return;
      
      const currentX = e.changedTouches[0].clientX;
      const diffX = currentX - startX;
      
      // Reset inline transforms
      sidebar.style.transform = '';
      
      // Close if swiped far enough
      if (diffX > 100) {
        setSidebarState(false);
      }
      
      startX = null;
      startY = null;
    }, { passive: true });
  }
  
  // Handle window resize
  window.addEventListener('resize', () => {
    const isOpen = toggleButton.getAttribute('aria-expanded') === 'true';
    setSidebarState(isOpen);
  });
}

// Update the existing toggleSidebarHandler function
function toggleSidebarHandler() {
  const isExpanded = this.getAttribute('aria-expanded') === 'true';
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const chatContainer = document.getElementById('chat-container');
  
  if (!sidebar) return;
  
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  // Toggle sidebar state
  if (!isExpanded) {
    sidebar.classList.remove('translate-x-full');
    sidebar.classList.add('translate-x-0', 'sidebar-open');
    this.setAttribute('aria-expanded', 'true');
    
    if (isMobile && overlay) {
      overlay.classList.remove('hidden');
    } else if (chatContainer) {
      chatContainer.classList.add('sidebar-open');
    }
  } else {
    sidebar.classList.add('translate-x-full');
    sidebar.classList.remove('translate-x-0', 'sidebar-open');
    this.setAttribute('aria-expanded', 'false');
    
    if (overlay) {
      overlay.classList.add('hidden');
    }
    if (chatContainer) {
      chatContainer.classList.remove('sidebar-open');
    }
  }
}

/**
 * Toggle sidebar visibility with proper state management
 * @param {boolean} show Whether to show the sidebar
 */
function toggleSidebar(show) {
  console.log("toggleSidebar: toggling to", show ? "open" : "close"); // Debug log
  console.log("Sidebar element:", document.getElementById('sidebar')); // Debug log
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggleButton = document.getElementById('sidebar-toggle');
  const chatContainer = document.getElementById('chat-container');
  
  if (!sidebar) return;
  
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  if (show) {
    sidebar.classList.remove('translate-x-full');
    sidebar.classList.add('translate-x-0', 'sidebar-open');
    
    if (isMobile) {
      if (overlay) overlay.classList.remove('hidden');
      // On mobile, don't adjust the chat container width
      if (chatContainer) chatContainer.classList.remove('sidebar-open');
    } else {
      // On desktop, add the padding
      if (chatContainer) chatContainer.classList.add('sidebar-open');
      // Hide overlay on desktop always
      if (overlay) overlay.classList.add('hidden');
    }
    
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'true');
  } else {
    sidebar.classList.add('translate-x-full');
    sidebar.classList.remove('translate-x-0', 'sidebar-open');
    
    if (overlay) overlay.classList.add('hidden');
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');
    if (chatContainer) chatContainer.classList.remove('sidebar-open');
  }
  
  // Publish sidebar state change event
  if (window.eventBus) {
    window.eventBus.publish('sidebarStateChange', { isOpen: show });
  }
}

/**
 * Public method to select a specific tab by ID
 * @param {string} tabId The ID of the tab content to activate
 */
export function activateTab(tabId) {
  const tabButton = document.querySelector(`[data-target-tab="${tabId}"]`);
  if (tabButton) {
    handleTabChange(tabButton);
  }
}

// Export toggleSidebar for external use if needed
export { toggleSidebar };
