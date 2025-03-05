// Simple direct event handlers for UI functionality
// Sidebar functionality has been moved to sidebarManager.js

// Add event handlers when the DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('UI-fix.js loaded - applying direct button handlers');
  
  // 1. Sidebar toggle is now handled by sidebarManager.js
  console.log('Sidebar functionality now handled by sidebarManager.js');
  
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
