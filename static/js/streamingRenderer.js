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
export function renderContentEfficiently(container, newHTML, options = {}) {
  if (!container) return;

  // Initialize a stored reference to previous HTML if missing
  if (typeof container.__previousHtml === 'undefined') {
    container.__previousHtml = '';
  }

  const oldHTML = container.__previousHtml;

  // If content is the same, do nothing
  if (oldHTML === newHTML) return;

  // For incremental updates: if the new content starts with old content, just append the remainder
  if (newHTML.startsWith(oldHTML)) {
    const remainder = newHTML.slice(oldHTML.length);
    if (remainder) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = remainder;
      const fragment = document.createDocumentFragment();
      while (tempDiv.firstChild) {
        fragment.appendChild(tempDiv.firstChild);
      }
      container.appendChild(fragment);
    }
  } else {
    // Otherwise, replace the entire innerHTML
    container.innerHTML = newHTML;
  }

  container.__previousHtml = newHTML;

  // Optional scroll behavior - get chat history container for consistent scrolling
  if (options.scroll) {
    const chatHistory = document.getElementById('chat-history');
    if (chatHistory) {
      // Use scrollTo instead of scrollIntoView for more predictable behavior
      const scrollOptions = options.scrollOptions || { behavior: 'smooth' };
      chatHistory.scrollTo({
        top: chatHistory.scrollHeight,
        ...scrollOptions
      });
    } else {
      // Fallback to scrollIntoView if chat history not found
      container.scrollIntoView(options.scrollOptions || { behavior: 'smooth', block: 'end' });
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
