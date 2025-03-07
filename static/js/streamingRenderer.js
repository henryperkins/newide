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

  // CRITICAL FIX: Log content we're trying to render for debugging
  console.log('[renderContentEfficiently] Rendering HTML content:',
    newHTML ? newHTML.substring(0, 100) + '...' : 'EMPTY');
  console.log('[renderContentEfficiently] Target container:',
    container.id || 'unnamed container');

  // Store a reference to previous HTML
  if (typeof container.__previousHtml === 'undefined') {
    container.__previousHtml = '';
  }

  const oldHTML = container.__previousHtml;

  // If content is identical, do nothing
  if (oldHTML === newHTML) return;

  try {
    // For incremental updates: if new content starts with old content, just append the remainder
    if (newHTML.startsWith(oldHTML)) {
      const remainder = newHTML.slice(oldHTML.length);
      if (remainder) {
        // Create content without attaching to DOM yet
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = remainder;

        // Use document fragment for better performance
        const fragment = document.createDocumentFragment();
        while (tempDiv.firstChild) {
          fragment.appendChild(tempDiv.firstChild);
        }

        // Single DOM mutation to append new content
        container.appendChild(fragment);

        // Log success
        console.log('[renderContentEfficiently] Appended new content');
      }
    } else {
      // CRITICAL FIX: The full HTML replacement has issues - ensure content is visible
      console.log('[renderContentEfficiently] Full content replace');

      // Make sure the container is visible and has width/height
      container.style.display = 'block';
      container.style.minHeight = '20px';

      // CRITICAL FIX: Use innerText for simple content to avoid HTML parsing issues
      if (newHTML.length < 1000 && !newHTML.includes('<')) {
        container.innerText = newHTML;
      } else {
        // For HTML content, use innerHTML
        container.innerHTML = newHTML;
      }

      // Log that we did a full replace
      console.log('[renderContentEfficiently] Full content replacement complete');
    }

    // Update stored HTML reference
    container.__previousHtml = newHTML;

    // Optional scroll behavior - only if explicitly requested
    if (options.scroll) {
      const chatHistory = document.getElementById('chat-history');
      if (chatHistory) {
        // Use requestAnimationFrame to ensure scroll happens after render
        requestAnimationFrame(() => {
          chatHistory.scrollTo({
            top: chatHistory.scrollHeight,
            ...options.scrollOptions
          });
        });
      }
    }
  } catch (err) {
    console.error('[renderContentEfficiently] Error in incremental render:', err);

    // CRITICAL FIX: Use direct textContent as fallback if all else fails
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

// Stub export in case streaming.js tries to import from here:
export function renderThinkingContainer(container, thinkingContent, processor) {
  // No-op or minimal fallback if needed
  console.warn('[renderThinkingContainer] Called fallback stub. Please use deepSeekProcessor.renderThinkingContainer for chain-of-thought logic.');
  return null;
}