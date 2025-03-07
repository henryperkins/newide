/**
 * deepseekProcessor.js
 *
 * Consolidated module for parsing, processing, and rendering
 * "DeepSeek"-style chain-of-thought content, plus a no-op
 * initializeExistingBlocks() to avoid errors in init.js.
 *
 * Added replaceThinkingBlocks() so displayManager.js can call it.
 */

/* -------------------------------------------------------------------------
 * 1. SSE chunk processing (formerly in streaming_utils.js)
 * ------------------------------------------------------------------------- */

/**
 * Takes incoming SSE data (data.choices[]), updates the main text buffer
 * and chain-of-thought buffer. This replaces the old "processDataChunk".
 *
 * @param {Object} data - Parsed JSON from SSE (e.g. { choices: [...] }).
 * @param {string} chunkBuffer - Temporary leftover text not yet assigned.
 * @param {string} mainTextBuffer - Accumulated user-visible content so far.
 * @param {string} thinkingTextBuffer - Accumulated chain-of-thought text so far.
 * @param {boolean} isThinking - Flag if we are currently inside <think>...</think>.
 * @returns {Object} updated { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking }
 */
function processChunkAndUpdateBuffers(data, chunkBuffer, mainTextBuffer, thinkingTextBuffer, isThinking) {
  if (!data.choices || data.choices.length === 0) {
    return { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking };
  }

  data.choices.forEach(choice => {
    // Each token
    if (choice.delta && choice.delta.content) {
      const text = choice.delta.content;
      chunkBuffer += text;

      // Let processStreamingChunk do the <think> splitting
      const result = processStreamingChunk(chunkBuffer, isThinking, mainTextBuffer, thinkingTextBuffer);
      mainTextBuffer = result.mainBuffer;
      thinkingTextBuffer = result.thinkingBuffer;
      isThinking = result.isThinking;
      chunkBuffer = result.remainingChunk;
    }

    // If server signals the end
    if (choice.finish_reason) {
      if (chunkBuffer) {
        mainTextBuffer += chunkBuffer;
        chunkBuffer = '';
      }
      isThinking = false; // turn off chain-of-thought at final chunk
    }
  });

  return { mainTextBuffer, thinkingTextBuffer, chunkBuffer, isThinking };
}

/**
 * Splits text into user-visible vs. chain-of-thought by scanning <think>...</think>.
 *
 * @param {string} chunkBuffer
 * @param {boolean} isThinking
 * @param {string} mainBuffer
 * @param {string} thinkingBuffer
 * @returns {Object} { mainBuffer, thinkingBuffer, isThinking, remainingChunk }
 */
function processStreamingChunk(chunkBuffer, isThinking, mainBuffer, thinkingBuffer) {
  const result = {
    mainBuffer: mainBuffer || '',
    thinkingBuffer: thinkingBuffer || '',
    isThinking: isThinking || false,
    remainingChunk: ''
  };
  if (!chunkBuffer) return result;

  let buffer = chunkBuffer;
  while (buffer.length > 0) {
    if (result.isThinking) {
      // Look for closing </think>
      const closeIdx = buffer.indexOf('</think>');
      if (closeIdx === -1) {
        // Not found, so everything goes into chain-of-thought
        result.thinkingBuffer += buffer;
        buffer = '';
      } else {
        // Found it
        result.thinkingBuffer += buffer.substring(0, closeIdx);
        result.isThinking = false;
        buffer = buffer.substring(closeIdx + 8); // skip </think>
      }
    } else {
      // We are in user-visible text, look for <think>
      const openIdx = buffer.indexOf('<think>');
      if (openIdx === -1) {
        // No opening tag found => all user-visible
        result.mainBuffer += buffer;
        buffer = '';
      } else {
        // <think> found
        if (openIdx > 0) {
          result.mainBuffer += buffer.substring(0, openIdx);
        }
        result.isThinking = true;
        buffer = buffer.substring(openIdx + 7); // skip <think>
      }
    }
  }

  // We consumed the entire chunk. No leftover partial text remains
  result.remainingChunk = '';

  return result;
}

