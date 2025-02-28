/**
 * deepseekProcessor.js
 * Update the file to include comprehensive functionality
 */

/**
 * Process DeepSeek-R1 response format, handling <think> tags
 * @param {string} content - Raw content from DeepSeek-R1
 * @returns {string} - Processed content ready for rendering
 */
export function processDeepSeekResponse(content) {
  if (!content) return '';

  // Remove any partial thinking tags that might have slipped through
  let processedContent = content.replace(/<\/?think>$/, '');

  // Replace thinking blocks with properly formatted blocks
  // Use a recursive function to handle nested thinking tags
  const processThinkingTags = (content) => {
    // Look for the outermost thinking tags first
    const regex = /<think>([\s\S]*?)<\/think>/;
    const match = content.match(regex);
    
    if (!match) return content;
    
    // Get the content before, inside, and after the thinking tag
    const beforeThink = content.substring(0, match.index);
    const afterThink = content.substring(match.index + match[0].length);
    
    // Process the content inside the thinking tag recursively
    const thinkContent = processThinkingTags(match[1]);
    
    // Process the content after the thinking tag recursively
    const processedAfterThink = processThinkingTags(afterThink);
    
    // Return the content with thinking tags removed
    return beforeThink + processedAfterThink;
  };
  
  processedContent = processThinkingTags(processedContent);

  return processedContent;
}

/**
 * Process a chunk of streamed content, handling thinking blocks incrementally
 * @param {string} chunkBuffer - Current buffer of content being processed
 * @param {boolean} isThinking - Whether we're currently inside a thinking block
 * @param {string} mainBuffer - Current main content buffer
 * @param {string} thinkingBuffer - Current thinking content buffer
 * @returns {Object} - Updated state {mainBuffer, thinkingBuffer, isThinking, remainingChunk}
 */
export function processStreamingChunk(chunkBuffer, isThinking, mainBuffer, thinkingBuffer) {
  // Return object with defaults
  const result = {
    mainBuffer: mainBuffer || '',
    thinkingBuffer: thinkingBuffer || '',
    isThinking: isThinking || false,
    remainingChunk: '',
    hasMultipleThinking: false
  };

  if (!chunkBuffer) return result;

  // Look for thinking blocks
  const openTagIndex = chunkBuffer.indexOf('<think>');

  // No thinking tags found
  if (openTagIndex === -1) {
    if (!result.isThinking) {
      // If not in thinking mode, append to main content
      result.mainBuffer = processDeepSeekResponse(result.mainBuffer + chunkBuffer);
    } else {
      // If in thinking mode, append to thinking content
      result.thinkingBuffer += chunkBuffer;
    }
    return result;
  }

  // Handle start of thinking block
  if (openTagIndex >= 0) {
    // Process content before thinking block
    if (openTagIndex > 0 && !result.isThinking) {
      const beforeThink = chunkBuffer.substring(0, openTagIndex);
      result.mainBuffer = processDeepSeekResponse(result.mainBuffer + beforeThink);
    }

    // Check for closing tag
    const closeTagIndex = chunkBuffer.indexOf('</think>', openTagIndex);

    if (closeTagIndex >= 0) {
      // Complete thinking block found
      result.isThinking = false;

      // Extract thinking content without the tags
      const thinkContent = chunkBuffer.substring(openTagIndex + 7, closeTagIndex);
      
      // Handle multiple thinking blocks in the same chunk
      if (result.thinkingBuffer) {
        result.thinkingBuffer += '\n\n' + thinkContent;
        result.hasMultipleThinking = true;
      } else {
        result.thinkingBuffer = thinkContent;
      }

      // Check if there are more thinking blocks after this one
      const afterThink = chunkBuffer.substring(closeTagIndex + 8);
      const nextThinkIndex = afterThink.indexOf('<think>');
      
      if (nextThinkIndex >= 0) {
        // We have another thinking block
        result.remainingChunk = afterThink;
        result.hasMultipleThinking = true;
      } else {
        // No more thinking blocks, process the rest as normal content
        result.remainingChunk = afterThink;
      }
    } else {
      // Partial thinking block - still collecting
      result.isThinking = true;
      result.thinkingBuffer = chunkBuffer.substring(openTagIndex + 7);
    }
  }

  return result;
}

/**
 * Creates HTML for a thinking block to be inserted into the DOM
 * @param {string} thinkingContent - The content inside the thinking block
 * @returns {string} - HTML string for the thinking block
 */
