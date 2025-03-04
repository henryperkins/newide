/**
 * deepseekProcessor.js
 *
 * A refined and more robust module for parsing, processing, and rendering
 * "DeepSeek"-style chain-of-thought content. This updated version addresses
 * potential edge cases, toggling inconsistencies, and overlapping or multiple
 * <think> blocks within the same chunk.
 *
 * NOTE: This module requires a browser-like environment or polyfills for:
 *   - document, DOMParser (for HTML parsing)
 *   - DOMPurify (for sanitization)
 *   - requestAnimationFrame (for queued animations)
 *   - Optional: Prism (for code highlighting, if available)
 *
 * IMPORTANT: Overlapping or malformed <think> tags (like one <think> block
 * not fully closed before another <think>) can still produce unexpected
 * results. This code attempts to be more defensive but cannot fully handle
 * arbitrary invalid HTML structures.
 */

/* -------------------------------------------------------------------------
 * 1. Process a final DeepSeek response, removing all <think> tags & content
 * ------------------------------------------------------------------------- */

/**
 * Removes chain-of-thought text enclosed in <think>...</think> tags.
 * Useful when returning a user-facing version without hidden reasoning.
 *
 * @param {string} content - The raw response, potentially with <think> blocks.
 * @returns {string} - The content with all <think> blocks removed.
 */
export function processDeepSeekResponse(content) {
  if (!content) return '';

  // Remove entire <think>... </think> blocks
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Clean up any stray or partial <think> tags
  cleaned = cleaned.replace(/<\/?think>/g, '');

  return cleaned;
}

/* -------------------------------------------------------------------------
 * 2. Process a streamed chunk, separating user-visible vs. "thinking" text
 * ------------------------------------------------------------------------- */

/**
 * Processes a chunk of streamed text, splitting user-visible content and
 * chain-of-thought text based on <think> tags. Handles multiple <think> blocks
 * in a single chunk. Overlapping or malformed tags may cause partial merges,
 * so assume valid tags whenever possible.
 *
 * @param {string} chunkBuffer - The chunk of text from streaming.
 * @param {boolean} isThinking - Whether we were previously "inside" a <think> block.
 * @param {string} mainBuffer - Accumulated user-visible text so far.
 * @param {string} thinkingBuffer - Accumulated chain-of-thought text so far.
 * @returns {{
 *   mainBuffer: string,
 *   thinkingBuffer: string,
 *   isThinking: boolean,
 *   remainingChunk: string,
 *   hasMultipleThinking: boolean
 * }}
 */
export function processStreamingChunk(chunkBuffer, isThinking, mainBuffer, thinkingBuffer) {
  // Default result object
  const result = {
    mainBuffer: mainBuffer || '',
    thinkingBuffer: thinkingBuffer || '',
    isThinking: isThinking || false,
    remainingChunk: '',
    hasMultipleThinking: false,
  };

  if (!chunkBuffer) return result;

  let buffer = chunkBuffer;

  // Repeatedly look for <think> or </think> in the buffer
  while (buffer.length > 0) {
    // If we are currently inside a <think> block, scan for </think>
    if (result.isThinking) {
      const closeIdx = buffer.indexOf('</think>');
      if (closeIdx === -1) {
        // No closing tag found; assume all this chunk belongs in thinking
        result.thinkingBuffer += buffer;
        buffer = '';
        break;
      } else {
        // Found a closing tag
        result.thinkingBuffer += buffer.substring(0, closeIdx);
        result.isThinking = false;
        // Slice off the consumed portion plus the </think> tag
        buffer = buffer.substring(closeIdx + 8);
        // Continue searching in the new buffer content
      }
    } else {
      // We are in user-visible context, look for <think>
      const openIdx = buffer.indexOf('<think>');
      if (openIdx === -1) {
        // No <think> tag found in the remainder => all is user-visible
        result.mainBuffer += buffer;
        buffer = '';
        break;
      } else {
        // <think> tag found
        // Everything before <think> is user-visible
        if (openIdx > 0) {
          result.mainBuffer += buffer.substring(0, openIdx);
        }
        // We enter thinking mode after <think>
        result.isThinking = true;
        buffer = buffer.substring(openIdx + 7);
        // Keep searching in the new buffer chunk
        // (will loop around and look for closing </think>)
        result.hasMultipleThinking = true;
      }
    }
  }

  // Whatever remains unprocessed is leftover for next iteration
  // In this approach, we explicitly return an empty remainingChunk because
  // we consumed the entire chunk or stashed it all in the buffers.
  // If you want to handle leftover partial text outside, you can store it here.
  // For now, we do not hold partial text outside; we keep it in the relevant buffer.
  result.remainingChunk = '';

  return result;
}

