/**
 * DeepSeek-R1 Response Processor
 * Handles DeepSeek-specific formatting, including thinking blocks
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
  container.className = 'thinking-process border border-blue-200 dark:border-blue-800 rounded-md overflow-hidden my-3';
  
  container.innerHTML = `
    <div class="thinking-header bg-blue-50 dark:bg-blue-900/30 px-3 py-2">
      <button class="thinking-toggle w-full text-left flex items-center justify-between text-blue-700 dark:text-blue-300" aria-expanded="true">
        <span class="font-medium">Thinking Process</span>
        <span class="toggle-icon transition-transform duration-200">▼</span>
      </button>
    </div>
    <div class="thinking-content bg-blue-50/50 dark:bg-blue-900/10 relative">
      <pre class="thinking-pre font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200 px-4 py-3 max-h-[300px] overflow-y-auto">${thinkingContent}</pre>
      <div class="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-blue-50/90 dark:from-blue-900/30 to-transparent pointer-events-none"></div>
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
  initializeExistingBlocks,
  extractThinkingContent,
  createThinkingBlock
};
