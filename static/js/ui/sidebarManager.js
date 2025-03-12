/**
 * sidebarManager.js - Central module for all sidebar/menu functionality
 */

/**
 * Initialize the sidebar and mobile menu functionality
 */
export function initSidebar() {
  console.log("Initializing sidebar and menu functionality...");

  const toggleButton = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const closeButton = document.getElementById('close-sidebar');

  if (!sidebar) {
    console.error("Sidebar element not found");
    return;
  }

  // Sidebar toggle button
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      console.log("Sidebar toggle button clicked");
      const isOpen = sidebar.classList.contains('sidebar-open');
      toggleSidebar(!isOpen);
    });
  }

  // Close button in sidebar
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      toggleSidebar(false);
    });
  }

  // Make the overlay close the sidebar when clicked
  if (overlay) {
    overlay.addEventListener('click', () => {
      toggleSidebar(false);
    });
  }

  // Register keyboard shortcut (ESC to close sidebar)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('sidebar-open')) {
      toggleSidebar(false);
    }
  });

  // Initially hide sidebar on mobile if needed
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    sidebar.classList.remove('sidebar-open');
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');
    if (overlay) overlay.classList.add('hidden');
  }


  // Init proper sidebar for first load based on viewport
  const viewportWidth = window.innerWidth;
  if (viewportWidth >= 768) {
    // Desktop view - fix any mobile styles
    sidebar.classList.add('w-96');
    sidebar.classList.remove('w-full');
  } else {
    // Mobile view - ensure proper mobile styles
    sidebar.classList.add('w-full');
    sidebar.classList.remove('w-96');
  }

  // Listen for resize events to adjust sidebar
  window.addEventListener('resize', handleResize);
}

/**
 * Handle window resize events to maintain proper sidebar state
 */
function handleResize() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;

  const isMobile = window.innerWidth < 768;
  const isOpen = sidebar.classList.contains('sidebar-open');

  // Use Tailwind classes for width, removing inline overrides
  if (isMobile) {
    sidebar.classList.add('w-full');
    sidebar.classList.remove('w-96');
  } else {
    sidebar.classList.add('w-96');
    sidebar.classList.remove('w-full');
  }

  // Update overlay visibility
  if (overlay) {
    if (isMobile && isOpen) {
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }
}

/**
 * Toggle sidebar visibility
 * @param {boolean} show - Whether to show the sidebar (true) or hide it (false)
 */
export function toggleSidebar(show) {
  console.log('toggleSidebar:', show ? 'opening' : 'closing', 'sidebar');

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggleButton = document.getElementById('sidebar-toggle');
  if (!sidebar) return;

  const isMobile = window.innerWidth < 768;

  if (show) {
    // Show sidebar using Tailwind classes
    sidebar.classList.add('sidebar-open', 'translate-x-0');
    sidebar.classList.remove('hidden', 'translate-x-full');
    if (isMobile && overlay) {
      overlay.classList.remove('hidden');
    }
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', 'true');
    }
  } else {
    // Hide sidebar
    sidebar.classList.remove('sidebar-open', 'translate-x-0');
    sidebar.classList.add('hidden', 'translate-x-full');
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', 'false');
    }
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  // Publish sidebar state change event
  if (window.eventBus) {
    window.eventBus.publish('sidebarStateChange', { isOpen: show });
  }
}
