/**
 * DeepSeek-R1 Response Processor
 * 
 * This module handles the special formatting and processing needed for
 * DeepSeek-R1 model responses, particularly the <think>...</think> tags
 * that contain the model's chain-of-thought reasoning.
 */

/**
 * Process DeepSeek-R1 response content to handle thinking tags
 * @param {string} content - The raw content from the model
 * @param {boolean} showThinking - Whether to display the thinking process (default: true)
 * @returns {string} - Processed content with thinking tags formatted or removed
 */
export function processDeepSeekResponse(content, showThinking = true) {
    if (!content) return '';
    
    // Check if we have thinking tags
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    
    if (!content.match(thinkRegex)) {
        // No thinking tags found, return as is
        return content;
    }
    
    console.log('DeepSeek thinking tags detected in content');
    
    if (!showThinking) {
        // Remove thinking tags completely if not showing
        return content.replace(thinkRegex, '');
    }
    
    // Process and format the thinking content
    let processedContent = content;
    let match;
    
    while ((match = thinkRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const thinkingContent = match[1];
        
        // Format the thinking content with a collapsible section
        const formattedThinking = `
            <div class="thinking-process my-3 border border-blue-200 dark:border-blue-800 rounded-md overflow-hidden">
                <div class="thinking-header bg-blue-50 dark:bg-blue-900/30 px-3 py-2">
                    <button class="thinking-toggle w-full text-left flex items-center justify-between text-blue-700 dark:text-blue-300" 
                            aria-expanded="true" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'); this.closest('.thinking-process').querySelector('.thinking-content').classList.toggle('hidden');">
                        <span class="font-medium">Thinking Process</span>
                        <span class="toggle-icon transition-transform duration-200" 
                              style="transform: rotate(0deg);">▼</span>
                    </button>
                </div>
                <div class="thinking-content bg-blue-50/50 dark:bg-blue-900/10 px-4 py-3">
                    <div class="thinking-pre font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200">${thinkingContent}</div>
                </div>
            </div>
        `;
        
        processedContent = processedContent.replace(fullMatch, formattedThinking);
    }
    
    return processedContent;
}

/**
 * Add necessary styles for DeepSeek thinking sections
 */
export function injectDeepSeekStyles() {
    // Check if styles are already added
    if (document.getElementById('deepseek-styles')) return;
    
    const styleEl = document.createElement('style');
    styleEl.id = 'deepseek-styles';
    styleEl.textContent = `
        .thinking-process {
            margin: 1rem 0;
        }
        
        .thinking-toggle[aria-expanded="false"] + .thinking-content {
            display: none;
        }
        
        .thinking-toggle[aria-expanded="false"] .toggle-icon {
            transform: rotate(-90deg);
        }
        
        .thinking-pre {
            white-space: pre-wrap;
            overflow-x: auto;
        }
        
        @media (max-width: 640px) {
            .thinking-pre {
                font-size: 0.75rem;
            }
        }
    `;
    
    document.head.appendChild(styleEl);
}
