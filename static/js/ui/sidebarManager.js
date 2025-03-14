/**
 * sidebarManager.js - Central module for all sidebar/menu functionality
 */

import { safeAddEventListener } from '../utils/eventManager.js';

/**
 * Initialize the sidebar and mobile menu functionality
 */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggleButton = document.getElementById('sidebar-toggle');
  const closeButton = document.getElementById('close-sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) return;

  // Sidebar toggle button
  if (toggleButton) {
    safeAddEventListener(toggleButton, 'click', 'toggleSidebar', function toggleSidebarHandler() {
      console.log("Sidebar toggle button clicked");
      // Use translation property to detect if sidebar is open
      const isOpen = !sidebar.classList.contains('translate-x-full');
      toggleSidebar('sidebar', !isOpen);
    });
  }

  // Close button in sidebar
  if (closeButton) {
    safeAddEventListener(closeButton, 'click', 'closeSidebar', function closeSidebarHandler() {
      toggleSidebar('sidebar', false);
    });
  }

  // Touch handling
  let touchStartX = 0;
  let touchStartTime = 0;
  const TOUCH_THRESHOLD = 30;
  const TOUCH_TIME_THRESHOLD = 500;

  safeAddEventListener(sidebar, 'touchstart', 'sidebarTouchStart', function sidebarTouchStartHandler(e) {
    touchStartX = e.touches[0].clientX;
    touchStartTime = Date.now();
  }, { passive: true });

  safeAddEventListener(sidebar, 'touchmove', 'sidebarTouchMove', function sidebarTouchMoveHandler(e) {
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchStartX;
    
    if (Math.abs(deltaX) > TOUCH_THRESHOLD) {
      const progress = Math.min(Math.abs(deltaX) / window.innerWidth, 1);
      sidebar.style.transform = `translate3d(${deltaX}px, 0, 0)`;
      if (overlay) overlay.style.opacity = 1 - progress;
    }
  }, { passive: true });

  safeAddEventListener(sidebar, 'touchend', 'sidebarTouchEnd', function sidebarTouchEndHandler(e) {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaTime = Date.now() - touchStartTime;
    
    if (Math.abs(deltaX) > TOUCH_THRESHOLD && deltaTime < TOUCH_TIME_THRESHOLD) {
      sidebar.style.transform = '';
      toggleSidebar('sidebar', false);
    } else {
      // Reset transform if not enough to trigger close
      sidebar.style.transform = '';
    }
  }, { passive: true });

  // Register keyboard shortcut (ESC to close sidebar)
  safeAddEventListener(document, 'keydown', 'escCloseSidebar', function escCloseSidebarHandler(e) {
    if (e.key === 'Escape') {
      const rightSidebar = document.getElementById('sidebar');
      const leftSidebar = document.getElementById('conversations-sidebar');
      
      // Use translation property to detect if sidebar is open
      if (rightSidebar && !rightSidebar.classList.contains('translate-x-full')) {
        toggleSidebar('sidebar', false);
      } else if (leftSidebar && !leftSidebar.classList.contains('-translate-x-full')) {
        toggleSidebar('conversations-sidebar', false);
      }
    }
  });

  // Initialize conversation sidebar
  initConversationSidebar();

  // Initially set proper sidebar state based on viewport
  handleResponsive();

  // Listen for resize events to adjust sidebar
  window.addEventListener('resize', handleResponsive);
}

/**
 * Handle window resize events to maintain proper sidebar state
 */
