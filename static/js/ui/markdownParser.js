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
    // Styles now handled through components.css
    if (!mdParser) {
        configureMarkdown();
        if (!mdParser) return text;
    }

    try {
        // Sanitize input before parsing
        const sanitized = sanitizeInput(text);
        return mdParser.render(sanitized);
    } catch (error) {
        console.error('Markdown parsing error:', error);
        return text;
    }
}

import { sanitizeInput } from '../utils/helpers.js';

