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
    remainingChunk: ''
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
      result.thinkingBuffer = thinkContent;

      // Process content after closing tag
      const afterThink = chunkBuffer.substring(closeTagIndex + 8);
      result.remainingChunk = afterThink;
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
  // Format the thinking content
  const formattedContent = formatThinkingContent(thinkingContent);
  
  return `
    <div class="thinking-process shadow-sm my-4">
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
  
  // Add syntax highlighting for code blocks in thinking content
  // This regex now safely handles multiple code blocks and backticks within code
  formatted = formatted.replace(/```([\w-]*)\n([\s\S]*?)```/g, (match, language, code) => {
    // Clean up the code and escape any backticks within it
    const cleanCode = code.trim()
      .replace(/`/g, '&#96;'); // Escape backticks to prevent breaking out
    
    // Return with a special class for potential syntax highlighting
    return `<div class="code-block ${language ? `language-${language}` : ''}">
      <div class="code-block-header">${language || 'code'}</div>
      <code>${cleanCode}</code>
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

  return content.replace(
    /<think>([\s\S]*?)<\/think>/g,
    (match, thinking) => createThinkingBlockHTML(thinking)
  );
}

/**
 * Initialize any existing thinking blocks in the DOM
 * This is useful when content is loaded from history
 */
function initializeExistingBlocks() {
  document.querySelectorAll('.thinking-process').forEach(thinkingProcess => {
    const toggleBtn = thinkingProcess.querySelector('.thinking-toggle');
    const content = thinkingProcess.querySelector('.thinking-content');

    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        toggleBtn.setAttribute('aria-expanded', !expanded);
        content.classList.toggle('hidden', expanded);
        toggleBtn.querySelector('.toggle-icon').style.transform =
          expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
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

  // Add toggle functionality
  const toggleButton = container.querySelector('.thinking-toggle');
  const contentDiv = container.querySelector('.thinking-content');

  if (toggleButton && contentDiv) {
    toggleButton.addEventListener('click', function() {
      const expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', !expanded);
      contentDiv.classList.toggle('hidden', expanded);
      this.querySelector('.toggle-icon').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
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
