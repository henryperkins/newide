// Add to init.js or a separate debugging.js file
function addDebugConsole() {
  // Create debug console element
  const debugConsole = document.createElement('div');
  debugConsole.className = 'fixed bottom-0 left-0 right-0 bg-black/90 text-green-400 font-mono text-xs p-2 z-50 h-48 overflow-auto hidden';
  debugConsole.id = 'debug-console';
  document.body.appendChild(debugConsole);
  
  // Override console.log
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.log = function(...args) {
    originalLog.apply(console, args);
    appendToDebugConsole('log', args);
  };
  
  console.error = function(...args) {
    originalError.apply(console, args);
    appendToDebugConsole('error', args);
  };
  
  console.warn = function(...args) {
    originalWarn.apply(console, args);
    appendToDebugConsole('warn', args);
  };
  
  // Function to append to debug console
  function appendToDebugConsole(type, args) {
    const debugConsole = document.getElementById('debug-console');
    if (!debugConsole) return;
    
    const line = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    
    switch (type) {
      case 'error':
        line.className = 'text-red-400';
        break;
      case 'warn':
        line.className = 'text-yellow-400';
        break;
      default:
        line.className = 'text-green-400';
    }
    
    line.textContent = `[${timestamp}] [${type}] ${args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ')}`;
    
    debugConsole.appendChild(line);
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }
  
  // Toggle debug console with Shift+D (desktop) or four-finger tap (mobile)
  document.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'D') {
      const debugConsole = document.getElementById('debug-console');
      if (debugConsole) {
        debugConsole.classList.toggle('hidden');
      }
    }
  });
  
  // Mobile debug trigger with quadruple tap
  let tapCount = 0;
  let lastTap = 0;
  
  document.addEventListener('touchend', () => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    
    if (tapLength < 500) {
      tapCount++;
    } else {
      tapCount = 1;
    }
    
    lastTap = currentTime;
    
    if (tapCount >= 4) {
      const debugConsole = document.getElementById('debug-console');
      if (debugConsole) {
        debugConsole.classList.toggle('hidden');
      }
      tapCount = 0;
    }
  }, { passive: true });
}

// Call this early in initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addDebugConsole);
} else {
  addDebugConsole();
}

// Export the function if needed
export default addDebugConsole;