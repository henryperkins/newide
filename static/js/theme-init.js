// theme-init.js

(function () {
  const storedTheme = localStorage.getItem('theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = storedTheme || (systemDark ? 'dark' : 'light');
  
  document.documentElement.classList.toggle('dark', initialTheme === 'dark');
  
  // Hide until ready to display (prevents a “flash” of incorrect theme)
  document.documentElement.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    document.documentElement.style.visibility = 'visible';
  });
})();
