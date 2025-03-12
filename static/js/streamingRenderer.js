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
    
    // IMPROVED APPROACH: For incremental updates, handle both appending and replacements more efficiently
    if (newHTML.startsWith(oldHTML)) {
      // If new content starts with old content, just append the remainder
      const remainder = newHTML.slice(oldHTML.length);
      if (remainder) {
        // For simple text increments, directly append textNode for better performance
        if (!/<[a-z][\s\S]*>/i.test(remainder)) {
          container.appendChild(document.createTextNode(remainder));
        } else {
          // For HTML content, use a temporary element and append nodes properly
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = remainder;
          
          // Use document fragment for bulk insertion (better performance)
          const fragment = document.createDocumentFragment();
          Array.from(tempDiv.childNodes).forEach(node => {
            fragment.appendChild(node.cloneNode(true));
          });
          
          container.appendChild(fragment);
        }
      }
    } else if (oldHTML && newHTML.includes(oldHTML) && 
              (newHTML.indexOf(oldHTML) < 100 || newHTML.length - oldHTML.length < 100)) {
      // If old content is somewhere within new content (with reasonable distance),
      // it's safer to update the whole content to prevent weird partial updates
      container.innerHTML = newHTML;
    } else {
      // Full content replace when necessary
      
      // CRITICAL FIX: Store references to existing elements to prevent full reflow
      const oldHeight = container.offsetHeight;
      
      // For text-only content use textContent, otherwise innerHTML
      if (!/<[a-z][\s\S]*>/i.test(newHTML)) {
        container.textContent = newHTML;
      } else {
        // Use a document fragment to build the new content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHTML;
        
        // Clear container while preserving its layout
        container.style.minHeight = `${Math.max(oldHeight, 20)}px`;
        container.innerHTML = '';
        
        // Append fragment
        const fragment = document.createDocumentFragment();
        Array.from(tempDiv.childNodes).forEach(node => {
          fragment.appendChild(node.cloneNode(true));
        });
        container.appendChild(fragment);
        
        // Release height constraint after a short delay
        setTimeout(() => {
          container.style.minHeight = '20px';
        }, 50);
      }
    }

    // Update stored HTML reference
    container.__previousHtml = newHTML;

    // Optional scroll behavior
    if (options.scroll) {
      const chatHistory = document.getElementById('chat-history');
      if (chatHistory) {
        requestAnimationFrame(() => {
          chatHistory.scrollTo({
            top: chatHistory.scrollHeight,
            behavior: options.scrollSmooth ? 'smooth' : 'auto'
          });
        });
      }
    }
  } catch (err) {
    console.error('[renderContentEfficiently] Error in render:', err);

    // Fallback to simple approach
    try {
      container.textContent = newHTML;
      container.__previousHtml = newHTML;
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

// Stub export redirecting to the central implementation
export function renderThinkingContainer(container, thinkingContent, processor) {
  console.warn('[renderThinkingContainer] Redirecting to deepSeekProcessor implementation');
  
  // Directly forward to the deepSeekProcessor implementation
  if (typeof deepSeekProcessor !== 'undefined' && deepSeekProcessor.renderThinkingContainer) {
    return deepSeekProcessor.renderThinkingContainer(container, thinkingContent, { createNew: true });
  }
  
  // Only if deepSeekProcessor is not available, use a minimal fallback
  console.error('[renderThinkingContainer] deepSeekProcessor not available, using minimal fallback');
  if (container && thinkingContent) {
    try {
      // Process the thinking content to ensure proper spacing
      let processedContent = thinkingContent
        .replace(/([,\.\?!;:])([A-Za-z0-9])/g, '$1 $2') // Add space after punctuation
        .replace(/([a-z])([A-Z])/g, '$1 $2'); // Add space between camelCase words
      
      const thinkingDiv = document.createElement('div');
      thinkingDiv.className = 'thinking-fallback';
      thinkingDiv.setAttribute('data-cot-id', Date.now());
      thinkingDiv.innerHTML = `<div class="p-2 bg-gray-100 dark:bg-gray-800 rounded mt-2 mb-2">
        <details>
          <summary class="cursor-pointer">Chain of Thought</summary>
          <pre class="p-2 whitespace-pre-wrap">${processedContent}</pre>
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
