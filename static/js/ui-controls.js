window.addEventListener('DOMContentLoaded', () => {
  // Import the proper sidebar toggle function and set it globally
  import('./ui/sidebarManager.js').then(module => {
    // Set up direct access to toggleSidebar for inline handlers
    window.toggleConversationSidebar = function(show) {
      const sidebar = document.getElementById('conversations-sidebar');
      const isOpen = sidebar ? sidebar.classList.contains('sidebar-open') : false;
      
      // If show is undefined, toggle based on current state
      if (typeof show === 'undefined') {
        show = !isOpen;
      }
      
      console.log("[window.toggleConversationSidebar] called with show:", show);
      
      if (typeof module.toggleSidebar === 'function') {
        module.toggleSidebar('conversations-sidebar', show);
      } else if (typeof module.sidebarManager?.toggleSidebar === 'function') {
        module.sidebarManager.toggleSidebar('conversations-sidebar', show);
      } else {
        console.error("toggleSidebar function not found in sidebarManager module");
      }
    };
    
    // Initialize the sidebar functionality
    if (typeof module.initSidebar === 'function') {
      module.initSidebar();
    } else if (typeof module.sidebarManager?.initEventListeners === 'function') {
      module.sidebarManager.initEventListeners();
    }
    
  }).catch(err => {
    console.error("Error setting up conversation toggle:", err);
  });
  
  console.log("Sidebar functionality enhanced in ui-controls.js");

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    // Add Tailwind classes for better mobile UI and consistent styling
    themeToggle.classList.add('btn', 'btn-secondary', 'touch-target', 'active:scale-95');
    themeToggle.addEventListener('click', function () {
      console.log("Direct theme toggle clicked");
      document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });
  }

  // Token usage toggle
  document.getElementById('token-usage-toggle')?.addEventListener('click', function () {
      console.log("Direct token usage toggle clicked");
      const tokenDetails = document.getElementById('token-details');
      const tokenChevron = document.getElementById('token-chevron');
      if (tokenDetails && tokenChevron) {
          tokenDetails.classList.toggle('hidden');
          tokenChevron.classList.toggle('rotate-180');
      }
  });

  // Mobile stats toggle
  document.getElementById('mobile-stats-toggle')?.addEventListener('click', function () {
      console.log("Direct mobile stats toggle clicked");
      document.getElementById('mobile-stats-panel')?.classList.toggle('hidden');
  });

  // Sidebar tab handling
  document.querySelectorAll('[data-target-tab]').forEach(button => {
      button.addEventListener('click', function () {
          console.log("Direct tab button clicked:", this.getAttribute('data-target-tab'));

          // Collect tabs & content
          const allTabButtons = document.querySelectorAll('[data-target-tab]');
          const allTabContents = document.querySelectorAll('[role="tabpanel"]');

          // Remove active state from all tabs
          allTabButtons.forEach(btn => {
              btn.classList.remove('border-primary-500', 'text-primary-700', 'dark:text-primary-300');
              btn.classList.add('border-transparent', 'text-dark-500');
              btn.setAttribute('aria-selected', 'false');
          });

          // Hide all tab contents
          allTabContents.forEach(content => {
              content.classList.add('hidden');
              content.setAttribute('aria-hidden', 'true');
          });

          // Activate the clicked tab
          this.classList.remove('border-transparent', 'text-dark-500');
          this.classList.add('border-primary-500', 'text-primary-700', 'dark:text-primary-300');
          this.setAttribute('aria-selected', 'true');

          // Show the matching content
          const tabId = this.getAttribute('data-target-tab');
          const activeContent = document.getElementById(tabId);
          if (activeContent) {
              activeContent.classList.remove('hidden');
              activeContent.setAttribute('aria-hidden', 'false');
          }
      });
  });

  // Font size controls
  document.getElementById('font-size-up')?.addEventListener('click', () => {
      console.log("Direct font-size-up clicked");
      adjustFontSize(1);
  });

  document.getElementById('font-size-down')?.addEventListener('click', () => {
      console.log("Direct font-size-down clicked");
      adjustFontSize(-1);
  });

  document.getElementById('font-size-reset')?.addEventListener('dblclick', () => {
      console.log("Direct font-size-reset double-clicked");
      adjustFontSize(0);
  });

  document.getElementById('mobile-font-up')?.addEventListener('click', () => {
      console.log("Direct mobile-font-up clicked");
      adjustFontSize(1);
  });

  document.getElementById('mobile-font-down')?.addEventListener('click', () => {
      console.log("Direct mobile-font-down clicked");
      adjustFontSize(-1);
  });

  function adjustFontSize(direction) {
      console.log("Adjusting font size:", direction);
      const sizes = ['text-sm', 'text-base', 'text-lg', 'text-xl'];

      // Reset
      if (direction === 0) {
          document.documentElement.classList.remove(...sizes);
          document.documentElement.classList.add('text-base');
          localStorage.removeItem('fontSize');
          return;
      }

      let currentIndex = sizes.findIndex(sz => document.documentElement.classList.contains(sz));
      if (currentIndex === -1) currentIndex = 1; // default to text-base (index 1)
      const newIndex = Math.min(Math.max(currentIndex + direction, 0), sizes.length - 1);

      document.documentElement.classList.remove(...sizes);
      document.documentElement.classList.add(sizes[newIndex]);
      localStorage.setItem('fontSize', sizes[newIndex]);
  }

  console.log("✅ Direct event handlers attached in index.html");
});

// Ensure the sidebar close button works
const closeSidebarBtn = document.querySelector('.sidebar-close');
if (closeSidebarBtn) {
  closeSidebarBtn.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-overlay')?.classList.add('hidden');
    console.log("Sidebar close button clicked, sidebar hidden");
  });
}

// Re-attach theme toggle logic to handle any dynamic conflict
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    console.log("Re-confirming theme toggle clicked");
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  });
}