function handleResponsive() {
  const isMobile = window.innerWidth < 768;
  
  // Update sidebar dimensions
  const rightSidebar = document.getElementById('sidebar');
  const leftSidebar = document.getElementById('conversations-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  
  if (rightSidebar) {
    // Remove any inline transform styles
    rightSidebar.style.transform = '';
    
    // Use Tailwind classes for width
    rightSidebar.classList.toggle('w-full', isMobile);
    rightSidebar.classList.toggle('w-96', !isMobile);
    
    // Use translation property to detect if sidebar is open
    const isRightOpen = !rightSidebar.classList.contains('translate-x-full');
    
    // Update overlay visibility for right sidebar
    if (overlay && isRightOpen) {
      overlay.classList.toggle('hidden', !isMobile);
    }
  }
  
  if (leftSidebar) {
    // Remove any inline transform styles
    leftSidebar.style.transform = '';
    
    // Use Tailwind classes for width
    leftSidebar.classList.toggle('w-full', isMobile);
    leftSidebar.classList.toggle('w-64', !isMobile);
    
    // Use translation property to detect if sidebar is open
    const isLeftOpen = !leftSidebar.classList.contains('-translate-x-full');
    
    // Update overlay visibility for left sidebar
    if (overlay && isLeftOpen) {
      overlay.classList.toggle('hidden', !isMobile);
    }
  }
  
  // If neither sidebar is open, ensure overlay is hidden
  if (overlay) {
    // Use translation property to detect if sidebar is open
    const rightOpen = rightSidebar && !rightSidebar.classList.contains('translate-x-full');
    const leftOpen = leftSidebar && !leftSidebar.classList.contains('-translate-x-full');
    
    if (!rightOpen && !leftOpen) {
      overlay.classList.add('hidden');
    } else if (isMobile && (rightOpen || leftOpen)) {
      overlay.classList.remove('hidden');
    }
  }
}

/**
 * Centralized function to toggle any sidebar visibility
 * @param {string} sidebarId - ID of the sidebar element ('sidebar' or 'conversations-sidebar')
 * @param {boolean} show - Whether to show the sidebar (true) or hide it (false)
 */
export function toggleSidebar(sidebarId, show) {
  console.log(`toggleSidebar: ${sidebarId}, show: ${show}`);
  const sidebar = document.getElementById(sidebarId);
  const toggleButton = document.getElementById(sidebarId === 'sidebar' ? 'sidebar-toggle' : 'conversations-toggle');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) {
    console.error(`Sidebar with ID ${sidebarId} not found`);
    return;
  }

  const isLeft = sidebarId === 'conversations-sidebar';
  const isMobile = window.innerWidth < 768;

  // Remove any inline transform styles first
  sidebar.style.transform = '';

  if (show) {
    // Show the sidebar - first remove hidden class
    sidebar.classList.remove('hidden');

    // Use setTimeout to ensure DOM updates before changing transform
    setTimeout(() => {
      sidebar.classList.remove(isLeft ? '-translate-x-full' : 'translate-x-full');
      sidebar.setAttribute('aria-hidden', 'false');

      if (toggleButton) {
        toggleButton.setAttribute('aria-expanded', 'true');
      }

      if (isMobile) {
        document.body.classList.add('overflow-hidden');
        if (overlay) {
          overlay.classList.remove('hidden');
        }
      }
    }, 10); // Very short timeout to ensure DOM updates
  } else {
    // Hide the sidebar
    sidebar.classList.add(isLeft ? '-translate-x-full' : 'translate-x-full');
    sidebar.setAttribute('aria-hidden', 'true');

    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', 'false');
    }

    document.body.classList.remove('overflow-hidden');
    if (overlay) {
      // Check if the other sidebar is open before hiding overlay
      const otherSidebar = document.getElementById(isLeft ? 'sidebar' : 'conversations-sidebar');
      const isOtherOpen = otherSidebar && (isLeft
        ? !otherSidebar.classList.contains('translate-x-full')
        : !otherSidebar.classList.contains('-translate-x-full'));

      if (!isOtherOpen || !isMobile) {
        overlay.classList.add('hidden');
      }
    }
  }

  // Publish sidebar state change event
  if (window.eventBus) {
    window.eventBus.publish('sidebarStateChange', {
      id: sidebarId,
      isOpen: show
    });
  }

  console.log(`Sidebar ${sidebarId} ${show ? 'opened' : 'closed'}`);
}

// Export for external use
export const sidebarManager = {
  toggleSidebar,
  handleResponsive,
  initEventListeners: initSidebar
};

/**
 * Initialize the conversation sidebar
 */
function initConversationSidebar() {
  console.log("Initializing conversation sidebar...");
  const toggleButton = document.getElementById('conversations-toggle');
  const mobileToggleButton = document.getElementById('mobile-conversations-toggle');
  const sidebar = document.getElementById('conversations-sidebar');

  if (!sidebar) {
    console.error("Conversations sidebar element not found");
    return;
  }

  // Set up header toggle button
  if (toggleButton) {
    safeAddEventListener(toggleButton, 'click', 'toggleConversationSidebar', function toggleConversationHandler() {
      console.log("Conversations toggle clicked");
      // Use translation property to detect if sidebar is open
      const isOpen = !sidebar.classList.contains('-translate-x-full');
      toggleSidebar('conversations-sidebar', !isOpen);
    });
  }
  
  // Set up mobile toggle button
  if (mobileToggleButton) {
    safeAddEventListener(mobileToggleButton, 'click', 'mobileToggleConversationSidebar', function mobileToggleHandler(e) {
      e.preventDefault();
      console.log("Mobile conversations toggle clicked");
      // Use translation property to detect if sidebar is open
      const isOpen = !sidebar.classList.contains('-translate-x-full');
      toggleSidebar('conversations-sidebar', !isOpen);
    });
  }
  
  // Set up overlay click to close sidebar
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    safeAddEventListener(overlay, 'click', 'overlayClickClose', function overlayClickHandler() {
      const rightSidebar = document.getElementById('sidebar');
      const leftSidebar = document.getElementById('conversations-sidebar');
      
      // Use translation property to detect if sidebar is open
      if (rightSidebar && !rightSidebar.classList.contains('translate-x-full')) {
        toggleSidebar('sidebar', false);
      }
      
      if (leftSidebar && !leftSidebar.classList.contains('-translate-x-full')) {
        toggleSidebar('conversations-sidebar', false);
      }
    });
  }
}

// For backward compatibility
export function toggleConversationSidebar(show) {
  return toggleSidebar('conversations-sidebar', show);
}

// Initialize the module
// Export the initSidebar function directly for imports that use it
export { initSidebar, initConversationSidebar };
