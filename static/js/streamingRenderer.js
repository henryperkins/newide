/**
 * Streaming content renderer with optimized DOM updates
 * Provides efficient rendering with minimal flickering
 */

/**
 * Updates HTML content with minimal DOM manipulation to reduce flickering
 * @param {HTMLElement} container - Target container element
 * @param {string} newHTML - New HTML content to render
 * @param {Object} options - Rendering options
 * @returns {void}
 */
export function renderContentEfficiently(container, newHTML, options = {}) {
  if (!container) return;
  
  // Store reference to previous HTML if not already stored
  if (!container.__previousHtml) {
    container.__previousHtml = "";
  }
  
  const oldHTML = container.__previousHtml;
  
  // Fast path: if content is identical, do nothing
  if (oldHTML === newHTML) return;
  
  // Incremental append: if new content starts with old content, just append the difference
  if (newHTML.startsWith(oldHTML)) {
    const remainder = newHTML.slice(oldHTML.length);
    if (remainder) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = remainder;
      
      // Use DocumentFragment for batch DOM operations
      const fragment = document.createDocumentFragment();
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      
      container.appendChild(fragment);
    }
  } 
  // Complete replacement: when content structure has changed
  else {
    container.innerHTML = newHTML;
  }
  
  // Update stored reference
  container.__previousHtml = newHTML;
  
  // Optional scroll behavior
  if (options.scroll) {
    container.scrollIntoView(options.scrollOptions || { behavior: 'smooth', block: 'end' });
  }
}

/**
 * Renders thinking container with toggle functionality
 * @param {HTMLElement} container - Thinking container element
 * @param {string} thinkingContent - Markdown content for thinking
 * @param {Object} processor - Markdown processor with markdownToHtml method
 */
export function renderThinkingContainer(container, thinkingContent, processor) {
  if (!container || !thinkingContent) return;
  
  const thinkingHTML = `
    <div class="thinking-container collapsible collapsed">
      <div class="thinking-header">
        <span class="toggle-icon">▶</span>
        Chain of Thought
      </div>
      <div class="thinking-content" style="display: none;">
        ${processor.markdownToHtml(thinkingContent || '')}
      </div>
    </div>
  `;
  
  // Only update if content has changed
  if (container.innerHTML !== thinkingHTML) {
    container.innerHTML = thinkingHTML;
    initializeThinkingToggle(container);
  }
}

/**
 * Initializes toggle functionality for thinking containers
 * @param {HTMLElement} container - Container with thinking content
 */
function initializeThinkingToggle(container) {
  if (!container) return;
  
  const thinkingContainer = container.querySelector('.thinking-container');
  if (!thinkingContainer) return;
  
  const header = thinkingContainer.querySelector('.thinking-header');
  const content = thinkingContainer.querySelector('.thinking-content');
  const toggleIcon = thinkingContainer.querySelector('.toggle-icon');
  
  if (header && content) {
    header.addEventListener('click', () => {
      const isCollapsed = thinkingContainer.classList.contains('collapsed');
      
      // Toggle classes
      thinkingContainer.classList.toggle('collapsed', !isCollapsed);
      thinkingContainer.classList.toggle('expanded', isCollapsed);
      
      // Update toggle icon
      if (toggleIcon) {
        toggleIcon.textContent = isCollapsed ? '▼' : '▶';
      }
      
      // Toggle content visibility
      content.style.display = isCollapsed ? 'block' : 'none';
      
      // Scroll into view if expanded
      if (isCollapsed) {
        setTimeout(() => {
          content.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      }
    });
  }
}
