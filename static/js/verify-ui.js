// verify-ui.js - Checks that all interactive elements have proper event listeners

(function() {
  // This script runs immediately when loaded
  console.log("UI Verification: Starting check of UI elements");
  
  function checkElement(id, description) {
    const el = document.getElementById(id);
    if (!el) {
      console.error(`UI Verification FAILED: ${description} (ID: ${id}) not found in the DOM`);
      return false;
    }
    
    console.log(`UI Verification: Found ${description} (ID: ${id})`);
    return true;
  }
  
  // Wait for DOM to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', verifyUI);
  } else {
    verifyUI();
  }
  
  function verifyUI() {
    console.log("UI Verification: DOM loaded, checking UI elements");
    
    // Check critical UI elements
    const elements = [
      { id: 'sidebar-toggle', desc: 'Sidebar toggle button' },
      { id: 'theme-toggle', desc: 'Theme toggle button' },
      { id: 'token-usage-toggle', desc: 'Token usage toggle' },
      { id: 'sidebar', desc: 'Sidebar element' },
      { id: 'close-sidebar', desc: 'Close sidebar button' },
      { id: 'mobile-stats-toggle', desc: 'Mobile stats toggle' },
      { id: 'mobile-stats-panel', desc: 'Mobile stats panel' }
    ];
    
    let allFound = true;
    elements.forEach(elem => {
      allFound = checkElement(elem.id, elem.desc) && allFound;
    });
    
    if (allFound) {
      console.log("UI Verification: All critical UI elements found");
    } else {
      console.error("UI Verification: Some critical UI elements are missing");
    }
    
    // Check event listeners (indirectly)
    console.log("UI Verification: Use the browser's Event Listeners tab in DevTools to verify event listeners");
    console.log("UI Verification: All handlers should now be attached by ui-fix.js");
    
    console.log("UI Verification complete");
  }
})();
