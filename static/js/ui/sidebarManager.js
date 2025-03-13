/**
 * sidebarManager.js - Central module for all sidebar/menu functionality
 */

/**
 * Initialize the sidebar and mobile menu functionality
 */
  initEventListeners() {
    // Unified key handler for all sidebars
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openSidebars = Object.values(this.sidebars).filter(({element}) => 
          element.classList.contains('sidebar-open')
        );
        if (openSidebars.length > 0) {
          e.preventDefault();
          openSidebars.forEach(({element}) => this.close(element.id));
        }
      }
    });

    // Window resize handler
    window.addEventListener('resize', () => this.handleResponsive());
    
    // Initialize all sidebar toggle buttons
    Object.entries(this.sidebars).forEach(([position, {element, toggleButton, overlay}]) => {
      if (toggleButton) {
        toggleButton.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggle(element.id);
        });
      }

      if (overlay) {
        overlay.addEventListener('click', () => this.close(element.id));
      }
    });
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

  // Touch handling
  let touchStartX = 0;
  let touchStartTime = 0;
  const TOUCH_THRESHOLD = 30;
  const TOUCH_TIME_THRESHOLD = 500;

  sidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartTime = Date.now();
  }, { passive: true });

  sidebar.addEventListener('touchmove', (e) => {
    if (stateMachine.state.status !== 'open') return;
    
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - touchStartX;
    
    if (Math.abs(deltaX) > TOUCH_THRESHOLD) {
      const progress = Math.min(Math.abs(deltaX) / window.innerWidth, 1);
      sidebar.style.transform = `translate3d(${deltaX}px, 0, 0)`;
      overlay.style.opacity = 1 - progress;
    }
  }, { passive: true });

  sidebar.addEventListener('touchend', (e) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaTime = Date.now() - touchStartTime;
    
    if (Math.abs(deltaX) > TOUCH_THRESHOLD && deltaTime < TOUCH_TIME_THRESHOLD) {
      stateMachine.transition('closing');
      sidebar.style.transform = 'translate3d(100%, 0, 0)';
      overlay.style.opacity = 0;
    }
  }, { passive: true });

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
export class SidebarStateMachine {
  constructor() {
    this.state = {
      status: 'closed',
      position: 'right',
      lastUpdated: Date.now()
    };
    this.listeners = new Set();
  }

  transition(newState) {
    const validTransitions = {
      closed: ['opening'],
      opening: ['open', 'closed'],
      open: ['closing'],
      closing: ['closed', 'open']
    };

    if (validTransitions[this.state.status].includes(newState)) {
      this.state.status = newState;
      this.state.lastUpdated = Date.now();
      this._notifyStateChange();
      return true;
    }
    return false;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notifyStateChange() {
    this.listeners.forEach(listener => listener(this.state));
  }
}

class SidebarManager {
  constructor() {
    this.sidebars = {
      right: {
        element: document.getElementById('sidebar'),
        toggleButton: document.getElementById('sidebar-toggle'),
        overlay: document.getElementById('sidebar-overlay')
      },
      left: {
        element: document.getElementById('conversations-sidebar'),
        toggleButton: document.getElementById('conversations-toggle')
      }
    };
    
    this.initEventListeners();
    this.handleResponsive();
  }

  initEventListeners() {
    // Window resize handler
    window.addEventListener('resize', () => this.handleResponsive());
    
    // Touch event handlers
    Object.values(this.sidebars).forEach(({element}) => {
      if (element) {
        element.addEventListener('touchstart', this.handleTouchStart.bind(this), {passive: true});
        element.addEventListener('touchend', this.handleTouchEnd.bind(this), {passive: true});
      }
    });
  }

  handleTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
    this.touchStartTime = Date.now();
  }

  handleTouchEnd(e) {
    const deltaX = e.changedTouches[0].clientX - this.touchStartX;
    const deltaTime = Date.now() - this.touchStartTime;
    
    if (Math.abs(deltaX) > 30 && deltaTime < 500) {
      const sidebar = e.target.closest('.sidebar');
      if (sidebar) this.toggle(sidebar.id);
    }
  }

