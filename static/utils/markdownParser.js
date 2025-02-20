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
        return mdParser.render(sanitized);
    } catch (error) {
        console.error('Markdown parsing error:', error);
        return text;
    }
}

function sanitizeInput(text) {
    return text
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/&/g, '&amp;');
}

export function injectMarkdownStyles() {
    if (document.getElementById('markdown-styles')) return;

    const style = document.createElement('style');
    style.id = 'markdown-styles';
    style.textContent = `
        .message-text pre {
            background: #f8f8f8;
            padding: 1em;
            border-radius: 4px;
            overflow-x: auto;
            margin: 1em 0;
        }
        .message-text code {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.9em;
        }
        .message-text blockquote {
            border-left: 3px solid #ddd;
            margin: 1em 0;
            padding-left: 1em;
            color: #666;
        }
        .message-text table {
            border-collapse: collapse;
            margin: 1em 0;
        }
        .message-text td, .message-text th {
            border: 1px solid #ddd;
            padding: 0.5em;
        }
    `;
    document.head.appendChild(style);
}
