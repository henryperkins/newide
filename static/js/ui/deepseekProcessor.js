/**
 * DeepSeek-R1 Response Processor
 * 
 * This module handles the processing and formatting of 
 * DeepSeek-R1 model responses, particularly the <think>...</think> tags
 * that contain the model's chain-of-thought reasoning.
 */

/**
 * Process DeepSeek-R1 response content to handle thinking tags
 * 
 * @param {string} content - The raw content from the model
 * @param {boolean} showThinking - Whether to display the thinking process (default: true)
 * @returns {string} - Processed content with thinking tags formatted or removed
 */
export function processDeepSeekResponse(content, showThinking = true) {
    // Check if we have thinking tags
    if (!content.includes('<think>')) {
        // No thinking tags found, return as is
        return content;
    }
    
    console.log('DeepSeek thinking tags detected in content');

    if (!showThinking) {
        // Remove thinking tags completely if not showing
        return content.replace(/<think>[\s\S]*?<\/think>/g, '');
    }

    // Process and format the thinking content
    let processedContent = content;
    
    // Replace <think>...</think> blocks with formatted HTML
    processedContent = processedContent.replace(/<think>([\s\S]*?)<\/think>/g, (fullMatch, thinkingContent) => {
        // Format the thinking content with a collapsible section
        const formattedThinking = `
            <div class="thinking-process my-3 border border-blue-200 dark:border-blue-800 rounded-md overflow-hidden">
                <div class="thinking-header bg-blue-50 dark:bg-blue-900/30 px-3 py-2">
                    <button class="thinking-toggle w-full text-left flex items-center justify-between text-blue-700 dark:text-blue-300" 
                            aria-expanded="true" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'); this.closest('.thinking-process').querySelector('.thinking-content').classList.toggle('hidden');">
                        <span class="font-medium">Thinking Process</span>
                        <span class="toggle-icon">▼</span>
                    </button>
                </div>
                <div class="thinking-content bg-blue-50/50 dark:bg-blue-900/10 px-4 py-3">
                    <div class="thinking-pre font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200">${thinkingContent}</div>
                </div>
            </div>
        `;
        
        processedContent = processedContent.replace(fullMatch, formattedThinking);
        return formattedThinking;
    });
    
    return processedContent;
}

/**
 * Add necessary styles for DeepSeek thinking sections
 * Note: These are added as a fallback in case Tailwind doesn't include them
 */
function addThinkingStyles() {
    const styleId = 'deepseek-thinking-styles';
    if (document.getElementById(styleId)) {
        return; // Already added
    }
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .thinking-process {
            position: relative;
            margin: 1rem 0;
        }
        
        .thinking-toggle[aria-expanded="false"] + .thinking-content {
            display: none;
        }
        
        .thinking-toggle[aria-expanded="false"] .toggle-icon {
            transform: rotate(-90deg);
        }
        
        .thinking-pre {
            max-height: 300px;
            overflow-y: auto;
        }
        
        @media (max-width: 640px) {
            .thinking-pre {
                max-height: 200px;
            }
        }
    `;
    
    document.head.appendChild(style);
}

// Ensure styles are added when this module is imported
if (typeof window !== 'undefined') {
    addThinkingStyles();
}