export function createThinkingBlockHTML(thinkingContent) {
  const formattedContent = formatThinkingContent(thinkingContent);
  const safeContent = DOMPurify.sanitize(formattedContent, {
    ALLOWED_TAGS: ['div', 'span', 'code', 'pre', 'button'],
    ALLOWED_ATTR: ['class', 'aria-expanded', 'data-language'],
    FORBID_ATTR: ['style', 'on*']
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(safeContent, 'text/html');
  const preElement = doc.querySelector('.thinking-pre');
  
  // Security-conscious DOM manipulation
  if (preElement) {
    preElement.textContent = formattedContent; // Set content as text instead of HTML
    preElement.setAttribute('data-language', 'thinking');
    preElement.setAttribute('aria-live', 'polite');
  }

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
 * Format the thinking content for better readability
 * @param {string} content - Raw thinking content
 * @returns {string} - Formatted thinking content
 */
function formatThinkingContent(content) {
  if (!content) return '';
  
  // Remove excessive blank lines (more than 2 consecutive newlines)
  let formatted = content.replace(/\n{3,}/g, '\n\n');
  
  // Trim leading/trailing whitespace
  formatted = formatted.trim();
  
  // Process markdown elements in thinking content
  // First handle blockquotes, lists, and tables
  formatted = processMarkdownElements(formatted);

  // Escape HTML characters before any processing
  formatted = formatted.replace(/[&<>"']/g, (char) => 
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]
  );

  // Improved code block handling with syntax highlighting
  formatted = formatted.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || 'plaintext';
    const highlighted = Prism?.highlight(code.trim(), Prism.languages[language], language);
    return `<div class="code-block" data-language="${language}">
      <div class="code-block-header" aria-label="${language} code">${language}</div>
      <pre class="language-${language}"><code class="language-${language}">${
        highlighted || code.trim()
      }</code></pre>
    </div>`;
  });
  
  // Handle inline code blocks (single backticks)
  formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  
  return formatted;
}

/**
 * Process markdown elements like blockquotes, lists, and tables
 * @param {string} content - Raw content with markdown
 * @returns {string} - Content with markdown elements processed
 */
function processMarkdownElements(content) {
  if (!content) return '';
  
  let processed = content;
  
  // Process blockquotes
  processed = processed.replace(/^>[ \t](.*)$/gm, '<blockquote>$1</blockquote>');
  
  // Process unordered lists
  processed = processed.replace(/^[ \t]*[-*+][ \t]+(.*)$/gm, '<li>$1</li>');
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  // Process ordered lists
  processed = processed.replace(/^[ \t]*(\d+)\.[ \t]+(.*)$/gm, '<li>$2</li>');
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, '<ol>$&</ol>');
  
  // Simplify nested list handling
  processed = processed.replace(/<\/ul>\s*<ul>/g, '');
  processed = processed.replace(/<\/ol>\s*<ol>/g, '');
  
  // Basic table handling
  processed = processed.replace(/^\|(.+)\|$/gm, '<tr><td>$1</td></tr>');
  processed = processed.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>');
  
  return processed;
}

/**
 * Replace thinking blocks with HTML elements in final content
 * @param {string} content - Content with thinking blocks
 * @returns {string} - Content with thinking blocks replaced with HTML
 */
export function replaceThinkingBlocks(content) {
  if (!content) return '';

  // Extract all thinking blocks using our robust extractor
  const thinkingBlocks = extractThinkingContent(content);
  
  // If no thinking blocks found, return the original content
  if (thinkingBlocks.length === 0) {
    return content;
  }
  
  // Process content to replace thinking blocks with HTML
  let result = content;
  
  // Handle each thinking block
  thinkingBlocks.forEach(thinkContent => {
    // Find the original block in the content and replace it
    const blockStartIndex = result.indexOf(`<think>${thinkContent}</think>`);
    if (blockStartIndex !== -1) {
      const blockEndIndex = blockStartIndex + thinkContent.length + 15; // 15 = <think></think> length
      const beforeBlock = result.substring(0, blockStartIndex);
      const afterBlock = result.substring(blockEndIndex);
      
      // Insert thinking block HTML
      const thinkingHTML = DOMPurify.sanitize(createThinkingBlockHTML(thinkContent));
      result = beforeBlock + thinkingHTML + afterBlock;
    }
  });
  
  // Clean up any remaining thinking blocks that might be nested
  result = result.replace(/<think>[\s\S]*?<\/think>/g, '');
  
  return result;
}

/**
 * Initialize any existing thinking blocks in the DOM
 * This is useful when content is loaded from history
 */
