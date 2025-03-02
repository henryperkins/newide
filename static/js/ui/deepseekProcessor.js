/**
 * deepseekProcessor.js
 *
 * A comprehensive module for parsing, processing, and rendering
 * "DeepSeek"-style chain-of-thought content (thinking blocks).
 */

/**
 * Process a final DeepSeek response, removing any remaining <think> tags
 * from the user-visible content.
 * @param {string} content - Raw content from DeepSeek
 * @returns {string} - Processed content (user-visible only)
 */
export function processDeepSeekResponse(content) {
  if (!content) return '';

  // Remove any partial or dangling <think> / </think> tags
  let processedContent = content.replace(/<\/?think>$/, '');

  // Remove nested <think> blocks from user-visible text
  const processThinkingTags = (raw) => {
    // Regex to find the first (outermost) <think>...</think> pair
    const regex = /<think>([\s\S]*?)<\/think>/;
    const match = raw.match(regex);

    if (!match) return raw; // No more <think> tags

    // Content before, inside, and after the found <think> tag
    const beforeThink = raw.substring(0, match.index);
    const afterThink = raw.substring(match.index + match[0].length);

    // Recursively process inside/after content
    const processedInside = processThinkingTags(match[1]);
    const processedAfter = processThinkingTags(afterThink);

    // Return the combined result, omitting the <think> contents
    return beforeThink + processedAfter;
  };

  processedContent = processThinkingTags(processedContent);
  return processedContent;
}

/**
 * Process a chunk of streamed content to track whether it's part of
 * "thinking" blocks vs. user-visible content. Splits text between
 * main and thinking buffers, depending on <think> tags.
 *
 * @param {string} chunkBuffer - Current chunk from SSE
 * @param {boolean} isThinking - If we're currently inside a <think> block
 * @param {string} mainBuffer - Accumulated user-visible content
 * @param {string} thinkingBuffer - Accumulated chain-of-thought content
 * @returns {Object} Updated state:
 *   {
 *     mainBuffer: string,
 *     thinkingBuffer: string,
 *     isThinking: boolean,
 *     remainingChunk: string,
 *     hasMultipleThinking: boolean
 *   }
 */
export function processStreamingChunk(chunkBuffer, isThinking, mainBuffer, thinkingBuffer) {
  // Default return structure
  const result = {
    mainBuffer: mainBuffer || '',
    thinkingBuffer: thinkingBuffer || '',
    isThinking: isThinking || false,
    remainingChunk: '',
    hasMultipleThinking: false
  };

  if (!chunkBuffer) return result;

  // See if there's an opening <think> tag in the chunk
  const openTagIndex = chunkBuffer.indexOf('<think>');

  // If there's no <think> tag at all
  if (openTagIndex === -1) {
    if (!result.isThinking) {
      // Not in thinking mode => append to main (user-visible) content
      result.mainBuffer = processDeepSeekResponse(result.mainBuffer + chunkBuffer);
    } else {
      // Currently in a <think> block => keep appending to thinking buffer
      result.thinkingBuffer += chunkBuffer;
    }
    return result;
  }

  // There's at least one <think> tag
  if (openTagIndex >= 0) {
    // Everything before <think> goes to mainBuffer if not thinking yet
    if (openTagIndex > 0 && !result.isThinking) {
      const beforeThink = chunkBuffer.substring(0, openTagIndex);
      result.mainBuffer = processDeepSeekResponse(result.mainBuffer + beforeThink);
    }

    // Check if there's a closing </think> tag
    const closeTagIndex = chunkBuffer.indexOf('</think>', openTagIndex);
    if (closeTagIndex >= 0) {
      // Found a complete <think>...</think> block
      result.isThinking = false;

      // Extract the content inside <think>...</think>
      const thinkContent = chunkBuffer.substring(openTagIndex + 7, closeTagIndex);

      // If we already have some thinking text, separate with newlines
      if (result.thinkingBuffer) {
        result.thinkingBuffer += '\n\n' + thinkContent;
        result.hasMultipleThinking = true;
      } else {
        result.thinkingBuffer = thinkContent;
      }

      // Everything after </think>
      const afterThink = chunkBuffer.substring(closeTagIndex + 8);
      const nextThinkIndex = afterThink.indexOf('<think>');
      if (nextThinkIndex >= 0) {
        // Another <think> block appears further in the chunk
        result.remainingChunk = afterThink;
        result.hasMultipleThinking = true;
      } else {
        // No more <think> blocks => treat the remainder as normal text
        result.remainingChunk = afterThink;
      }
    } else {
      // Found an opening <think> but no closing tag => partial
      result.isThinking = true;
      result.thinkingBuffer = chunkBuffer.substring(openTagIndex + 7);
    }
  }

  return result;
}

/**
 * Generates HTML for a chain-of-thought "thinking block" that can be
 * inserted into the DOM. This includes a toggle button, hidden content,
 * and an overlay gradient.
 *
 * @param {string} thinkingContent - The text to display as chain-of-thought
 * @returns {string} - HTML string representing the block
 */