/**
 * At the end of streaming, separate the user-facing content
 * (removing leftover <think> tags) vs. chain-of-thought content.
 *
 * @param {string} mainBuffer
 * @param {string} thinkingBuffer
 * @returns {Object} { mainContent, thinkingContent }
 */
function separateContentBuffers(mainBuffer, thinkingBuffer) {
  // Remove any stray <think> tags in main content
  const cleanedMain = (mainBuffer || '').replace(/<\/?think>/g, '').trim();
  return {
    mainContent: cleanedMain,
    thinkingContent: (thinkingBuffer || '').trim()
  };
}

// -------------------------------------------------------------------------
// 2. Final user-facing "DeepSeek" content
// -------------------------------------------------------------------------

/**
 * Removes <think> blocks from a final string. (If you want to
 * show your chain-of-thought in the final answer, skip this.)
 *
 * @param {string} content
 * @returns {string}
 */
function processDeepSeekResponse(content) {
  if (!content) return '';
  // Remove <think>...</think> blocks
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Remove any leftover <think> tags
  cleaned = cleaned.replace(/<\/?think>/g, '');
  return cleaned;
}

/**
 * Replaces <think> blocks in the string by removing them, effectively.
 * This is an alias for processDeepSeekResponse, so code referencing
 * deepSeekProcessor.replaceThinkingBlocks won't break.
 */
function replaceThinkingBlocks(content) {
  return processDeepSeekResponse(content);
}

// -------------------------------------------------------------------------
// 3. Rendering / toggling of chain-of-thought blocks in the DOM
// -------------------------------------------------------------------------

/**
 * Minimal markdown -> HTML for chain-of-thought text
 */
