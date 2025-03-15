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

let markdownParser = null;

export async function configureMarkdown() {
    if (markdownParser) return true;

    try {
        const [{ default: MarkdownIt }, { default: emoji }, { default: footnote }] = await Promise.all([
            import('markdown-it'),
            import('markdown-it-emoji'),
            import('markdown-it-footnote')
        ]);

        markdownParser = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
            breaks: true,
            highlight(str, lang) {
                if (typeof Prism !== 'undefined' && lang && Prism.languages[lang]) {
                    try {
                        return Prism.highlight(str, Prism.languages[lang], lang);
                    } catch (e) {
                        console.warn('Prism highlighting failed:', e);
                    }
                }
                return MarkdownIt().utils.escapeHtml(str);
            }
        }).use(emoji).use(footnote);

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
      .markdown-content blockquote {
        @apply my-4 pl-4 text-gray-600 dark:text-gray-300 border-l-4 border-gray-200 dark:border-gray-600;
      }
      .markdown-content ul, .markdown-content ol {
        @apply my-4 pl-8;
      }
      .markdown-content li {
        @apply my-2;
      }
      .markdown-content img {
        @apply max-w-full h-auto rounded-lg;
      }
      .markdown-content hr {
        @apply my-8 border-t border-gray-200 dark:border-gray-700;
      }
      .markdown-content table {
        @apply w-full my-4 border-collapse;
      }
      .markdown-content th, .markdown-content td {
        @apply px-2 py-1 border border-gray-200 dark:border-gray-700 text-left;
      }
      .markdown-content th {
        @apply bg-gray-50 dark:bg-gray-800 font-semibold;
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
