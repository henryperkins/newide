/**
 * Emergency fix for the sidebar toggle functionality
 */

(function() {
  // Run immediately when the script loads
  console.log("Loading emergency sidebar toggle fix...");
  
  // Function to directly toggle the sidebar without relying on the complex event system
  function toggleSidebarDirect(sidebarId) {
    console.log(`[DIRECT FIX] Toggling sidebar: ${sidebarId}`);
    const sidebar = document.getElementById(sidebarId);
    if (!sidebar) {
      console.error(`[DIRECT FIX] Sidebar with ID ${sidebarId} not found`);
      return;
    }
    
    const isOpen = sidebar.classList.contains('sidebar-open');
    const isLeft = sidebarId === 'conversations-sidebar';
    const isMobile = window.innerWidth < 768;
    const overlay = document.getElementById('sidebar-overlay');
    
    // Clear any transforms that might be causing issues
    sidebar.style.transform = '';
    
    if (isOpen) {
      // Hide the sidebar
      sidebar.classList.remove('sidebar-open');
      sidebar.classList.add(isLeft ? '-translate-x-full' : 'translate-x-full');
      sidebar.setAttribute('aria-hidden', 'true');
      
      document.body.classList.remove('overflow-hidden');
      if (overlay) {
        // Check if the other sidebar is open before hiding overlay
        const otherSidebar = document.getElementById(isLeft ? 'sidebar' : 'conversations-sidebar');
        const isOtherOpen = otherSidebar?.classList.contains('sidebar-open') || false;
        
        if (!isOtherOpen || !isMobile) {
          overlay.classList.add('hidden');
        }
      }
    } else {
      // Show the sidebar
      sidebar.classList.remove('hidden');
      sidebar.classList.remove(isLeft ? '-translate-x-full' : 'translate-x-full');
      sidebar.classList.add('sidebar-open');
      sidebar.setAttribute('aria-hidden', 'false');
      
      if (isMobile) {
        document.body.classList.add('overflow-hidden');
        if (overlay) {
          overlay.classList.remove('hidden');
        }
      }
    }
    
    console.log(`[DIRECT FIX] Sidebar ${sidebarId} ${isOpen ? 'closed' : 'opened'}`);
  }
  
  // Function to add direct handlers to the sidebars
  function addDirectSidebarHandlers() {
    console.log("[DIRECT FIX] Adding direct sidebar handlers");
    
    // Settings sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function directSidebarToggle(e) {
        e.preventDefault();
        console.log("[DIRECT FIX] Settings sidebar toggle clicked");
        toggleSidebarDirect('sidebar');
      });
    }
    
    // Close button in settings sidebar
    const closeSidebarBtn = document.getElementById('close-sidebar');
    if (closeSidebarBtn) {
      closeSidebarBtn.addEventListener('click', function directCloseSidebar(e) {
        e.preventDefault();
        console.log("[DIRECT FIX] Close sidebar button clicked");
        toggleSidebarDirect('sidebar');
      });
    }
    
    // Conversations sidebar toggle
    const conversationsToggle = document.getElementById('conversations-toggle');
    if (conversationsToggle) {
      conversationsToggle.addEventListener('click', function directConversationToggle(e) {
        e.preventDefault();
        console.log("[DIRECT FIX] Conversations sidebar toggle clicked");
        toggleSidebarDirect('conversations-sidebar');
      });
    }
    
    // Mobile conversations toggle
    const mobileConversationsToggle = document.getElementById('mobile-conversations-toggle');
    if (mobileConversationsToggle) {
      mobileConversationsToggle.addEventListener('click', function directMobileConversationToggle(e) {
        e.preventDefault();
        console.log("[DIRECT FIX] Mobile conversations toggle clicked");
        toggleSidebarDirect('conversations-sidebar');
      });
    }
    
    // Overlay click handler
    const overlay = document.getElementById('sidebar-overlay');
    if (overlay) {
      overlay.addEventListener('click', function directOverlayClick() {
        console.log("[DIRECT FIX] Overlay clicked");
        
        const rightSidebar = document.getElementById('sidebar');
        const leftSidebar = document.getElementById('conversations-sidebar');
        
        if (rightSidebar?.classList.contains('sidebar-open')) {
          toggleSidebarDirect('sidebar');
        }
        
        if (leftSidebar?.classList.contains('sidebar-open')) {
          toggleSidebarDirect('conversations-sidebar');
        }
      });
    }
    
    console.log("[DIRECT FIX] All direct sidebar handlers added successfully");
  }

  // When DOM is loaded, add our direct handlers
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addDirectSidebarHandlers);
  } else {
    // DOM already loaded, add handlers now
    addDirectSidebarHandlers();
  }
  
  // Also add as global function for use from console
  window.toggleSidebarDirect = toggleSidebarDirect;
  window.addDirectSidebarHandlers = addDirectSidebarHandlers;
})();