function markdownToHtml(text) {
  if (!text) return '';
  return text
    .replace(/### (.*)/g, '<h3>$1</h3>')
    .replace(/## (.*)/g, '<h2>$1</h2>')
    .replace(/# (.*)/g, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/**
 * Creates or updates the chain-of-thought container in the parent node.
 * Replaces the old ensureThinkingContainer usage in streaming_utils.
 *
 * @param {HTMLElement} parentContainer - Typically your .assistant-message container
 * @param {string} thinkingText - The thinking content to render
 * @param {Object} options - Options like createNew to force a new container
 * @returns {HTMLElement | null} The thinking container DOM node
 */
function renderThinkingContainer(parentContainer, thinkingText, options = {}) {
  if (!parentContainer) return null;

  // Look for existing container only if we're not forcing a new one
  let thinkingContainer = null;
  if (!options.createNew) {
    thinkingContainer = parentContainer.querySelector('.thinking-pre');
  }

  if (!thinkingContainer || options.createNew) {
    // If not found or createNew is true, create a new container
    const wrapper = document.createElement('div');
    wrapper.className = 'thinking-safe-wrapper'; // Add a wrapper class

    // Create unique container with timestamp to avoid conflicts
    const uniqueId = 'thinking-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    wrapper.setAttribute('data-id', uniqueId);

    wrapper.innerHTML = createThinkingBlockHTML(thinkingText);
    parentContainer.appendChild(wrapper);

    thinkingContainer = wrapper.querySelector('.thinking-pre');

    // Initialize toggling
    const thinkingProcess = wrapper.querySelector('.thinking-process');
    initializeThinkingToggle(thinkingProcess);

    // Return the thinking container element
    return thinkingContainer;
  } else {
    // If it exists and we're not creating new, just update the text
    const sanitizedContent = DOMPurify.sanitize(markdownToHtml(thinkingText));
    thinkingContainer.innerHTML = sanitizedContent;
  }
  return thinkingContainer;
}

/**
 * Builds the HTML snippet for the chain-of-thought block with a toggle.
 */
function createThinkingBlockHTML(thinkingText) {
  const sanitized = DOMPurify.sanitize(markdownToHtml(thinkingText));
  return `
    <div class="thinking-process" role="region" aria-label="Chain of Thought" data-collapsed="false">
      <div class="thinking-header thinking-toggle" aria-expanded="true">
        <span class="toggle-icon">▼</span>
        <span class="font-medium ml-1">Chain of Thought</span>
      </div>
      <div class="thinking-content">
        <pre class="thinking-pre">${sanitized}</pre>
        <div class="bg-gradient-to-t from-transparent to-white/50 dark:to-gray-800/50 h-8"></div>
      </div>
    </div>
  `;
}

/**
 * Toggle show/hide logic for chain-of-thought container.
 */
function initializeThinkingToggle(thinkingProcess) {
  if (!thinkingProcess) return;
  const toggleBtn = thinkingProcess.querySelector('.thinking-header');
  const contentDiv = thinkingProcess.querySelector('.thinking-content');
  const toggleIcon = thinkingProcess.querySelector('.toggle-icon');

  if (!toggleBtn || !contentDiv) return;

  toggleBtn.addEventListener('click', () => {
    const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    thinkingProcess.setAttribute('data-collapsed', expanded ? 'true' : 'false');

    if (toggleIcon) {
      toggleIcon.textContent = expanded ? '▶' : '▼';
    }
    contentDiv.style.display = expanded ? 'none' : 'block';
  });
}

/**
 * For code that tries to call deepSeekProcessor.initializeExistingBlocks,
 * we provide this stub so it won't throw an error in init.js
 */
function initializeExistingBlocks() {
  // If you want to re-scan the DOM on page load and attach toggles to .thinking-process elements,
  // implement that logic here. For now, it's a no-op to avoid errors.
}

/* -------------------------------------------------------------------------
 * 4. Export a single object so streaming.js (etc.) can import
 * ------------------------------------------------------------------------- */
export const deepSeekProcessor = {
  processChunkAndUpdateBuffers: processChunkAndUpdateBuffers,  // explicit assignment to existing function
  processStreamingChunk: processStreamingChunk,
  separateContentBuffers: separateContentBuffers,              // correct existing function use
  processDeepSeekResponse: processDeepSeekResponse,
  replaceThinkingBlocks: replaceThinkingBlocks,
  renderThinkingContainer: (parent, thinkingText) => renderThinkingContainer(parent, thinkingText, {createNew: true}),
  createThinkingBlockHTML: createThinkingBlockHTML,
  initializeThinkingToggle: initializeThinkingToggle,
  initializeExistingBlocks: initializeExistingBlocks,
  markdownToHtml: markdownToHtml,
  // Add these functions to the deepSeekProcessor export:
  preprocessChunk: function(data) {
    console.log('[deepSeekProcessor.preprocessChunk] Processing chunk:',
      typeof data === 'object' ?
      (data.choices ? 'choices format' : 'text format') :
      'string format');
    
    // Handle both JSON formats that DeepSeek might return
    if (typeof data === 'object') {
      if (data.choices && data.choices[0] && data.choices[0].delta) {
        // Extract content from delta format
        const deltaContent = data.choices[0].delta.content || '';
        console.log('[preprocessChunk] Found delta content:', deltaContent.length > 0);
        
        // Convert to text format to standardize processing
        return { text: deltaContent };
      }
      else if (data.text !== undefined) {
        // Already in text format, ensure it's a string
        console.log('[preprocessChunk] Found text content:', data.text.length > 0);
        data.text = String(data.text);
        return data;
      }
    }
    
    // If we get here, we couldn't extract content in a standard way
    console.warn('[preprocessChunk] Unexpected data format:', data);
    
    // Try to convert to a standard format as best we can
    if (typeof data === 'string') {
      return { text: data };
    }
    
    // If all else fails, return an empty object to avoid errors
    return { text: '' };
  },
};
