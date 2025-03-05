// Simple direct event handlers for UI functionality

// Add event handlers when the DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('UI-fix.js loaded - applying direct button handlers');
  
  // 1. Make the cogwheel (sidebar toggle) button work
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', function() {
      console.log('Sidebar toggle clicked');
      const isClosed = sidebar.classList.contains('translate-x-full');
      
      // Toggle sidebar visibility
      if (isClosed) {
        sidebar.classList.remove('translate-x-full');
        sidebar.classList.add('translate-x-0');
        sidebarToggle.setAttribute('aria-expanded', 'true');
        if (overlay) overlay.classList.remove('hidden');
      } else {
        sidebar.classList.add('translate-x-full');
        sidebar.classList.remove('translate-x-0');
        sidebarToggle.setAttribute('aria-expanded', 'false');
        if (overlay) overlay.classList.add('hidden');
      }
    });
  }
  
  // Also make the close button work in the sidebar
  const closeButton = document.getElementById('close-sidebar');
  if (closeButton && sidebar) {
    closeButton.addEventListener('click', function() {
      sidebar.classList.add('translate-x-full');
      sidebar.classList.remove('translate-x-0');
      if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
      if (overlay) overlay.classList.add('hidden');
    });
  }
  
  // Make the overlay close the sidebar when clicked
  if (overlay && sidebar) {
    overlay.addEventListener('click', function() {
      sidebar.classList.add('translate-x-full');
      sidebar.classList.remove('translate-x-0');
      if (sidebarToggle) sidebarToggle.setAttribute('aria-expanded', 'false');
      overlay.classList.add('hidden');
    });
  }
  
  // 2. Make the stats icon toggle work
  const statsToggle = document.getElementById('mobile-stats-toggle');
  const statsPanel = document.getElementById('mobile-stats-panel');
  
  if (statsToggle && statsPanel) {
    statsToggle.addEventListener('click', function() {
      console.log('Stats toggle clicked');
      statsPanel.classList.toggle('hidden');
    });
  }
  
  // 3. Make the token usage toggle work
  const tokenToggle = document.getElementById('toggle-token-details');
  const tokenDetails = document.getElementById('token-details');
  const tokenChevron = document.getElementById('token-chevron');
  
  if (tokenToggle && tokenDetails && tokenChevron) {
    tokenToggle.addEventListener('click', function() {
      console.log('Token usage toggle clicked');
      tokenDetails.classList.toggle('hidden');
      tokenChevron.classList.toggle('rotate-180');
      localStorage.setItem('tokenDetailsVisible', !tokenDetails.classList.contains('hidden'));
    });
    
    // Apply saved preference
    const tokenDetailsVisible = localStorage.getItem('tokenDetailsVisible') === 'true';
    if (tokenDetailsVisible) {
      tokenDetails.classList.remove('hidden');
      tokenChevron.classList.add('rotate-180');
    }
  }
});
