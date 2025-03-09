/**
 * streamRenderer.js
 * 
 * Specialized component for rendering streaming content efficiently.
 * Part of the frontend architecture, this module handles the real-time
 * display of incoming message chunks from the API.
 */

import { highlightCode } from './markdownParser.js';
import { eventBus } from '../utils/helpers.js';

// Configuration
const RENDER_THROTTLE_MS = 150;
const SCROLL_THROTTLE_MS = 500;

// State tracking
let lastContentLength = 0;
let renderCount = 0;
let contentBuffer = '';

/**
 * Efficiently renders content to a container with DOM diffing to minimize reflows
 * 
 * @param {HTMLElement} container - The container element to render content into
 * @param {string} content - The markdown content to render
 * @param {Object} options - Options like scroll behavior
 */
export function renderContentEfficiently(container, content, options = {}) {
  if (!container) {
    console.error('[streamRenderer] No container provided for rendering');
    return;
  }

  if (!content) {
    console.warn('[streamRenderer] Empty content provided for rendering');
    return;
  }

  try {
    // Get current content and check if it's a substantial change
    const currentContent = container.innerHTML || '';
    const contentChanged = content.length !== lastContentLength;
    lastContentLength = content.length;

    // Only update DOM if content changed
    if (contentChanged) {
      renderCount++;
      container.innerHTML = content;
      
      // Apply syntax highlighting to code blocks
      if (renderCount % 3 === 0) { // Only highlight periodically to improve performance
        highlightCode(container);
      }

      // Scroll if needed and not manually scrolled up
      if (options.scroll) {
        const chatHistory = document.getElementById('chat-history');
        if (chatHistory) {
          const chatHeight = chatHistory.scrollHeight;
          const visibleHeight = chatHistory.clientHeight;
          const currentScroll = chatHistory.scrollTop;
          
          // Only auto-scroll if user is already near the bottom
          const isNearBottom = currentScroll + visibleHeight + 200 >= chatHeight;
          
          if (isNearBottom) {
            chatHistory.scrollTo({
              top: chatHistory.scrollHeight,
              behavior: options.smoothScroll ? 'smooth' : 'auto'
            });
          }
        }
      }
      
      // Notify that content was rendered
      eventBus.publish('contentRendered', {
        containerId: container.id,
        contentLength: content.length,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('[streamRenderer] Error rendering content:', error);
  }
}

/**
 * Creates or updates a thinking container with chain-of-thought content
 * 
 * @param {HTMLElement} parentContainer - Parent message container
 * @param {string} thinkingContent - The chain-of-thought content 
 * @returns {HTMLElement} The thinking container element
 */
export function renderThinkingContainer(parentContainer, thinkingContent) {
  if (!parentContainer || !thinkingContent) {
    console.warn('[streamRenderer] Missing required parameters for thinking container');
    return null;
  }

  // Look for existing thinking container first
  let thinkingBlock = parentContainer.querySelector('.chain-of-thought-block');
  
  if (!thinkingBlock) {
    // Create a new thinking container if none exists
    thinkingBlock = document.createElement('div');
    thinkingBlock.className = 'chain-of-thought-block mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded markdown-content';
    thinkingBlock.innerHTML = `
      <details open>
        <summary class="font-medium cursor-pointer">Chain of Thought</summary>
        <div class="thinking-content mt-2"></div>
      </details>
    `;
    parentContainer.appendChild(thinkingBlock);
  }
  
  // Update the content
  const contentElement = thinkingBlock.querySelector('.thinking-content');
  if (contentElement) {
    contentElement.textContent = thinkingContent;
  }
  
  return thinkingBlock;
}

/**
 * Finalizes rendered content after streaming is complete
 * 
 * @param {HTMLElement} container - The message container
 */
export function finalizeRenderedContent(container) {
  if (!container) return;
  
  // Apply final syntax highlighting
  highlightCode(container);
  
  // Remove streaming attributes
  container.removeAttribute('data-streaming');
  
  // Mark as completed
  container.setAttribute('data-streaming-complete', 'true');
  
  // Ensure all code blocks have copy buttons
  container.querySelectorAll('pre code').forEach(block => {
    const preElement = block.parentElement;
    if (preElement && !preElement.parentElement.querySelector('.copy-code-button')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'relative group';
      
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-code-button absolute top-2 right-2 p-1 rounded text-xs bg-gray-800/90 text-gray-100 opacity-0 group-hover:opacity-100 transition-opacity';
      copyButton.textContent = 'Copy';
      copyButton.setAttribute('aria-label', 'Copy code');
      
      preElement.parentNode.insertBefore(wrapper, preElement);
      wrapper.appendChild(copyButton);
      wrapper.appendChild(preElement);
    }
  });
  
  // Notify completion
  eventBus.publish('streamingContentFinalized', {
    containerId: container.id,
    timestamp: Date.now()
  });
}

/**
 * Reset the renderer state for a new streaming session
 */
export function resetRenderer() {
  lastContentLength = 0;
  renderCount = 0;
  contentBuffer = '';
}

/**
 * For compatibility with the architecture diagrams and modules
 * that expect these functions
 */
export default {
  renderContentEfficiently,
  renderThinkingContainer,
  finalizeRenderedContent,
  resetRenderer
};