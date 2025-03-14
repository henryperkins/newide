window.addEventListener('DOMContentLoaded', () => {
  // Add event listeners for sidebar and conversations toggles
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const closeSidebar = document.getElementById('close-sidebar');
  
  // Setup sidebar toggle
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      console.log("Sidebar toggle clicked");
      const isOpen = sidebar.classList.contains('translate-x-0');
      if (isOpen) {
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('translate-x-full');
        sidebarToggle.setAttribute('aria-expanded', 'false');
        if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
      } else {
        sidebar.classList.remove('hidden', 'translate-x-full');
        sidebar.classList.add('translate-x-0');
        sidebarToggle.setAttribute('aria-expanded', 'true');
        if (sidebarOverlay) {
          sidebarOverlay.classList.remove('hidden');
          sidebarOverlay.classList.add('fixed', 'inset-0', 'bg-dark-900', 'bg-opacity-50', 'z-40');
        }
      }
    });
  }
  
  // Setup close sidebar button
  if (closeSidebar && sidebar) {
    closeSidebar.addEventListener('click', () => {
      sidebar.classList.remove('translate-x-0');
      sidebar.classList.add('translate-x-full');
      if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
      if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
    });
  }
  
  // Setup conversations toggle
  const conversationsToggle = document.getElementById('conversations-toggle');
  const conversationsSidebar = document.getElementById('conversations-sidebar');
  
  if (conversationsToggle && conversationsSidebar) {
    conversationsToggle.addEventListener('click', () => {
      console.log("Conversations toggle clicked");
      const isOpen = !conversationsSidebar.classList.contains('-translate-x-full');
      if (isOpen) {
        conversationsSidebar.classList.add('-translate-x-full');
        conversationsSidebar.classList.remove('translate-x-0');
        conversationsToggle.setAttribute('aria-expanded', 'false');
      } else {
        conversationsSidebar.classList.remove('-translate-x-full');
        conversationsSidebar.classList.add('translate-x-0');
        conversationsToggle.setAttribute('aria-expanded', 'true');
      }
    });
  }
  
  // Setup mobile conversations toggle (for bottom nav)
  const mobileConversationsToggle = document.getElementById('mobile-conversations-toggle');
  if (mobileConversationsToggle && conversationsSidebar) {
    mobileConversationsToggle.addEventListener('click', () => {
      console.log("Mobile conversations toggle clicked");
      const isOpen = !conversationsSidebar.classList.contains('-translate-x-full');
      if (isOpen) {
        conversationsSidebar.classList.add('-translate-x-full');
        conversationsSidebar.classList.remove('translate-x-0');
        mobileConversationsToggle.setAttribute('aria-expanded', 'false');
      } else {
        conversationsSidebar.classList.remove('-translate-x-full');
        conversationsSidebar.classList.add('translate-x-0');
        mobileConversationsToggle.setAttribute('aria-expanded', 'true');
      }
    });
  }
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
