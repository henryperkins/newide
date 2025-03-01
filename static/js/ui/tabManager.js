// tabManager.js - Handles tab switching with Tailwind CSS

/**
 * Initializes the tab functionality with improved mobile support
 */
export function initTabSystem() {
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
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggleButton = document.getElementById('sidebar-toggle');
  
  if (!sidebar || !overlay) {
    console.error('Mobile sidebar elements missing:', {sidebar, overlay});
    return;
  }

  // Create close button if it doesn't exist
  let closeButton = document.getElementById('close-sidebar');
  if (!closeButton && sidebar) {
    closeButton = document.createElement('button');
    closeButton.id = 'close-sidebar';
    closeButton.className = 'sidebar-close';
    closeButton.setAttribute('aria-label', 'Close sidebar');
    closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
    </svg>`;
    sidebar.prepend(closeButton);
  }

  // Desktop fallback
  if (window.innerWidth >= 768) { // Match your md breakpoint
    if (sidebar) {
      sidebar.classList.remove('translate-x-full', 'translate-x-0');
      if (sidebar.classList.contains('sidebar-open')) {
        sidebar.classList.add('translate-x-0');
        document.getElementById('chat-container')?.classList.add('sidebar-open');
      } else {
        sidebar.classList.add('translate-x-full');
        document.getElementById('chat-container')?.classList.remove('sidebar-open');
      }
    }
  }
  
  // Create toggle button if it doesn't exist
  if (!toggleButton) {
    // Try to find any element that might be the toggle button
    const possibleToggle = document.querySelector('[aria-controls="config-content files-content"]');
    if (possibleToggle) {
      possibleToggle.id = 'sidebar-toggle';
      toggleButton = possibleToggle;
    } else {
      // Create a new toggle button in the header
      const header = document.querySelector('header');
      if (header) {
        toggleButton = document.createElement('button');
        toggleButton.id = 'sidebar-toggle';
        toggleButton.className = 'ml-auto p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700';
        toggleButton.setAttribute('aria-label', 'Toggle sidebar');
        toggleButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>`;
        header.appendChild(toggleButton);
      }
    }
  }
  
  // Close button handling
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      toggleSidebar(false);
    });
  }
  
  // Enhanced toggle button functionality
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', sidebar?.classList.contains('sidebar-open') ? 'true' : 'false');
    
    toggleButton.addEventListener('click', () => {
      const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
      toggleSidebar(!isExpanded);
    });
  }
  
  // Close sidebar when overlay is clicked
  if (overlay) {
    overlay.addEventListener('click', () => {
      toggleSidebar(false);
    });
  }
  
  // Handle swipe to close
  if (sidebar) {
    let startX, startY;
    sidebar.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      
      // Add transition for smooth animation
      sidebar.classList.add('transition-transform', 'duration-300');
    }, { passive: true });

    sidebar.addEventListener('touchmove', (e) => {
      if (!startX) return;
      
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - startX;
      const diffY = currentY - startY;
      
      // Abort swipe if vertical movement exceeds threshold (prevents accidental closing during scrolling)
      const VERTICAL_THRESHOLD = 10;
      if (Math.abs(diffY) > VERTICAL_THRESHOLD) return;
      
      // Only handle horizontal swipes
      if (Math.abs(diffX) > 30) {
        // Move sidebar visually but keep it bounded
        const translateX = Math.min(diffX, sidebar.offsetWidth);
        sidebar.style.transform = `translateX(${translateX}px)`;
      }
    }, { passive: true });

    sidebar.addEventListener('touchend', (e) => {
      if (!startX) return;
      
      const currentX = e.changedTouches[0].clientX;
      const diffX = currentX - startX;
      
      // Clear inline transform
      sidebar.style.transform = '';
      sidebar.classList.remove('transition-transform', 'duration-300');
      
      if (diffX > 100) {
        // Close the sidebar
        toggleSidebar(false);
      }
      
      startX = null;
    }, { passive: true });
  }
  
  // Handle resize events to ensure proper sidebar state
  window.addEventListener('resize', () => {
    const isMobile = window.innerWidth < 768;
    const isOpen = sidebar?.classList.contains('sidebar-open');

    if (isMobile) {
      // Ensure proper mobile state
      if (isOpen) {
        if (overlay) overlay.classList.remove('hidden');
      } else if (sidebar) {
        sidebar.classList.add('translate-x-full');
        sidebar.classList.remove('translate-x-0');
        if (overlay) overlay.classList.add('hidden');
      }
    } else if (sidebar) {
      // On desktop, adjust the chat container padding
      const chatContainer = document.getElementById('chat-container');
      if (chatContainer) {
        chatContainer.classList.toggle('sidebar-open', isOpen);
      }
      
      if (overlay) overlay.classList.add('hidden');
    }
  });
  
  // Add keyboard shortcut (Escape) to close sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sidebar?.classList.contains('sidebar-open')) {
        toggleSidebar(false);
      }
    }
  });
}

/**
 * Toggle sidebar visibility
 * @param {boolean} show Whether to show the sidebar
 */
function toggleSidebar(show) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggleButton = document.getElementById('sidebar-toggle');
  const chatContainer = document.getElementById('chat-container');
  
  if (!sidebar) return;
  
  const isMobile = window.innerWidth < 768;
  
  if (show) {
    if (isMobile) {
      sidebar.classList.add('fixed');
      sidebar.classList.remove('md:static');
    }
    sidebar.classList.remove('translate-x-full');
    sidebar.classList.add('sidebar-open', 'translate-x-0');
    if (overlay && isMobile) overlay.classList.remove('hidden');
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'true');
    if (chatContainer && !isMobile) chatContainer.classList.add('sidebar-open');
  } else {
    sidebar.classList.add('translate-x-full');
    sidebar.classList.remove('translate-x-0', 'sidebar-open');
    if (isMobile) {
      sidebar.classList.remove('fixed');
      sidebar.classList.add('md:static');
    }
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