export function createThinkingBlockHTML(thinkingContent) {
  const formattedContent = formatThinkingContent(thinkingContent);

  // Sanitize HTML with DOMPurify
  // Only allow minimal tags, forbid inline styles/on* attributes
  const safeContent = DOMPurify.sanitize(formattedContent, {
    ALLOWED_TAGS: ['div', 'span', 'code', 'pre', 'button', 'blockquote', 'ul', 'ol', 'li', 'table', 'tr', 'td'],
    ALLOWED_ATTR: ['class', 'aria-expanded', 'data-language'],
    FORBID_ATTR: ['style', 'on*']
  });

  // Use DOMParser to manipulate the final string if needed
  const parser = new DOMParser();
  const doc = parser.parseFromString(safeContent, 'text/html');
  const preElement = doc.querySelector('.thinking-pre');
  if (preElement) {
    // Make the text content safe
    preElement.textContent = formattedContent;
    preElement.setAttribute('data-language', 'thinking');
    preElement.setAttribute('aria-live', 'polite');
  }

  // Generate a unique ID for toggling
  const uniqueId = `thinking-content-${Date.now()}`;
  return `
    <div class="thinking-process shadow-sm my-4 new"
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
        <pre class="thinking-pre">${formattedContent}</pre>
        <div class="thinking-gradient"></div>
      </div>
    </div>
  `;
}

/**
 * Replace all <think>...</think> blocks in `content` with their
 * corresponding HTML block representation (using createThinkingBlockHTML).
 *
 * @param {string} content - The full response content (may contain <think> blocks)
 * @returns {string} - Content with chain-of-thought blocks replaced by HTML
 */
export function replaceThinkingBlocks(content) {
  if (!content) return '';

  // Extract all <think>...</think> blocks
  const thinkingBlocks = extractThinkingContent(content);
  if (thinkingBlocks.length === 0) {
    return content; // No blocks, just return original
  }

  let result = content;

  // For each block, replace the original <think> block with a sanitized HTML snippet
  thinkingBlocks.forEach(thinkContent => {
    const originalBlock = `<think>${thinkContent}</think>`;
    const blockStartIndex = result.indexOf(originalBlock);
    if (blockStartIndex !== -1) {
      const blockEndIndex = blockStartIndex + originalBlock.length;
      const beforeBlock = result.substring(0, blockStartIndex);
      const afterBlock = result.substring(blockEndIndex);

      // Create sanitized HTML
      const thinkingHTML = DOMPurify.sanitize(createThinkingBlockHTML(thinkContent));
      result = beforeBlock + thinkingHTML + afterBlock;
    }
  });

  // Remove any leftover or nested <think> blocks
  result = result.replace(/<think>[\s\S]*?<\/think>/g, '');
  return result;
}

/**
 * Initialize any pre-existing thinking blocks in the DOM
 * (e.g., after loading conversation history).
 * Attaches toggle logic, handles "new" highlight effect, etc.
 */
function initializeExistingBlocks() {
  document.querySelectorAll('.thinking-process').forEach(thinkingProcess => {
    const toggleBtn = thinkingProcess.querySelector('.thinking-toggle');
    const content = thinkingProcess.querySelector('.thinking-content');
    const toggleIcon = thinkingProcess.querySelector('.toggle-icon');

    // Mark newly inserted blocks
    if (!thinkingProcess.classList.contains('new')) {
      thinkingProcess.classList.add('new');
      setTimeout(() => {
        thinkingProcess.classList.remove('new');
      }, 2000);
    }

    // Ensure data-collapsed is set
    if (!thinkingProcess.hasAttribute('data-collapsed')) {
      thinkingProcess.setAttribute('data-collapsed', 'false');
    }

    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        toggleBtn.setAttribute('aria-expanded', !expanded);
        thinkingProcess.setAttribute('data-collapsed', expanded ? 'false' : 'true');
        content.classList.toggle('hidden', expanded);

        // Subtle icon rotation
        if (toggleIcon) {
          toggleIcon.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
          toggleIcon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        }
      });
    }
  });
}

/**
 * Extract thinking content from all <think>...</think> blocks
 * including nested blocks, if any.
 *
 * @param {string} content - The response text that may contain multiple or nested <think> blocks
 * @returns {Array<string>} - Array of extracted thinking block strings
 */
