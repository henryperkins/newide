// tabManager.js - Handles tab switching with Tailwind CSS

/**
 * Initializes the tab functionality for the sidebar
 */
export function initTabSystem() {
  const tabButtons = document.querySelectorAll('[data-target-tab]');
  
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
 * Handles changing the active tab
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
    button.classList.remove('border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400');
    button.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200');
    button.setAttribute('aria-selected', 'false');
  });
  
  // Hide all tab contents
  allTabContents.forEach(content => {
    content.classList.add('hidden');
    content.setAttribute('aria-hidden', 'true');
  });
  
  // Activate clicked tab
  clickedTab.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200');
  clickedTab.classList.add('border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400');
  clickedTab.setAttribute('aria-selected', 'true');
  
  // Show corresponding content
  const activeContent = document.getElementById(tabId);
  if (activeContent) {
    activeContent.classList.remove('hidden');
    activeContent.setAttribute('aria-hidden', 'false');
  }
}

/**
 * Sets up the mobile sidebar toggle functionality
 */
function initMobileSidebarToggle() {
  const toggleButton = document.querySelector('[aria-controls="config-content files-content"]');
  if (!toggleButton) return;
  
  const sidebar = document.querySelector('aside');
  if (!sidebar) return;
  
  toggleButton.addEventListener('click', () => {
    // Toggle sidebar visibility
    const isVisible = sidebar.classList.contains('translate-x-0');
    
    if (isVisible) {
      // Hide sidebar
      sidebar.classList.remove('translate-x-0');
      sidebar.classList.add('translate-x-full');
      toggleButton.setAttribute('aria-expanded', 'false');
      
      // Add overlay if it exists
      const overlay = document.getElementById('sidebar-overlay');
      if (overlay) overlay.classList.add('hidden');

      // Return focus to toggle after closing
      toggleButton.focus();
    } else {
      // Show sidebar
      sidebar.classList.remove('translate-x-full');
      sidebar.classList.add('translate-x-0');
      toggleButton.setAttribute('aria-expanded', 'true');

      // Move focus to first tab button after opening
      const firstTabButton = sidebar.querySelector('[data-target-tab]');
      if (firstTabButton) {
        setTimeout(() => {
          firstTabButton.focus();
        }, 150);
      }
      
      // Check if overlay exists, if not create it
      let overlay = document.getElementById('sidebar-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sidebar-overlay';
        overlay.className = 'fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden transition-opacity duration-300';
        document.body.appendChild(overlay);
        
        // Close sidebar when clicking outside
        overlay.addEventListener('click', () => {
          sidebar.classList.remove('translate-x-0');
          sidebar.classList.add('translate-x-full');
          toggleButton.setAttribute('aria-expanded', 'false');
          overlay.classList.add('hidden');
        });
      } else {
        overlay.classList.remove('hidden');
      }
    }
  });
  
  // Handle resize events to ensure proper sidebar state on desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) { // md breakpoint
      // Reset sidebar position for desktop view
      sidebar.classList.remove('translate-x-full');
      sidebar.classList.add('md:translate-x-0');
      
      // Hide overlay
      const overlay = document.getElementById('sidebar-overlay');
      if (overlay) overlay.classList.add('hidden');
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
