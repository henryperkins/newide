// themeswitcher.js - Handles dark/light mode using Tailwind's class-based approach

/**
 * Initializes the theme toggling functionality
 */
export function initThemeSwitcher() {
  // Create the theme toggle button if it doesn't exist
  createThemeToggleIfNeeded();
  
  // Set initial theme based on saved preference or system preference
  setInitialTheme();
  
  // Listen for theme toggle clicks
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
}

/**
 * Creates the theme toggle button if it doesn't already exist
 */
function createThemeToggleIfNeeded() {
  if (document.getElementById('theme-toggle')) return;
  
  const header = document.querySelector('header');
  if (!header) return;
  
  const themeToggleButton = document.createElement('button');
  themeToggleButton.id = 'theme-toggle';
  themeToggleButton.className = 'w-10 h-6 rounded-full bg-gray-200 dark:bg-gray-700 relative transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500';
  themeToggleButton.setAttribute('aria-label', 'Toggle dark mode');
  themeToggleButton.setAttribute('aria-pressed', document.documentElement.classList.contains('dark') ? 'true' : 'false');
  
  // Create the toggle knob
  const toggleKnob = document.createElement('span');
  toggleKnob.className = 'absolute left-1 top-1 bg-white dark:bg-gray-200 w-4 h-4 rounded-full transition-transform duration-200 ease-in-out transform dark:translate-x-4';
  toggleKnob.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-yellow-500 dark:text-gray-800" viewBox="0 0 20 20" fill="currentColor">' +
                          '<path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd" />' +
                          '</svg>';
  
  themeToggleButton.appendChild(toggleKnob);
  
  // Add a container to position the toggle in the header
  const toggleContainer = document.createElement('div');
  toggleContainer.className = 'flex items-center ml-auto'; // ml-auto will push it to the right
  toggleContainer.appendChild(themeToggleButton);
  
  // Add to the header, before the performance stats if they exist
  const performanceStats = header.querySelector('.performance-stats');
  if (performanceStats) {
    header.insertBefore(toggleContainer, performanceStats);
  } else {
    header.appendChild(toggleContainer);
  }
}

/**
 * Sets the initial theme based on saved preference or system preference
 */
function setInitialTheme() {
  // Check for saved preference
  const savedTheme = localStorage.getItem('theme');
  
  if (savedTheme === 'dark' || savedTheme === 'dracula') {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dracula');
  } else if (savedTheme === 'light') {
    document.documentElement.classList.remove('dark');
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    // If no saved preference, check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dracula');
    }
  }
  
  // Update the toggle button appearance
  updateToggleAppearance();
}

/**
 * Toggles between light and dark themes
 */
function toggleTheme() {
  // Toggle the 'dark' class on the html element
  document.documentElement.classList.toggle('dark');
  
  // Store the preference in localStorage
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('theme', isDark ? 'dracula' : 'light');
  
  // Update data-theme attribute
  document.documentElement.setAttribute('data-theme', isDark ? 'dracula' : 'light');
  
  // Update aria-pressed state for accessibility
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  }
  
  // Update toggle appearance
  updateToggleAppearance();
  
  // Announce theme change for screen readers
  announceThemeChange(isDark);

  // Dispatch an event for other components to react to theme changes
  document.dispatchEvent(new CustomEvent('themeChanged', { detail: { isDark } }));
}

/**
 * Updates the appearance of the toggle button based on current theme
 */
function updateToggleAppearance() {
  const themeToggle = document.getElementById('theme-toggle');
  if (!themeToggle) return;
  
  const isDark = document.documentElement.classList.contains('dark');
  const sunIcon = themeToggle.querySelector('.h-5.w-5:first-child');
  const moonIcon = themeToggle.querySelector('.h-5.w-5:last-child');
  
  if (sunIcon && moonIcon) {
    if (isDark) {
      // Dark mode: show sun icon, hide moon icon
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    } else {
      // Light mode: hide sun icon, show moon icon
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }
}

/**
 * Announces theme change for screen readers
 */
function announceThemeChange(isDark) {
  const announcement = document.createElement('div');
  announcement.setAttribute('aria-live', 'polite');
  announcement.classList.add('sr-only');
  announcement.textContent = `Theme changed to ${isDark ? 'dark' : 'light'} mode`;
  
  document.body.appendChild(announcement);
  
  // Remove the announcement after it's been read
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 3000);
}

/**
 * Listen for system theme preference changes
 */
function listenForSystemThemeChanges() {
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      // Only change theme if user hasn't set a preference
      if (!localStorage.getItem('theme')) {
        document.documentElement.classList.toggle('dark', e.matches);
        updateToggleAppearance();
      }
    });
  }
}

// Export the toggleTheme function so it can be used elsewhere
export { toggleTheme };

// Initialize theme system when the module is loaded
listenForSystemThemeChanges();
