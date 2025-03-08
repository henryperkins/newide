/**
 * streamingRenderer.js
 *
 * Minimal content renderer for streaming updates, avoiding excessive reflows/flicker.
 */

/**
 * Updates HTML content with minimal DOM manipulation to reduce flickering.
 * Used by streaming.js to incrementally render text into the message container.
 *
 * @param {HTMLElement} container - Target container element
 * @param {string} newHTML - New HTML content to render
 * @param {Object} options - Rendering options (e.g., scroll behavior)
 */
// In streamingRenderer.js
export function renderContentEfficiently(container, newHTML, options = {}) {
  if (!container) {
    console.error('[renderContentEfficiently] No container provided!');
    return;
  }

  // Store a reference to previous HTML
  if (typeof container.__previousHtml === 'undefined') {
    container.__previousHtml = '';
  }

  const oldHTML = container.__previousHtml;

  // If content is identical, do nothing
  if (oldHTML === newHTML) return;

  try {
    // CRITICAL FIX: Always apply visible styles to ensure container is shown
    container.style.display = 'block';
    container.style.minHeight = '20px';
    container.style.opacity = '1';
    container.style.visibility = 'visible';
    
    // For incremental updates: if new content starts with old content, just append the remainder
    if (newHTML.startsWith(oldHTML)) {
      const remainder = newHTML.slice(oldHTML.length);
      if (remainder) {
        // Log the remainder to help with debugging
        console.log('[renderContentEfficiently] Appending remainder:', 
          remainder.length, 'chars', 
          remainder.substring(0, 20) + '...');
        
        // SIMPLER DIRECT APPROACH
        // Check if we're dealing with HTML content
        if (/<[a-z][\s\S]*>/i.test(remainder)) {
          // For HTML content
          container.innerHTML = newHTML; // Use full content to avoid HTML parsing issues
        } else {
          // For plain text, direct append is more efficient
          if (container.textContent === oldHTML) {
            container.textContent = newHTML;
          } else {
            // Fallback if textContent doesn't match our reference
            container.innerHTML = newHTML;
          }
        }

        console.log('[renderContentEfficiently] Appended new content');
      }
    } else {
      // Full content replace (this part was working correctly)
      console.log('[renderContentEfficiently] Full content replace');

      // Make sure the container is visible and has width/height
      container.style.display = 'block';
      container.style.minHeight = '20px';

      // Use appropriate method based on content type
      // FIXED: Don't limit by content length - render the full content regardless of size
      if (!/<[a-z][\s\S]*>/i.test(newHTML)) {
        container.textContent = newHTML;
        console.log(`[renderContentEfficiently] Rendered ${newHTML.length} chars as text`);
      } else {
        container.innerHTML = newHTML;
        console.log(`[renderContentEfficiently] Rendered ${newHTML.length} chars as HTML`);
      }
    }

    // CRITICAL FIX: Force container to be visible after content update
    container.style.display = 'block';
    
    // Update stored HTML reference
    container.__previousHtml = newHTML;

    // Optional scroll behavior remains unchanged
    if (options.scroll) {
      const chatHistory = document.getElementById('chat-history');
      if (chatHistory) {
        requestAnimationFrame(() => {
          chatHistory.scrollTo({
            top: chatHistory.scrollHeight,
            ...options.scrollOptions
          });
        });
      }
    }
    
    // CRITICAL FIX: Verify content is not empty after rendering
    if (container.innerHTML === '' && newHTML !== '') {
      console.warn('[renderContentEfficiently] Container is empty despite having content to render!');
      // Force fallback rendering
      container.textContent = newHTML;
    }
  } catch (err) {
    console.error('[renderContentEfficiently] Error in incremental render:', err);

    // Fallback remains unchanged
    try {
      container.textContent = newHTML;
      container.__previousHtml = newHTML;
      console.log('[renderContentEfficiently] Used textContent fallback');
    } catch (fallbackErr) {
      console.error('[renderContentEfficiently] Even fallback failed:', fallbackErr);
    }
  }
}

/**
 * (Optional) fallback or additional methods can be re-exported here.
 * For chain-of-thought logic, see deepseekProcessor.js.
 */

/**
 * Debug function to help troubleshoot rendering issues
 * @param {HTMLElement} container - The container to check
 * @param {string} newHTML - The HTML content that should be in the container
 */
export function debugRenderingStatus(container, newHTML) {
  if (!container) {
    console.error('[debugRenderingStatus] Container is null!');
    return;
  }
  
  console.log('--- RENDERING DEBUG INFO ---');
  console.log('Container ID:', container.id || 'no-id');
  console.log('Container display:', window.getComputedStyle(container).display);
  console.log('Container visibility:', window.getComputedStyle(container).visibility);
  console.log('Container opacity:', window.getComputedStyle(container).opacity);
  console.log('Container dimensions:', 
    container.offsetWidth + 'x' + container.offsetHeight);
  console.log('Content length to render:', newHTML?.length || 0);
  console.log('Actual container content length:', container.innerHTML?.length || 0);
  
  // Check container's parent for any CSS that might hide it
  let parent = container.parentElement;
  let path = [container.tagName + (container.id ? '#' + container.id : '')];
  
  while (parent) {
    const style = window.getComputedStyle(parent);
    path.unshift(parent.tagName + (parent.id ? '#' + parent.id : ''));
    
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      console.error('Found hidden parent:', parent.tagName, parent.id, style.display, style.visibility, style.opacity);
    }
    
    parent = parent.parentElement;
  }
  
  console.log('Container path:', path.join(' > '));
}

// Stub export in case streaming.js tries to import from here:
export function renderThinkingContainer(container, thinkingContent, processor) {
  console.warn('[renderThinkingContainer] Called fallback stub. Please use deepSeekProcessor.renderThinkingContainer for chain-of-thought logic.');
  
  // CRITICAL FIX: Basic fallback implementation to ensure thinking content is at least visible
  if (container && thinkingContent) {
    try {
      const thinkingDiv = document.createElement('div');
      thinkingDiv.className = 'thinking-fallback';
      thinkingDiv.innerHTML = `<div class="p-2 bg-gray-100 dark:bg-gray-800 rounded mt-2 mb-2">
        <details>
          <summary class="cursor-pointer">Chain of Thought</summary>
          <pre class="p-2 whitespace-pre-wrap">${thinkingContent}</pre>
        </details>
      </div>`;
      
      container.appendChild(thinkingDiv);
      return thinkingDiv;
    } catch (err) {
      console.error('[renderThinkingContainer] Fallback error:', err);
    }
  }
  
  return null;
}