  handleResponsive() {
    const breakpoint = window.matchMedia('(min-width: 768px)');
    Object.values(this.sidebars).forEach(({element}) => {
      if (breakpoint.matches) {
        this.close(element.id);
        document.body.style.overflow = 'auto';
      }
    });
  }

  toggle(sidebarId) {
    const sidebar = this.sidebars[sidebarId === 'sidebar' ? 'right' : 'left'];
    const isOpen = sidebar.element.classList.contains('sidebar-open');
    
    if (isOpen) {
      this.close(sidebarId);
    } else {
      this.open(sidebarId);
    }
  }

  open(sidebarId) {
    const sidebar = this.sidebars[sidebarId === 'sidebar' ? 'right' : 'left'];
    sidebar.element.classList.remove('hidden', 'translate-x-full', '-translate-x-full');
    sidebar.element.classList.add('sidebar-open');
    sidebar.element.style.transform = 'translate3d(0, 0, 0)';
    sidebar.element.setAttribute('aria-hidden', 'false');
    
    if (sidebar.toggleButton) {
      sidebar.toggleButton.setAttribute('aria-expanded', 'true');
    }
    if (sidebar.overlay) {
      sidebar.overlay.classList.remove('hidden');
    }
    
    globalStore.sidebars[sidebarId === 'sidebar' ? 'settings' : 'conversations'].open = true;
    document.body.style.overflow = 'hidden';
  }

  close(sidebarId) {
    const sidebar = this.sidebars[sidebarId === 'sidebar' ? 'right' : 'left'];
    sidebar.element.classList.remove('sidebar-open');
    sidebar.element.style.transform = `translate3d(${sidebarId === 'sidebar' ? '100%' : '-100%'}, 0, 0)`;
    sidebar.element.setAttribute('aria-hidden', 'true');
    
    if (sidebar.toggleButton) {
      sidebar.toggleButton.setAttribute('aria-expanded', 'false');
    }
    if (sidebar.overlay) {
      sidebar.overlay.classList.add('hidden');
    }
    
    globalStore.sidebars[sidebarId === 'sidebar' ? 'settings' : 'conversations'].open = false;
    document.body.style.overflow = 'auto';
  }
}

// Initialize sidebar manager on load
export const sidebarManager = new SidebarManager();
  
  // Publish sidebar state change event
  if (window.eventBus) {
    window.eventBus.publish('sidebarStateChange', { isOpen: show });
  }

/*
 * Conversation sidebar logic is defined outside the toggleSidebar function
 */
export function initConversationSidebar() {
  console.log("Initializing conversation sidebar...");
  const toggleButton = document.getElementById('conversations-toggle');
  const sidebar = document.getElementById('conversations-sidebar');
  const overlay = document.getElementById('sidebar-overlay'); // Reuse the existing overlay if desired

  if (!sidebar) {
    console.error("Conversations sidebar element not found");
    return;
  }

  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      console.log("Conversations toggle clicked");
      const isOpen = sidebar.classList.contains('sidebar-open');
      toggleConversationSidebar(!isOpen);
    });
  }
}

export function toggleConversationSidebar(show) {
  console.log('toggleConversationSidebar:', show ? 'opening' : 'closing', 'conversations-sidebar');
  const sidebar = document.getElementById('conversations-sidebar');
  const toggleButton = document.getElementById('conversations-toggle');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar) return;

  const isMobile = window.innerWidth < 768;

  if (show) {
    // Show the sidebar
    sidebar.classList.remove('hidden', '-translate-x-full');
    sidebar.classList.add('translate-x-0', 'sidebar-open');
    document.body.classList.add('overflow-hidden');
    
    if (isMobile && overlay) {
      overlay.classList.remove('hidden');
      overlay.classList.add('block');
    }
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', 'true');
    }
  } else {
    // Hide the sidebar
    sidebar.classList.remove('translate-x-0', 'sidebar-open');
    sidebar.classList.add('-translate-x-full');
    document.body.classList.remove('overflow-hidden');
    
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', 'false');
    }
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.classList.remove('block');
    }
  }

  // Publish an event if needed (e.g. for external listeners)
  if (window.eventBus) {
    window.eventBus.publish('conversationSidebarStateChange', { isOpen: show });
  }
}