function initializeExistingBlocks() {
  document.querySelectorAll('.thinking-process').forEach(thinkingProcess => {
    const toggleBtn = thinkingProcess.querySelector('.thinking-toggle');
    const content = thinkingProcess.querySelector('.thinking-content');
    const toggleIcon = thinkingProcess.querySelector('.toggle-icon');

    // Add necessary data attributes for animation state management
    if (!thinkingProcess.hasAttribute('data-collapsed')) {
      thinkingProcess.setAttribute('data-collapsed', 'false');
    }

    // Apply smooth entrance animation to blocks that don't have the 'new' class yet
    if (!thinkingProcess.classList.contains('new')) {
      thinkingProcess.classList.add('new');
      
      // Remove animation class after it completes
      setTimeout(() => {
        thinkingProcess.classList.remove('new');
      }, 2000);
    }

    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        
        // Update accessibility attributes
        toggleBtn.setAttribute('aria-expanded', !expanded);
        thinkingProcess.setAttribute('data-collapsed', expanded ? 'false' : 'true');
        
        // Apply animations
        content.classList.toggle('hidden', expanded);
        
        // Ensure height transitions work properly by forcing a reflow
        if (!expanded) {
          window.getComputedStyle(content).getPropertyValue('opacity');
        }
        
        // Animate icon with spring physics for a more natural feel
        if (toggleIcon) {
          toggleIcon.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
          toggleIcon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
          toggleIcon.textContent = '▼'; // Always use same icon but rotate it
        }
      });
    }
  });
}

/**
 * Extract thinking content from a DeepSeek response
 * @param {string} content - Full response content
 * @returns {Array<string>} - Array of extracted thinking content blocks
 */
function extractThinkingContent(content) {
  if (!content) return [];
  
  const thinkingBlocks = [];
  let remainingContent = content;
  let nestedLevel = 0;
  
  // Find all thinking blocks, including nested ones
  const extractRecursive = (text, level = 0) => {
    const openTagIndex = text.indexOf('<think>');
    if (openTagIndex === -1) return;
    
    // Find the matching closing tag
    let searchStartIndex = openTagIndex + 7; // length of <think>
    let openTagCount = 1;
    let closeTagIndex = -1;
    
    while (openTagCount > 0 && searchStartIndex < text.length) {
      const nextOpenTag = text.indexOf('<think>', searchStartIndex);
      const nextCloseTag = text.indexOf('</think>', searchStartIndex);
      
      // No more tags found
      if (nextCloseTag === -1) break;
      
      // Found another opening tag before a closing tag
      if (nextOpenTag !== -1 && nextOpenTag < nextCloseTag) {
        openTagCount++;
        searchStartIndex = nextOpenTag + 7;
      } else {
        // Found a closing tag
        openTagCount--;
        if (openTagCount === 0) {
          closeTagIndex = nextCloseTag;
        }
        searchStartIndex = nextCloseTag + 8; // length of </think>
      }
    }
    
    if (closeTagIndex !== -1) {
      // Extract this thinking block
      const thinkContent = text.substring(openTagIndex + 7, closeTagIndex);
      thinkingBlocks.push(thinkContent);
      
      // Continue searching in the remaining text
      const remainingText = text.substring(closeTagIndex + 8);
      extractRecursive(remainingText, level + 1);
      
      // Also check for nested thinking blocks within this block
      extractRecursive(thinkContent, level + 1);
    }
  };
  
  extractRecursive(remainingContent);
  return thinkingBlocks;
}

/**
 * Create a standalone thinking block for insertion into the DOM
 * @param {string} thinkingContent - Raw thinking content
 * @returns {HTMLElement} - DOM element for the thinking block
 */
function createThinkingBlock(thinkingContent) {
  const container = document.createElement('div');
  container.className = 'thinking-process shadow-sm my-4';

  // Format the thinking content
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

  // Add enhanced toggle functionality with animations
  const toggleButton = container.querySelector('.thinking-toggle');
  const contentDiv = container.querySelector('.thinking-content');
  const toggleIcon = container.querySelector('.toggle-icon');
  
  // Add 'new' class for the initial animation
  container.classList.add('new');
  
  // Remove 'new' class after animation completes
  setTimeout(() => {
    container.classList.remove('new');
  }, 2000);

  if (toggleButton && contentDiv) {
    toggleButton.addEventListener('click', function() {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      
      // Update attributes for accessibility
      this.setAttribute('aria-expanded', !expanded);
      container.setAttribute('data-collapsed', expanded ? 'false' : 'true');
      
      // Apply animations using classes instead of inline styles
      contentDiv.classList.toggle('hidden', expanded);
      
      // Smoother icon rotation with spring physics
      if (toggleIcon) {
        toggleIcon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      }
    });
  }

  return container;
}

// Export the DeepSeek processor object
export const deepSeekProcessor = {
  processDeepSeekResponse,
  processStreamingChunk,
  createThinkingBlockHTML,
  replaceThinkingBlocks,
  initializeExistingBlocks,
  extractThinkingContent,
  createThinkingBlock
};