/* -------------------------------------------------------------------------
 * 3. Create and render chain-of-thought blocks as HTML
 * ------------------------------------------------------------------------- */

/**
 * Internal helper: format chain-of-thought text with minimal markdown processing,
 * code-fence highlighting, etc. Return HTML for insertion into a <pre>.
 *
 * @param {string} content
 * @returns {string}
 */
function formatThinkingContent(content) {
  if (!content) return '';

  // Remove excessive blank lines
  let formatted = content.replace(/\n{3,}/g, '\n\n');
  // Trim
  formatted = formatted.trim();
  // Basic markdown expansions
  formatted = processMarkdownElements(formatted);

  // Attempt a naive code-fence parse:
  formatted = formatted.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || 'plaintext';
    const highlighted = (typeof Prism !== 'undefined' && Prism.languages[language])
      ? Prism.highlight(code.trim(), Prism.languages[language], language)
      : code.trim();
    return `<div class="code-block" data-language="${language}">
      <div class="code-block-header" aria-label="${language} code">${language}</div>
      <pre class="language-${language}"><code class="language-${language}">
${highlighted}
      </code></pre>
    </div>`;
  });

  // Inline code (single backticks)
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  return formatted;
}

/**
 * Minimal partial markdown conversion for blockquotes, lists, and tables.
 * For a more complete solution, consider a dedicated markdown library.
 *
 * @param {string} content
 * @returns {string}
 */
function processMarkdownElements(content) {
  if (!content) return '';

  let processed = content;

  // Blockquotes
  processed = processed.replace(/^>[ \t](.*)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  processed = processed.replace(/^[ \t]*[-*+][ \t]+(.*)$/gm, '<li>$1</li>');
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  processed = processed.replace(/<\/ul>\s*<ul>/g, ''); // merges consecutive <ul>

  // Ordered lists
  processed = processed.replace(/^[ \t]*(\d+)\.[ \t]+(.*)$/gm, '<li>$2</li>');
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, '<ol>$&</ol>');
  processed = processed.replace(/<\/ol>\s*<ol>/g, ''); // merges consecutive <ol>

  // Simple tables
  processed = processed.replace(/^\|(.+)\|$/gm, '<tr><td>$1</td></tr>');
  processed = processed.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>');

  return processed;
}

/**
 * Creates HTML for a chain-of-thought block with a toggle. Sanitizes the final content.
 *
 * @param {string} thinkingContent
 * @returns {string} - An HTML snippet to be inserted into the DOM
 */