function extractThinkingContent(content) {
  if (!content) return [];
  const thinkingBlocks = [];

  // Recursive function to find and store nested <think> blocks
  const extractRecursive = (text) => {
    const openTagIndex = text.indexOf('<think>');
    if (openTagIndex === -1) return; // No <think> found

    // We'll try to find the matching </think>
    let searchStartIndex = openTagIndex + 7; // length of <think>
    let openCount = 1;
    let closeTagIndex = -1;

    while (openCount > 0 && searchStartIndex < text.length) {
      const nextOpen = text.indexOf('<think>', searchStartIndex);
      const nextClose = text.indexOf('</think>', searchStartIndex);

      if (nextClose === -1) break; // No matching closing tag
      if (nextOpen !== -1 && nextOpen < nextClose) {
        openCount++;
        searchStartIndex = nextOpen + 7;
      } else {
        openCount--;
        if (openCount === 0) {
          closeTagIndex = nextClose;
        }
        searchStartIndex = nextClose + 8; // length of </think>
      }
    }

    if (closeTagIndex !== -1) {
      // Extract the block content
      const blockContent = text.substring(openTagIndex + 7, closeTagIndex);
      thinkingBlocks.push(blockContent);

      // Recurse after this block
      const afterBlock = text.substring(closeTagIndex + 8);
      extractRecursive(afterBlock);

      // Also check for nested blocks inside the found block
      extractRecursive(blockContent);
    }
  };

  extractRecursive(content);
  return thinkingBlocks;
}

/**
 * Create a DOM element for a thinking block, including toggle interactions.
 * If you prefer returning an HTML string, use createThinkingBlockHTML instead.
 *
 * @param {string} thinkingContent - The chain-of-thought text
 * @returns {HTMLElement} A DOM element representing the thinking block
 */
function createThinkingBlock(thinkingContent) {
  const container = document.createElement('div');
  container.className = 'thinking-process shadow-sm my-4';

  // Format content
  const formattedContent = formatThinkingContent(thinkingContent);

  container.innerHTML = `
    <div class="thinking-header">
      <button class="thinking-toggle" aria-expanded="true">
        <span class="font-medium">Thinking Process</span>
        <span class="toggle-icon transition-transform duration-200">▼</span>
      </button>
    </div>
    <div class="thinking-content">
      <pre class="thinking-pre">${formattedContent}</pre>
      <div class="thinking-gradient from-thinking-bg/90 dark:from-dark-800/90 to-transparent"></div>
    </div>
  `;

  // Mark it as new for CSS transitions
  container.classList.add('new');
  setTimeout(() => {
    container.classList.remove('new');
  }, 2000);

  const toggleButton = container.querySelector('.thinking-toggle');
  const contentDiv = container.querySelector('.thinking-content');
  const toggleIcon = container.querySelector('.toggle-icon');

  if (toggleButton && contentDiv) {
    toggleButton.addEventListener('click', function() {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !expanded);
      container.setAttribute('data-collapsed', expanded ? 'false' : 'true');
      contentDiv.classList.toggle('hidden', expanded);

      if (toggleIcon) {
        toggleIcon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      }
    });
  }

  return container;
}

/**
 * Internal helper to format chain-of-thought text. This:
 *   - Removes extra blank lines
 *   - Escapes HTML
 *   - Processes code fences (```lang ... ```), inline backticks, blockquotes, etc.
 * @param {string} content - Raw chain-of-thought text
 * @returns {string} - HTML-escaped text with code blocks highlighted
 */
function formatThinkingContent(content) {
  if (!content) return '';

  // Remove excessive blank lines
  let formatted = content.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  formatted = formatted.trim();

  // Process basic markdown (quotes, lists, tables) before escaping
  formatted = processMarkdownElements(formatted);

  // Escape HTML characters so we don't inadvertently allow raw HTML
  formatted = formatted.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

  // Handle fenced code blocks: ```lang\n code ... ```
  formatted = formatted.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || 'plaintext';
    // If Prism is available, highlight it; else just use the raw text
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

  // Inline code blocks (single backticks)
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  return formatted;
}

/**
 * Convert markdown-like elements (blockquotes, lists, tables)
 * into HTML. This is a lightweight, partial markdown converter.
 *
 * @param {string} content - Possibly containing markdown syntax
 * @returns {string} - A best-effort at structured HTML
 */
function processMarkdownElements(content) {
  if (!content) return '';

  let processed = content;

  // Blockquotes (lines starting with `> `)
  processed = processed.replace(/^>[ \t](.*)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  processed = processed.replace(/^[ \t]*[-*+][ \t]+(.*)$/gm, '<li>$1</li>');
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered lists
  processed = processed.replace(/^[ \t]*(\d+)\.[ \t]+(.*)$/gm, '<li>$2</li>');
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, '<ol>$&</ol>');

  // Collapse multiple consecutive <ul> or <ol> tags
  processed = processed.replace(/<\/ul>\s*<ul>/g, '');
  processed = processed.replace(/<\/ol>\s*<ol>/g, '');

  // Simple tables
  processed = processed.replace(/^\|(.+)\|$/gm, '<tr><td>$1</td></tr>');
  processed = processed.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>');

  return processed;
}

/**
 * Export a single object that centralizes all DeepSeek text/DOM processing.
 */
export const deepSeekProcessor = {
  processDeepSeekResponse,
  processStreamingChunk,
  createThinkingBlockHTML,
  replaceThinkingBlocks,
  initializeExistingBlocks,
  extractThinkingContent,
  createThinkingBlock
};
