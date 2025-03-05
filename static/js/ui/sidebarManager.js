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
      const isClosed = sidebar.classList.contains('translate-x-full');
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
    if (e.key === 'Escape' && sidebar && !sidebar.classList.contains('translate-x-full')) {
      toggleSidebar(false);
    }
  });
  
  // Initially hide sidebar on mobile if needed
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    sidebar.classList.add('translate-x-full');
    sidebar.classList.remove('translate-x-0');
    if (toggleButton) toggleButton.setAttribute('aria-expanded', 'false');
    if (overlay) overlay.classList.add('hidden');
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
  
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  
  if (show) {
    // Show sidebar
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
    // Hide sidebar
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