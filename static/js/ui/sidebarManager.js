// sidebarManager.js - Central module for all sidebar/menu functionality

import { globalStore } from '../store.js';
import { safeAddEventListener } from '../utils/eventManager.js';

/**
 * Initialize the sidebar and mobile menu functionality
 */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggleButton = document.getElementById('sidebar-toggle');

  setupCrossTabSync();
  const closeButton = document.getElementById('close-sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) return;
  
  // Initialize sidebar states in globalStore
  if (globalStore._sidebars) {
    // Set initial state based on CSS classes
    const rightSidebar = document.getElementById('sidebar');
    const leftSidebar = document.getElementById('conversations-sidebar');
    
    if (rightSidebar) {
      const isOpen = !rightSidebar.classList.contains('translate-x-full');
      globalStore._sidebars.settings.open = isOpen;
    }
    
    if (leftSidebar) {
      const isOpen = !leftSidebar.classList.contains('-translate-x-full');
      globalStore._sidebars.conversations.open = isOpen;
    }
    
    console.log("Initial sidebar state set in globalStore:", globalStore._sidebars);
  }

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

  safeAddEventListener(
    sidebar,
    'touchstart',
    'sidebarTouchStart',
    function sidebarTouchStartHandler(e) {
      touchStartX = e.touches[0].clientX;
      touchStartTime = Date.now();
    },
    { passive: true }
  );

  safeAddEventListener(
    sidebar,
    'touchmove',
    'sidebarTouchMove',
    function sidebarTouchMoveHandler(e) {
      const currentX = e.touches[0].clientX;
      const deltaX = currentX - touchStartX;

      if (Math.abs(deltaX) > TOUCH_THRESHOLD) {
        const progress = Math.min(Math.abs(deltaX) / window.innerWidth, 1);
        sidebar.style.transform = `translate3d(${deltaX}px, 0, 0)`;
        if (overlay) overlay.style.opacity = 1 - progress;
      }
    },
    { passive: true }
  );

  safeAddEventListener(
    sidebar,
    'touchend',
    'sidebarTouchEnd',
    function sidebarTouchEndHandler(e) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaTime = Date.now() - touchStartTime;

      if (Math.abs(deltaX) > TOUCH_THRESHOLD && deltaTime < TOUCH_TIME_THRESHOLD) {
        sidebar.style.transform = '';
        toggleSidebar('sidebar', false);
      } else {
        // Reset transform if not enough to trigger close
        sidebar.style.transform = '';
      }
    },
    { passive: true }
  );

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
  console.log("handleResponsive checking globalStore state:", globalStore._sidebars);
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

    // Use globalStore to determine if sidebar is open
    const isRightOpen =
      globalStore._sidebars &&
      globalStore._sidebars.settings &&
      globalStore._sidebars.settings.open;

    // Apply appropriate classes based on stored state
    if (isRightOpen) {
      rightSidebar.classList.remove('translate-x-full');
      rightSidebar.classList.add('translate-x-0');
    } else {
      rightSidebar.classList.add('translate-x-full');
      rightSidebar.classList.remove('translate-x-0');
    }

    // Update overlay visibility for right sidebar
    if (overlay && isRightOpen) {
      overlay.classList.toggle('hidden', !isMobile);
    }
  }

  if (leftSidebar) {
    // Remove any inline transform styles
    leftSidebar.style.transform = '';

    // Use Tailwind classes for width
    leftSidebar.classList.toggle('w-[85%]', isMobile);
    leftSidebar.classList.toggle('max-w-[320px]', isMobile);
    leftSidebar.classList.toggle('w-64', !isMobile);

    // Use globalStore to determine if sidebar is open
    const isLeftOpen =
      globalStore._sidebars &&
      globalStore._sidebars.conversations &&
      globalStore._sidebars.conversations.open;

    // Apply appropriate classes based on stored state
    if (isLeftOpen) {
      leftSidebar.classList.remove('-translate-x-full');
      leftSidebar.classList.add('translate-x-0');
    } else {
      leftSidebar.classList.add('-translate-x-full');
      leftSidebar.classList.remove('translate-x-0');
    }

    // Update overlay visibility for left sidebar
    if (overlay && isLeftOpen) {
      overlay.classList.toggle('hidden', !isMobile);
    }
  }

  // If neither sidebar is open, ensure overlay is hidden
  if (overlay) {
    // Use globalStore to determine if sidebars are open
    const rightOpen =
      globalStore._sidebars &&
      globalStore._sidebars.settings &&
      globalStore._sidebars.settings.open;
    const leftOpen =
      globalStore._sidebars &&
      globalStore._sidebars.conversations &&
      globalStore._sidebars.conversations.open;

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
  const toggleButton = document.getElementById(
    sidebarId === 'sidebar' ? 'sidebar-toggle' : 'conversations-toggle'
  );
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) {
    console.error(`Sidebar with ID ${sidebarId} not found`);
    return;
  }

  // Update globalStore state
  const storeKey = sidebarId === 'sidebar' ? 'settings' : 'conversations';
  if (globalStore._sidebars && globalStore._sidebars[storeKey]) {
    globalStore._sidebars[storeKey].open = show;
    globalStore._sidebars[storeKey].lastInteraction = Date.now();
    console.log(`Sidebar state updated in globalStore: ${storeKey} = ${show}`);
  }

  const isLeft = sidebarId === 'conversations-sidebar';
  const isMobile = window.innerWidth < 768;

  // Remove any inline transform styles first
  sidebar.style.transform = '';
  
  // CRITICAL FIX: Force visibility with fixed class management
  if (show) {
    // First remove hidden class
    sidebar.classList.remove('hidden');
    
    // Critical: Force the DOM to perform layout calculations
    void sidebar.offsetWidth;
    
    // Then update transform classes - this is the crucial fix
    if (isLeft) {
      sidebar.classList.remove('-translate-x-full');
    } else {
      sidebar.classList.remove('translate-x-full');
    }
    sidebar.classList.add('translate-x-0');
    sidebar.setAttribute('aria-hidden', 'false');
    
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', 'true');
    }
    
    // Show overlay on mobile
    if (isMobile && overlay) {
      overlay.classList.remove('hidden');
    }
  } else {
    if (isLeft) {
      sidebar.classList.add('-translate-x-full');
    } else {
      sidebar.classList.add('translate-x-full');
    }
    sidebar.classList.remove('translate-x-0');
    sidebar.setAttribute('aria-hidden', 'true');
    
    // Hide overlay if both sidebars are closed
    const otherSidebarId = isLeft ? 'sidebar' : 'conversations-sidebar';
    const otherSidebar = document.getElementById(otherSidebarId);
    const isOtherSidebarOpen = otherSidebar && 
      ((isLeft && !otherSidebar.classList.contains('translate-x-full')) ||
       (!isLeft && !otherSidebar.classList.contains('-translate-x-full')));
       
    if (isMobile && overlay && !isOtherSidebarOpen) {
      overlay.classList.add('hidden');
    }
  }

  console.log(`Sidebar ${sidebarId} ${show ? 'opened' : 'closed'}`);
}

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

function setupCrossTabSync() {
  window.addEventListener('storage', (event) => {
    if (event.key === 'globalStore') {
      const newState = JSON.parse(event.newValue);
      if (newState._sidebars) {
        globalStore._sidebars = newState._sidebars;
        handleResponsive();
      }
    }
  });
}

// For backward compatibility
export { initSidebar, initConversationSidebar };
export function toggleConversationSidebar(show) {
  return toggleSidebar('conversations-sidebar', show);
}
