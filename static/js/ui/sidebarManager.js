// sidebarManager.js - Central module for all sidebar/menu functionality

/**
 * Initialize the sidebar and mobile menu functionality
 */
export function initSidebar() {
  console.log("Initializing sidebar and menu functionality...");

  const toggleButton = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  // If the 'x' button in your HTML uses class="sidebar-close" rather than id="close-sidebar",
  // switch the query to match that class. This ensures the existing close button is actually found.
  const closeButton = document.querySelector('.sidebar-close');

  if (!sidebar) {
    console.error("Sidebar element not found");
    return;
  }

  // Sidebar toggle button
  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      console.log("Sidebar toggle button clicked");
      const isOpen = sidebar.classList.contains('sidebar-open');
      // If open -> close, else -> open
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

  // Add conversation sidebar toggle handling
  const conversationsToggle = document.getElementById('conversations-toggle');
  const conversationsSidebar = document.getElementById('conversations-sidebar');

  if (conversationsToggle && conversationsSidebar) {
      conversationsToggle.addEventListener('click', () => {
          const isOpen = conversationsSidebar.classList.contains('sidebar-open');
          if (isOpen) {
              // Close conversation sidebar
              conversationsSidebar.classList.remove('sidebar-open');
              conversationsSidebar.classList.add('hidden');
              conversationsSidebar.classList.add('-translate-x-full');
conversationsSidebar.classList.remove('translate-x-0');
              conversationsToggle.setAttribute('aria-expanded', 'false');
          } else {
              // Open conversation sidebar
              conversationsSidebar.classList.add('sidebar-open');
              conversationsSidebar.classList.remove('hidden');
              conversationsSidebar.classList.add('translate-x-0');
conversationsSidebar.classList.remove('-translate-x-full');
              conversationsToggle.setAttribute('aria-expanded', 'true');
          }
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
  const chatContainer = document.getElementById('chat-container');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) return;

  const isMobile = window.innerWidth < 768;
  const isOpen = sidebar.classList.contains('sidebar-open');

  // Update sidebar width
  if (isMobile) {
    sidebar.style.width = '100%';
    if (chatContainer) chatContainer.classList.remove('md:ml-[384px]');
  } else {
    sidebar.style.width = '384px';
    if (isOpen && chatContainer) chatContainer.classList.add('md:ml-[384px]');
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
    sidebar.style.transform = 'translateX(0)';

    if (isMobile) {
      // Mobile-specific behavior
      if (overlay) overlay.classList.remove('hidden');
      // On mobile, don't adjust the chat container margin
      if (chatContainer) chatContainer.classList.remove('md:ml-[384px]');
    } else {
      // Desktop-specific behavior
       // if (chatContainer) chatContainer.classList.add('md:ml-[384px]');
       // Hide overlay on desktop
       // if (overlay) overlay.classList.add('hidden');
    }

    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'true');
  } else {
    // Hide sidebar
    sidebar.classList.remove('sidebar-open');
    // Force it offscreen again
    sidebar.style.transform = 'translateX(100%)';

     // if (overlay) overlay.classList.add('hidden');
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');
    // if (chatContainer) chatContainer.classList.remove('md:ml-[384px]');
  }

  // Publish sidebar state change event
  if (window.eventBus) {
    window.eventBus.publish('sidebarStateChange', { isOpen: show });
  }
}