export function createThinkingBlockHTML(thinkingContent) {
  if (!thinkingContent) thinkingContent = '';
  const formatted = formatThinkingContent(thinkingContent);

  // Sanitize final HTML
  const sanitized = DOMPurify.sanitize(formatted, {
    ALLOWED_TAGS: [
      'div', 'span', 'code', 'pre', 'button', 'blockquote', 'ul', 'ol', 'li',
      'table', 'tr', 'td', 'think', 'strong', 'em'
    ],
    ALLOWED_ATTR: ['class', 'aria-expanded', 'data-language', 'aria-label'],
    FORBID_ATTR: ['style', 'on*']
  });

  // Make a unique ID for toggling
  const uniqueId = `thinking-content-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Because the sanitized HTML might remove some wrapping tags, place it into <pre class="thinking-pre>" safely:
  // We'll store the sanitized content in the <pre>. We then further sanitize that container if needed.
  return `
    <div class="thinking-process shadow-sm my-4"
         role="region"
         aria-label="Model reasoning process"
         data-collapsed="false">
      <div class="thinking-header">
        <button class="thinking-toggle"
                aria-expanded="true"
                aria-controls="${uniqueId}">
          <span class="font-medium">Thinking Process</span>
          <span class="toggle-icon" aria-hidden="true">▼</span>
        </button>
      </div>
      <div class="thinking-content" id="${uniqueId}">
        <pre class="thinking-pre">${sanitized}</pre>
        <div class="thinking-gradient"></div>
      </div>
    </div>
  `;
}

/**
 * Replaces all <think>...</think> blocks in content with a togglable chain-of-thought UI.
 * Automatically sanitizes the chain-of-thought text inside each block.
 *
 * @param {string} content
 * @returns {string}
 */
export function replaceThinkingBlocks(content) {
  if (!content) return '';

  // We do a safe extraction of <think> blocks. Overlapping tags are not truly valid,
  // but we try to be defensive in case of partial or spurious tags.
  const blocks = extractThinkingContent(content);
  if (!blocks.length) return content;

  let output = content;
  for (const blockText of blocks) {
    const rawBlock = `<think>${blockText}</think>`;
    const idx = output.indexOf(rawBlock);
    if (idx !== -1) {
      const before = output.substring(0, idx);
      const after = output.substring(idx + rawBlock.length);

      // Convert this block to togglable HTML
      const replacedHTML = createThinkingBlockHTML(blockText);

      output = before + replacedHTML + after;
    }
  }

  // Remove leftover <think> tags if any remain (e.g. malformed or nested)
  output = output.replace(/<think>[\s\S]*?<\/think>/g, '');
  return output;
}

/* -------------------------------------------------------------------------
 * 4. Initialize and control chain-of-thought blocks in the DOM
 * ------------------------------------------------------------------------- */

/**
 * Scan the DOM for existing .thinking-process containers that might
 * have been inserted (e.g. from historical content), attach toggling behavior,
 * and handle a brief "new" highlight effect.
 */
function initializeExistingBlocks() {
  document.querySelectorAll('.thinking-block').forEach(container => {
    const toggleBtn = container.querySelector('.thinking-toggle');
    const content = container.querySelector('.thinking-content');
    const toggleIcon = container.querySelector('.toggle-icon');

    if (toggleBtn && content) {
      // Set initial state based on data-collapsed attribute
      const isCollapsed = container.getAttribute('data-collapsed') === 'true';
      
      if (isCollapsed) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        content.style.display = 'none';
        if (toggleIcon) toggleIcon.textContent = '▶';
      } else {
        toggleBtn.setAttribute('aria-expanded', 'true');
        content.style.display = 'block';
        if (toggleIcon) toggleIcon.textContent = '▼';
      }
      
      // Create proper animation using Web Animation API
      const handleToggle = () => {
        const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        const newExpanded = !isExpanded;

        // Update ARIA attributes immediately
        toggleBtn.setAttribute('aria-expanded', newExpanded);
        
        // Create slide animation
        const startHeight = newExpanded ? 0 : content.scrollHeight;
        const endHeight = newExpanded ? content.scrollHeight : 0;
        
        const animation = content.animate(
          [
            { height: `${startHeight}px`, opacity: newExpanded ? 0 : 1 },
            { height: `${endHeight}px`, opacity: newExpanded ? 1 : 0 }
          ],
          { duration: 300, easing: 'ease-out', fill: 'forwards' }
        );
        
        // Update classes and icon once animation completes
        animation.onfinish = () => {
          content.style.height = newExpanded ? 'auto' : '0';
          content.style.display = newExpanded ? 'block' : 'none';
          container.setAttribute('data-collapsed', !newExpanded);
          
          if (toggleIcon) {
            toggleIcon.textContent = newExpanded ? '▼' : '▶';
          }
        };
      };

      // Click handler
      toggleBtn.addEventListener('click', handleToggle);
        
      // Keyboard accessibility
      toggleBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggle();
        }
      });
    }
  });
  
  // Also handle legacy thinking-process blocks for backward compatibility
  document.querySelectorAll('.thinking-process').forEach(thinkingProcess => {
    const toggleBtn = thinkingProcess.querySelector('.thinking-toggle');
    const content = thinkingProcess.querySelector('.thinking-content');
    const toggleIcon = thinkingProcess.querySelector('.toggle-icon');

    // Ensure data-collapsed is set
    if (!block.hasAttribute('data-collapsed')) {
      block.setAttribute('data-collapsed', 'false');
    }

    const toggleBtn = block.querySelector('.thinking-toggle');
    const content = block.querySelector('.thinking-content');
    const toggleIcon = block.querySelector('.toggle-icon');

    // Attach toggle logic
    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        toggleBtn.setAttribute('aria-expanded', !expanded);
        thinkingProcess.setAttribute('data-collapsed', expanded ? 'true' : 'false');
        content.classList.toggle('hidden', expanded);

        // Rotate the icon
        if (toggleIcon) {
          toggleIcon.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
          toggleIcon.style.transform = expanded ? 'rotate(-90deg)' : 'rotate(0deg)';
        }
      });
    }
  });
}

/* -------------------------------------------------------------------------
 * 5. Extract <think> blocks from a string, including nested occurrences
 * ------------------------------------------------------------------------- */

/**
 * Recursively extracts text from all <think>...</think> blocks.
 * Handles nested blocks by counting open/close tags. Overlapping or malformed
 * tags can yield partial or unexpected results.
 *
 * @param {string} content
 * @returns {string[]} - Array of the raw text inside each <think> block.
 */
export function extractThinkingContent(content) {
  if (!content) return [];
  const results = [];

  function recursiveExtract(source) {
    const openIndex = source.indexOf('<think>');
    if (openIndex === -1) return;

    let openCount = 1;
    let searchIdx = openIndex + 7; // after the <think> tag
    let closeIndex = -1;

    while (openCount > 0 && searchIdx < source.length) {
      const nextOpen = source.indexOf('<think>', searchIdx);
      const nextClose = source.indexOf('</think>', searchIdx);

      if (nextClose === -1) {
        // No more closing tags => malformed or partial
        break;
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        openCount++;
        searchIdx = nextOpen + 7;
      } else {
        openCount--;
        if (openCount === 0) {
          closeIndex = nextClose;
        }
        searchIdx = nextClose + 8; // after </think>
      }
    }

    if (closeIndex !== -1) {
      // Extract text for this block
      const blockText = source.substring(openIndex + 7, closeIndex);
      results.push(blockText);

      // Recurse on post-block text, in case more blocks exist
      const remainder = source.substring(closeIndex + 8);
      recursiveExtract(remainder);

      // Also check if the block text itself contained nested blocks
      // (though they are already counted, we might extract them here
      // if you want each nested block as well. But we already do
      // because openCount increments. So let's avoid double extracting.
    }
  }

  recursiveExtract(content);
  return results;
}

/* -------------------------------------------------------------------------
 * 6. Optional function to create DOM elements for a chain-of-thought block
 * ------------------------------------------------------------------------- */

/**
 * Creates an actual DOM element for a chain-of-thought block
 * rather than returning an HTML string. Uses the same formatting logic.
 *
 * @param {string} thinkingContent - The chain-of-thought text
 * @returns {HTMLElement} A DOM element representing the thinking block
 */
function createThinkingBlock(thinkingContent) {
  // Create container with better semantics and ARIA support
  const container = document.createElement('div');
  container.className = 'thinking-block';
  container.setAttribute('data-collapsed', 'false');
  
  // Generate unique ID for accessibility
  const id = `thinking-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  // Create toggle button with proper accessibility attributes
  const html = `
    <div class="thinking-container">
      <button class="thinking-toggle" 
              aria-expanded="true" 
              aria-controls="${id}-content">
        <span class="toggle-icon">▼</span>
        <span>Chain of Thought</span>
      </button>
      <div id="${id}-content" class="thinking-content">
        ${formatThinkingContent(thinkingContent || '')}
      </div>
    </div>
  `;
  
  container.innerHTML = html;
  
  // Add toggle functionality with animation
  const toggleButton = container.querySelector('.thinking-toggle');
  const contentDiv = container.querySelector('.thinking-content');
  const toggleIcon = container.querySelector('.toggle-icon');

  if (toggleButton && contentDiv) {
    // Set initial state to expanded
    let isExpanded = true;
    
    // Create proper animation using Web Animation API
    const handleToggle = () => {
      const newExpanded = !isExpanded;
      isExpanded = newExpanded;

      // Update ARIA attributes immediately
      toggleButton.setAttribute('aria-expanded', newExpanded);
      
      // Create slide animation
      const startHeight = newExpanded ? 0 : contentDiv.scrollHeight;
      const endHeight = newExpanded ? contentDiv.scrollHeight : 0;
      
      const animation = contentDiv.animate(
        [
          { height: `${startHeight}px`, opacity: newExpanded ? 0 : 1 },
          { height: `${endHeight}px`, opacity: newExpanded ? 1 : 0 }
        ],
        { duration: 300, easing: 'ease-out', fill: 'forwards' }
      );
      
      // Update classes and icon once animation completes
      animation.onfinish = () => {
        contentDiv.style.height = newExpanded ? 'auto' : '0';
        contentDiv.style.display = newExpanded ? 'block' : 'none';
        container.setAttribute('data-collapsed', !newExpanded);
        
        if (toggleIcon) {
          toggleIcon.textContent = newExpanded ? '▼' : '▶';
        }
      };
    };

    // Click handler
    toggleButton.addEventListener('click', handleToggle);
      
    // Keyboard accessibility
    toggleButton.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleToggle();
      }
    });
  }
  return container;
}

