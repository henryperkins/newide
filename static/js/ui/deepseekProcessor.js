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
  processedContent = processedContent.replace(/<think>([\s\S]*?)<\/think>/g, (match, thinking) => {
    // Thinking blocks have been extracted during streaming
    // Just remove the tags from the main content
    return '';
  });

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
  
  // Add syntax highlighting for code blocks in thinking content
  // This regex looks for markdown-style code blocks ```language...```
  formatted = formatted.replace(/```(\w*)([\s\S]*?)```/g, (match, language, code) => {
    // Clean up the code
    const cleanCode = code.trim();
    
    // Return with a special class for potential syntax highlighting
    return `<div class="code-block ${language ? `language-${language}` : ''}">
      <div class="code-block-header">${language || 'code'}</div>
      <code>${cleanCode}</code>
    </div>`;
  });
  
  return formatted;
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
 * @returns {string} - Extracted thinking content
 */
function extractThinkingContent(content) {
  const thinkingMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  return thinkingMatch ? thinkingMatch[1] : null;
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
