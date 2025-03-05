// tabManager.js - Handles tab switching with Tailwind CSS

/**
 * Initializes the tab functionality with improved mobile support
 */
export function initTabSystem() {
  console.log("initTabSystem() is being called"); // Debug log
  const tabButtons = document.querySelectorAll('[data-target-tab]');
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  // Initialize tab click handlers first
  tabButtons.forEach(button => {
    button.addEventListener('click', () => handleTabChange(button));
  });
  
  // Updated button classes
  if (isMobile) {
    tabButtons.forEach(button => {
      button.classList.add('tab-button');
      
      if (button.getAttribute('aria-selected') === 'true') {
        button.classList.add('tab-active');
      } else {
        button.classList.add('tab-inactive');
      }
    });
  }
  
  // Add arrow-key navigation
  tabButtons.forEach((button, index) => {
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextBtn = tabButtons[(index + 1) % tabButtons.length];
        nextBtn.focus();
        handleTabChange(nextBtn);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevBtn = tabButtons[(index - 1 + tabButtons.length) % tabButtons.length];
        prevBtn.focus();
        handleTabChange(prevBtn);
      }
    });
  });
}

/**
 * Handles changing the active tab with improved mobile classes
 * @param {HTMLElement} clickedTab The tab button that was clicked
 */
function handleTabChange(clickedTab) {
  const tabId = clickedTab.getAttribute('data-target-tab');
  if (!tabId) return;
  
  // Get all tab buttons and content panels
  const allTabButtons = document.querySelectorAll('[data-target-tab]');
  const allTabContents = document.querySelectorAll('[role="tabpanel"]');
  
  // Deactivate all tabs
  allTabButtons.forEach(button => {
    // Remove active styles and add inactive styles
    button.classList.remove('border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400', 'tab-active');
    button.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200', 'tab-inactive');
    button.setAttribute('aria-selected', 'false');
  });
  
  // Hide all tab contents
  allTabContents.forEach(content => {
    content.classList.add('hidden');
    content.setAttribute('aria-hidden', 'true');
  });
  
  // Activate clicked tab
  clickedTab.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200', 'tab-inactive');
  clickedTab.classList.add('border-blue-600', 'text-blue-600', 'dark:text-blue-400', 'dark:border-blue-400', 'tab-active');
  clickedTab.setAttribute('aria-selected', 'true');
  
  // Show corresponding content
  const activeContent = document.getElementById(tabId);
  if (activeContent) {
    activeContent.classList.remove('hidden');
    activeContent.setAttribute('aria-hidden', 'false');
  }
}

// Sidebar functionality has been moved to sidebarManager.js

// Import the toggleSidebar function for use in this module
import { toggleSidebar } from './sidebarManager.js';

/**
 * Public method to select a specific tab by ID
 * @param {string} tabId The ID of the tab content to activate
 */
export function activateTab(tabId) {
  const tabButton = document.querySelector(`[data-target-tab="${tabId}"]`);
  if (tabButton) {
    handleTabChange(tabButton);
  }
}

// toggleSidebar is now imported from sidebarManager.js