/* -------------------------------------------------------------------------
 * 7. Other convenience methods and a minimal state manager (if needed)
 * ------------------------------------------------------------------------- */

/**
 * Splits buffers at the end of streaming to produce a final user-facing string
 * (mainContent) and a chain-of-thought string (thinkingContent).
 *
 * @param {string} mainBuffer
 * @param {string} thinkingBuffer
 * @returns {{mainContent: string, thinkingContent: string}}
 */
export function separateContentBuffers(mainBuffer, thinkingBuffer) {
  // Remove any accidental <think> tags from main content:
  const cleanedMain = mainBuffer.replace(/<\/?think>/g, '');
  // Keep the raw thinking buffer as is, or you could also strip leftover <think> tags if desired.
  return {
    mainContent: cleanedMain.trim(),
    thinkingContent: thinkingBuffer.trim(),
  };
}

/**
 * Minimal markdown-to-HTML converter for the user if desired.
 * This is intentionally simpler than the "processMarkdownElements" approach
 * used inside chain-of-thought formatting. Use a robust library if needed.
 *
 * @param {string} content
 * @returns {string}
 */
export function markdownToHtml(content) {
  if (!content) return '';
  return content
    .replace(/### (.*)/g, '<h3>$1</h3>')
    .replace(/## (.*)/g, '<h2>$1</h2>')
    .replace(/# (.*)/g, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/**
 * A simple state manager class for toggling expansions/animations if needed.
 * This is not strictly required but can be used to coordinate multiple toggles.
 */
class ThinkingBlockState {
  constructor() {
    this.blocks = new Map();
    this.animationQueue = new Map();
  }

  getState(id) {
    return this.blocks.get(id) || { expanded: false, content: '' };
  }

  updateState(id, newState) {
    const oldState = this.getState(id);
    this.blocks.set(id, { ...oldState, ...newState });
  }

  queueAnimation(id, callback) {
    if (!this.animationQueue.has(id)) {
      this.animationQueue.set(id, []);
    }
    this.animationQueue.get(id).push(callback);
    this.processAnimations();
  }

  async processAnimations() {
    for (const [id, queue] of this.animationQueue) {
      while (queue.length > 0) {
        const fn = queue.shift();
        await new Promise((r) => requestAnimationFrame(r));
        await fn();
      }
    }
  }
}

// Optionally export the shared state manager if needed
export const stateManager = new ThinkingBlockState();

/**
 * Consolidated export for the entire DeepSeek processing toolkit.
 * You can import specific functions as needed, or import this object.
 */
export const deepSeekProcessor = {
  processDeepSeekResponse,
  processStreamingChunk,
  createThinkingBlockHTML,
  replaceThinkingBlocks,
  initializeExistingBlocks,
  extractThinkingContent,
  createThinkingBlock,
  separateContentBuffers,
  markdownToHtml,
  stateManager,
};