// tabManager.js - Handles tab switching with Tailwind CSS

/**
 * Initializes the tab functionality with improved mobile support
 */
export function initTabSystem() {
  console.log("initTabSystem() is being called");
  const tabButtons = document.querySelectorAll('[data-target-tab]');
  const allTabContents = document.querySelectorAll('[role="tabpanel"]');
  const isMobile = window.innerWidth < 768;

  // First ensure all panels are properly hidden except the active one
  resetTabPanels(allTabContents);

  // Remove any existing event listeners from tab buttons
  tabButtons.forEach(button => {
    const newButton = button.cloneNode(true);
    if (button.parentNode) {
      button.parentNode.replaceChild(newButton, button);
    }
  });

  // Get fresh references after DOM updates
  const refreshedTabButtons = document.querySelectorAll('[data-target-tab]');

  // Initialize tab click handlers
  refreshedTabButtons.forEach(button => {
    button.addEventListener('click', () => handleTabChange(button));

    // Set initial state based on aria-selected
    if (button.getAttribute('aria-selected') === 'true') {
      // Make sure corresponding panel is visible
      const tabId = button.getAttribute('data-target-tab');
      const panel = document.getElementById(tabId);
      if (panel) {
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');
      }
    }
  });

  // Reset mobile-specific styles in desktop view
  if (!isMobile) {
    refreshedTabButtons.forEach(button => {
      button.classList.remove('tab-button', 'tab-active', 'tab-inactive');
    });
  } else {
    // Apply mobile-specific styles
    refreshedTabButtons.forEach(button => {
      button.classList.add('tab-button');

      if (button.getAttribute('aria-selected') === 'true') {
        button.classList.add('tab-active');
        button.classList.remove('tab-inactive');
      } else {
        button.classList.add('tab-inactive');
        button.classList.remove('tab-active');
      }
    });
  }

  // Add arrow-key navigation
  refreshedTabButtons.forEach((button, index) => {
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextBtn = refreshedTabButtons[(index + 1) % refreshedTabButtons.length];
        nextBtn.focus();
        handleTabChange(nextBtn);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevBtn = refreshedTabButtons[(index - 1 + refreshedTabButtons.length) % refreshedTabButtons.length];
        prevBtn.focus();
        handleTabChange(prevBtn);
      }
    });
  });

  // Listen for viewport size changes
  window.addEventListener('resize', debounce(() => {
    const newIsMobile = window.innerWidth < 768;
    if (newIsMobile !== isMobile) {
      // Viewport size category changed - reinitialize
      initTabSystem();
    }
  }, 250));
}

/**
 * Reset all tab panels to default state
 */
function resetTabPanels(panels) {
  if (!panels || !panels.length) return;

  // Hide all panels except the one marked as selected
  panels.forEach(panel => {
    // Find corresponding tab button
    const tabId = panel.id;
    const button = document.querySelector(`[data-target-tab="${tabId}"]`);

    if (button && button.getAttribute('aria-selected') === 'true') {
      panel.classList.remove('hidden');
      panel.setAttribute('aria-hidden', 'false');
      panel.classList.add('relative', 'w-full');
    } else {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  });
}

/**
 * Handles changing the active tab with improved mobile classes
 * @param {HTMLElement} clickedTab The tab button that was clicked
 */
function handleTabChange(clickedTab) {
  if (!clickedTab) return;

  const tabId = clickedTab.getAttribute('data-target-tab');
  if (!tabId) return;

  // Get all tab buttons and content panels
  const allTabButtons = document.querySelectorAll('[data-target-tab]');
  const allTabContents = document.querySelectorAll('[role="tabpanel"]');
  const isMobile = window.innerWidth < 768;

  // Deactivate all tabs
  allTabButtons.forEach(button => {
    // Remove active styles and add inactive styles
    button.classList.remove('border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400');
    button.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200');

    // Update mobile-specific classes if needed
    if (isMobile) {
      button.classList.remove('tab-active');
      button.classList.add('tab-inactive');
    }

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

  // Update mobile-specific classes if needed
  if (isMobile) {
    clickedTab.classList.remove('tab-inactive');
    clickedTab.classList.add('tab-active');
  }

  clickedTab.setAttribute('aria-selected', 'true');

  // Show corresponding content
  const activeContent = document.getElementById(tabId);
  if (activeContent) {
    activeContent.classList.remove('hidden');
    activeContent.setAttribute('aria-hidden', 'false');

    // Ensure proper positioning and dimensions
    activeContent.classList.add('relative', 'w-full');

    // Make sure the panel is properly visible
    activeContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

/**
 * Simple debounce function to prevent excessive function calls
 * @param {Function} func The function to debounce
 * @param {number} wait Debounce wait time in milliseconds
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
