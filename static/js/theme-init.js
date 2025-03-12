import { globalStore } from './store.js';

// theme-init.js

(function () {
  const storedTheme = globalStore.theme;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = storedTheme || (systemDark ? 'dark' : 'light');
  
  document.documentElement.classList.toggle('dark', initialTheme === 'dark');
  
  // Hide until ready to display (prevents a “flash” of incorrect theme)
  document.documentElement.classList.add('invisible');
  requestAnimationFrame(() => {
    document.documentElement.classList.remove('invisible');
  });
})();
