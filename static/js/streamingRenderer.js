/**
 * streamingRenderer.js
 *
 * Minimal content renderer for streaming updates, avoiding excessive reflows/flicker.
 * Restores the previously removed `renderContentEfficiently` export so streaming.js can import it.
 */

/**
 * Updates HTML content with minimal DOM manipulation to reduce flickering.
 * Used by streaming.js to incrementally render text into the message container.
 *
 * @param {HTMLElement} container - Target container element
 * @param {string} newHTML - New HTML content to render
 * @param {Object} options - Rendering options (e.g., scroll behavior)
 */
// More efficient DOM updates with less jitter
export function renderContentEfficiently(container, newHTML, options = {}) {
  if (!container) return;

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
      }
    } else {
      // Fall back to full replacement only when necessary
      container.innerHTML = newHTML;
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
    console.error('Error in incremental render:', err);
    container.innerHTML = newHTML;
    container.__previousHtml = newHTML;
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
