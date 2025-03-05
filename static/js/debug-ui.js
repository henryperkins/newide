// UI Debug Panel - Helps verify that UI interactions are working correctly

(function() {
  // Create a debug panel that can be toggled with Ctrl+Shift+D
  function createDebugPanel() {
    // Create the panel
    const panel = document.createElement('div');
    panel.id = 'ui-debug-panel';
    panel.className = 'fixed bottom-4 left-4 bg-black/80 text-white p-4 rounded-lg shadow-lg z-50 max-w-md max-h-96 overflow-auto';
    panel.style.display = 'none';
    
    // Add header
    const header = document.createElement('h3');
    header.className = 'text-lg font-bold mb-2 flex justify-between items-center';
    header.innerHTML = 'UI Debug Panel <button class="px-2 bg-red-500 rounded text-xs">Close</button>';
    panel.appendChild(header);
    
    // Add content
    const content = document.createElement('div');
    content.id = 'ui-debug-content';
    content.className = 'space-y-3 text-sm';
    panel.appendChild(content);
    
    // Add test buttons
    const testSection = document.createElement('div');
    testSection.className = 'border-t border-gray-600 mt-4 pt-4';
    testSection.innerHTML = `
      <h4 class="font-bold mb-2">Test Buttons</h4>
      <div class="flex flex-wrap gap-2">
        <button class="test-btn px-2 py-1 bg-blue-600 rounded" data-target="sidebar-toggle">Test Sidebar</button>
        <button class="test-btn px-2 py-1 bg-blue-600 rounded" data-target="theme-toggle">Test Theme</button>
        <button class="test-btn px-2 py-1 bg-blue-600 rounded" data-target="token-usage-toggle">Test Token Panel</button>
        <button class="test-btn px-2 py-1 bg-blue-600 rounded" data-target="mobile-stats-toggle">Test Stats</button>
      </div>
    `;
    panel.appendChild(testSection);
    
    // Add event log
    const logSection = document.createElement('div');
    logSection.className = 'border-t border-gray-600 mt-4 pt-4';
    logSection.innerHTML = `
      <h4 class="font-bold mb-2">Event Log</h4>
      <div id="event-log" class="text-xs font-mono bg-black/40 p-2 rounded max-h-32 overflow-y-auto"></div>
    `;
    panel.appendChild(logSection);
    
    // Add to document
    document.body.appendChild(panel);
    
    // Setup close button
    const closeBtn = header.querySelector('button');
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });
    
    // Setup test buttons
    const testButtons = panel.querySelectorAll('.test-btn');
    testButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          logEvent(`Clicking "${targetId}"...`);
          targetEl.click();
          setTimeout(() => {
            logEvent(`Clicked "${targetId}" - check if action performed`);
          }, 100);
        } else {
          logEvent(`ERROR: Element "${targetId}" not found`);
        }
      });
    });
    
    return panel;
  }
  
  // Add an event to the log
  function logEvent(message) {
    const log = document.getElementById('event-log');
    if (!log) return;
    
    const entry = document.createElement('div');
    entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
    log.appendChild(entry);
    
    // Auto-scroll to bottom
    log.scrollTop = log.scrollHeight;
  }
  
  // Keyboard shortcut to show the panel (Ctrl+Shift+D)
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      const panel = document.getElementById('ui-debug-panel') || createDebugPanel();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      
      if (panel.style.display === 'block') {
        // Run verification when panel is opened
        verifyUIElements();
      }
    }
  });
  
  // Verify that all important UI elements exist
  function verifyUIElements() {
    const elements = [
      { id: 'sidebar-toggle', name: 'Sidebar Toggle' },
      { id: 'close-sidebar', name: 'Close Sidebar' },
      { id: 'theme-toggle', name: 'Theme Toggle' },
      { id: 'token-usage-toggle', name: 'Token Usage Toggle' },
      { id: 'mobile-stats-toggle', name: 'Mobile Stats Toggle' },
      { id: 'font-size-up', name: 'Font Size Up' },
      { id: 'font-size-down', name: 'Font Size Down' },
    ];
    
    elements.forEach(elem => {
      const el = document.getElementById(elem.id);
      if (el) {
        logEvent(`✅ ${elem.name} (${elem.id}) found`);
      } else {
        logEvent(`❌ ${elem.name} (${elem.id}) NOT FOUND`);
      }
    });
  }
  
  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('UI Debug: Press Ctrl+Shift+D to open debug panel');
    });
  } else {
    console.log('UI Debug: Press Ctrl+Shift+D to open debug panel');
  }
})();
