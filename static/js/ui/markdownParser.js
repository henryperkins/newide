let mdParser = null;

export function injectMarkdownStyles() {
    if (document.getElementById('markdown-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'markdown-styles';
    style.textContent = `
        .markdown-content {
            line-height: 1.6;
            font-family: var(--font-primary);
        }
        .markdown-content pre {
            background: var(--code-bg);
            padding: 1em;
            border-radius: 4px;
            overflow-x: auto;
        }
        .markdown-content code {
            font-family: var(--font-mono);
            background: var(--code-bg);
            padding: 0.2em 0.4em;
            border-radius: 3px;
        }
        .markdown-content p {
            margin: 0.5em 0;
        }
    `;
    document.head.appendChild(style);
}

export function configureMarkdown() {
    if (typeof markdownit !== 'undefined' && !mdParser) {
        mdParser = markdownit({
            html: false,
            breaks: true,
            linkify: true,
            highlight: (str, lang) => {
                if (typeof Prism !== 'undefined') {
                    return Prism.highlight(str, Prism.languages[lang] || {}, lang);
                }
                return str;
            }
        });
        return true;
    }
    return false;
}

export function safeMarkdownParse(text) {
    if (!mdParser) {
        configureMarkdown();
        if (!mdParser) return text;
    }

    try {
        // Sanitize input before parsing
        const sanitized = sanitizeInput(text);
        const rawHtml = mdParser.render(sanitized);
        
        // Sanitize output HTML
        return DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: ['p', 'code', 'pre', 'em', 'strong', 'ul', 'ol', 'li', 'blockquote'],
            ALLOWED_ATTR: ['class', 'id'],
            FORBID_TAGS: ['style', 'script'],
            FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick']
        });
    } catch (error) {
        console.error('Markdown parsing error:', error);
        return sanitizeInput(text); // Fallback to plain text
    }
}

import { sanitizeInput } from '../utils/helpers.js';
const DOMPurify = window.dompurify || window.DOMPurify;
