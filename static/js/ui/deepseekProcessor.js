export class DeepSeekProcessor {
    constructor() {
        this.thinkBlockRegex = /<think\b[^>]*>([\s\S]*?)<\/think\b[^>]*>/gi;
        this.activeBlocks = new Map();
        this.blockCounter = 0;
        this.observer = null;
    }

    /**
     * Process content containing <think> blocks
     * @param {string} content - Raw model response content
     * @param {boolean} isStreaming - Whether processing streaming content
     * @returns {Object} Processed content and extracted thinking blocks
     */
    processContent(content, isStreaming = false) {
        const blocks = new Map();
        let processedContent = content;
        let match;

        while ((match = this.thinkBlockRegex.exec(content)) !== null) {
            const [fullMatch, thinkContent] = match;
            const blockId = `think-${this.blockCounter++}`;
            
            const sanitizedContent = this.sanitizeContent(thinkContent);
            const html = this.generateBlockHTML(sanitizedContent, blockId);
            
            blocks.set(blockId, {
                content: sanitizedContent,
                html: html,
                startIndex: match.index,
                endIndex: match.index + fullMatch.length
            });
        }

        // Replace original think blocks with placeholders
        processedContent = processedContent.replace(this.thinkBlockRegex, () => {
            return `<div data-think-id="${Array.from(blocks.keys()).pop()}"></div>`;
        });

        if (isStreaming) {
            this.activeBlocks = new Map([...this.activeBlocks, ...blocks]);
        }

        return {
            processedContent,
            thinkingBlocks: blocks
        };
    }

    /**
     * Generate accessible HTML for thinking blocks
     * @param {string} content - Sanitized thinking content
     * @param {string} blockId - Unique block identifier
     * @returns {string} HTML string
     */
    generateBlockHTML(content, blockId) {
        return `
            <div class="thinking-block group" data-block-id="${blockId}">
                <button class="thinking-toggle w-full flex justify-between items-center p-2 
                            bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30
                            transition-colors border-b border-blue-200 dark:border-blue-800"
                        id="toggle-${blockId}" 
                        aria-expanded="false" 
                        aria-controls="content-${blockId}">
                    <span class="font-medium text-blue-700 dark:text-blue-300">
                        Thinking Process
                    </span>
                    <span class="toggle-icon transform transition-transform duration-200 
                               text-blue-500 dark:text-blue-400">
                        ▼
                    </span>
                </button>
                <div id="content-${blockId}" 
                     class="thinking-content hidden p-3 bg-white dark:bg-dark-800 
                            prose-pre:bg-blue-50 dark:prose-pre:bg-blue-900/10">
                    <pre class="whitespace-pre-wrap break-words font-mono text-sm">${content}</pre>
                </div>
            </div>
        `;
    }

    /**
     * Handle streaming content updates
     * @param {HTMLElement} container - DOM element to update
     * @param {string} chunk - New content chunk
     */
    processStreamChunk(container, chunk) {
        const processed = this.processContent(chunk, true);
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = processed.processedContent;

        // Walk through new nodes to find placeholders
        Array.from(tempDiv.querySelectorAll('[data-think-id]')).forEach(placeholder => {
            const blockId = placeholder.getAttribute('data-think-id');
            const block = this.activeBlocks.get(blockId);
            
            if (block) {
                const blockNode = this.htmlToElement(block.html);
                placeholder.replaceWith(blockNode);
                this.initializeBlock(blockNode);
            }
        });
i
        // Merge with existing content
        this.mergeStreamContent(container, tempDiv);
    }

    /**
     * Initialize block interactions and accessibility
     * @param {HTMLElement} block - Thinking block element
     */
    initializeBlock(block) {
        const toggle = block.querySelector('.thinking-toggle');
        const content = block.querySelector('.thinking-content');

        const toggleHandler = () => {
            const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', !isExpanded);
            content.classList.toggle('hidden');
            toggle.querySelector('.toggle-icon').classList.toggle('rotate-180');
        };

        // Click handler
        toggle.addEventListener('click', toggleHandler);

        // Keyboard navigation
        toggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleHandler();
            }
        });
    }

    // Helper methods
    sanitizeContent(content) {
        return window.sanitizeHTML(content) || '';
    }

    htmlToElement(html) {
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        return template.content.firstChild;
    }

    mergeStreamContent(container, newContent) {
        const walker = document.createTreeWalker(newContent, NodeFilter.SHOW_TEXT);
        let node;
        let lastText = '';

        while ((node = walker.nextNode())) {
            if (node.parentNode.nodeName === 'PRE') continue;
            lastText += node.textContent;
        }

        if (container.lastChild?.nodeType === Node.TEXT_NODE) {
            container.lastChild.textContent += lastText;
        } else {
            container.appendChild(document.createTextNode(lastText));
        }

        Array.from(newContent.children).forEach(child => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                container.appendChild(child.cloneNode(true));
            }
        });
    }

    /**
     * Initialize all thinking blocks on page load
     */
    initializeExistingBlocks() {
        document.querySelectorAll('.thinking-block').forEach(block => {
            this.initializeBlock(block);
        });
    }
}

// Singleton instance
export const deepSeekProcessor = new DeepSeekProcessor();

// Initialize existing blocks on DOM load
document.addEventListener('DOMContentLoaded', () => {
    deepSeekProcessor.initializeExistingBlocks();
});
