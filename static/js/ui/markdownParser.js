// DOMPurify is loaded as a global object

let stylesInjected = false;
let markdownParser = null;

/**
 * Render markdown content to HTML
 * @param {string} content - The markdown content to render
 * @returns {string} HTML content
 */
export function renderMarkdown(content) {
    if (!content) return '';
    return safeMarkdownParse(content);
}

/**
 * Sanitize HTML content to prevent XSS
 * @param {string} content - The HTML content to sanitize
 * @returns {string} Sanitized HTML
 */
const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li',
    'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'sup', 'sub', 'div', 'span', 'think' // Ensure <think> tags are allowed
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel',
                 'aria-expanded', 'aria-controls', 'data-think-id'],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: [['target', '_blank'], ['rel', 'noopener noreferrer']],
  FORBID_TAGS: ['style', 'script'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  FORCE_ALLOWED_ATTR: ['class', 'style']
};

export function sanitizeHTML(content) {
  if (!content) return '';
  return DOMPurify.sanitize(content, SANITIZE_OPTIONS);
}

/**
 * Apply syntax highlighting to code blocks in an element
 * @param {HTMLElement} element - The element containing code blocks
 */
export function highlightCode(element) {
    if (!element || typeof Prism === 'undefined') return;
    
    try {
        // Find all code blocks in the element
        const codeBlocks = element.querySelectorAll('pre code');
        
        // Apply Prism highlighting to each block
        codeBlocks.forEach(block => {
            // Get the language class if it exists
            const languageClass = Array.from(block.classList)
                .find(cls => cls.startsWith('language-'));
                
            if (languageClass) {
                const language = languageClass.replace('language-', '');
                if (Prism.languages[language]) {
                    // Only highlight if we haven't already
                    if (!block.classList.contains('prism-highlighted')) {
                        Prism.highlightElement(block);
                        block.classList.add('prism-highlighted');
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error applying syntax highlighting:', error);
    }
}

/**
 * Configure markdown parser with required settings
 * @returns {boolean} True if configuration was successful
 */
export function configureMarkdown() {
    try {
        if (typeof markdownit === 'undefined') {
            console.warn('markdownit library not loaded');
            return false;
        }

        markdownParser = markdownit({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true,
            highlight: function (str, lang) {
                if (typeof Prism !== 'undefined' && lang && Prism.languages[lang]) {
                    try {
                        return Prism.highlight(str, Prism.languages[lang], lang);
                    } catch (e) {
                        console.warn('Prism highlighting failed:', e);
                    }
                }
                // If we can't highlight, escape the code so it's still displayed
                return markdownit().utils.escapeHtml(str);
            }
        });

        // Attempt to load some optional plugins for richer formatting
        if (typeof window.markdownitEmoji !== 'undefined') {
            markdownParser.use(window.markdownitEmoji);
        }
        if (typeof window.markdownitFootnote !== 'undefined') {
            markdownParser.use(window.markdownitFootnote);
        }
        return true;
        return true;
    } catch (error) {
        console.error('Failed to configure markdown parser:', error);
        return false;
    }
}

/**
 * Safely parse markdown content with sanitization
 * @param {string} content - The markdown content to parse
 * @returns {string} Sanitized HTML
 */
export function safeMarkdownParse(content) {
    if (!content) return '';
    
    try {
        if (!markdownParser) {
            if (!configureMarkdown()) {
                return escapeHtml(content);
            }
        }

        const parsed = markdownParser.render(content);
        return DOMPurify.sanitize(parsed, SANITIZE_OPTIONS);
    } catch (error) {
        console.error('Markdown parsing failed:', error);
        return escapeHtml(content);
    }
}

/**
 * Inject markdown styles if not already injected
 */
export function injectMarkdownStyles() {
    if (stylesInjected) return;
    
    const style = document.createElement('style');
    style.id = 'markdown-styles';
    style.textContent = `
      .markdown-content {
        @apply prose prose-gray max-w-none dark:prose-invert;
      }
      .markdown-content pre {
        @apply bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto;
      }
      .markdown-content code:not(pre code) {
        @apply bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm;
      }
    `;
        
        .markdown-content blockquote {
            margin: 1em 0;
            padding-left: 1em;
            color: #4b5563;
            border-left: 4px solid #e5e7eb;
        }
        
        .markdown-content ul, .markdown-content ol {
            margin: 1em 0;
            padding-left: 2em;
        }
        
        .markdown-content li {
            margin: 0.5em 0;
        }
        
        .markdown-content img {
            max-width: 100%;
            height: auto;
            border-radius: 6px;
        }
        
        .markdown-content hr {
            margin: 2em 0;
            border: 0;
            border-top: 1px solid #e5e7eb;
        }
        
        .markdown-content table {
            width: 100%;
            margin: 1em 0;
            border-collapse: collapse;
        }
        
        .markdown-content th, .markdown-content td {
            padding: 0.5em;
            border: 1px solid #e5e7eb;
            text-align: left;
        }
        
        .markdown-content th {
            background-color: #f9fafb;
            font-weight: 600;
        }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

/**
 * Escape HTML special characters
 * @param {string} unsafe - The string to escape
 * @returns {string} Escaped string
 */
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
