// sidebarManager.js - Central module for all sidebar/menu functionality

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
      const isClosed = !sidebar.classList.contains('sidebar-open');
      toggleSidebar(isClosed);
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

  // Add conversation sidebar toggle handling
  const conversationsToggle = document.getElementById('conversations-toggle');
  const conversationsSidebar = document.getElementById('conversations-sidebar');

  if (conversationsToggle && conversationsSidebar) {
    conversationsToggle.addEventListener('click', () => {
      conversationsSidebar.classList.toggle('hidden');
      conversationsToggle.setAttribute(
        'aria-expanded',
        !conversationsSidebar.classList.contains('hidden')
      );
    });

    // Initialize mobile conversation sidebar state
    if (isMobile) {
      conversationsSidebar.classList.add('hidden');
      conversationsToggle.setAttribute('aria-expanded', 'false');
    }
  }

  // Init proper sidebar for first load based on viewport
  const viewportWidth = window.innerWidth;
  if (viewportWidth >= 768) {
    // Desktop view - fix any mobile styles
    sidebar.style.width = '384px';
  } else {
    // Mobile view - ensure proper mobile styles
    sidebar.style.width = '100%';
  }

  // Listen for resize events to adjust sidebar
  window.addEventListener('resize', handleResize);
}

/**
 * Handle window resize events to maintain proper sidebar state
 */
function handleResize() {
  const sidebar = document.getElementById('sidebar');
  const chatContainer = document.getElementById('chat-container');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) return;

  const isMobile = window.innerWidth < 768;
  const isOpen = sidebar.classList.contains('sidebar-open');

  // Update sidebar width
  if (isMobile) {
    sidebar.style.width = '100%';
    if (chatContainer) chatContainer.classList.remove('sidebar-open');
  } else {
    sidebar.style.width = '384px';
    if (isOpen && chatContainer) chatContainer.classList.add('sidebar-open');
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
  console.log(`toggleSidebar: ${show ? 'opening' : 'closing'} sidebar`);

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggleButton = document.getElementById('sidebar-toggle');
  const chatContainer = document.getElementById('chat-container');

  if (!sidebar) return;

  const isMobile = window.innerWidth < 768;

  if (show) {
    // Show sidebar
    sidebar.classList.add('sidebar-open');

    if (isMobile) {
      // Mobile-specific behavior
      if (overlay) overlay.classList.remove('hidden');
      // On mobile, don't adjust the chat container width
      if (chatContainer) chatContainer.classList.remove('sidebar-open');
    } else {
      // Desktop-specific behavior
      if (chatContainer) chatContainer.classList.add('sidebar-open');
      // Hide overlay on desktop
      if (overlay) overlay.classList.add('hidden');
    }

    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'true');
  } else {
    // Hide sidebar
    sidebar.classList.remove('sidebar-open');

    if (overlay) overlay.classList.add('hidden');
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');
    if (chatContainer) chatContainer.classList.remove('sidebar-open');
  }

  // Publish sidebar state change event
  if (window.eventBus) {
    window.eventBus.publish('sidebarStateChange', { isOpen: show });
  }
}