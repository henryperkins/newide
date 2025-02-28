// tabManager.js - Handles tab switching with Tailwind CSS

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
  
  // Handle resize events to ensure proper sidebar state
  window.addEventListener('resize', () => {
    const isMobile = window.innerWidth < 768;
    const isOpen = !sidebar.classList.contains('translate-x-full');

    if (isMobile) {
      // Mobile view
      if (isOpen) {
        overlay.classList.remove('hidden');
      } else {
        overlay.classList.add('hidden');
      }
    } else {
      // Desktop view - reset to default state
      sidebar.classList.remove('translate-x-full');
      sidebar.classList.add('md:translate-x-0');
      overlay.classList.add('hidden');
    }
  });
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
