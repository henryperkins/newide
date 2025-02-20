let mdParser = null;

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

