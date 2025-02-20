// rendering.js
import { showNotification } from './ui.js';

let mdParser = null;
if (typeof markdownit !== 'undefined') {
    mdParser = markdownit({
        highlight: function (str, lang) {
            if (typeof Prism !== 'undefined' && Prism.languages[lang]) {
                return Prism.highlight(str, Prism.languages[lang], lang);
            }
            return str;
        }
    });
}

export function safeMarkdownParse(text) {
    if (!mdParser) {
        return text;
    }
    try {
        return mdParser.render(text);
    } catch (e) {
        console.error('Markdown parsing error:', e);
        return text;
    }
}

export function configureMarkdownWithPrism() {
    if (typeof marked === 'undefined') {
        console.error('marked is not available. Please ensure marked.min.js is loaded.');
        return false;
    }
    if (typeof Prism === 'undefined') {
        console.error('Prism is not available. Please ensure prism.js is loaded.');
        return false;
    }

    marked.setOptions({
        highlight: (code, lang) => {
            return Prism.highlight(code, Prism.languages[lang] || Prism.languages.auto, lang);
        }
    });
    return true;
}

export function displayMessage(message, role) {
    const chatHistory = document.getElementById('chat-history');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;
    messageDiv.style.opacity = '0';
    messageDiv.style.transform = 'translateY(20px)';

    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button';
    copyButton.innerHTML = '📋';
    copyButton.title = "Copy to clipboard";
    copyButton.onclick = () => {
        navigator.clipboard.writeText(message).then(() => {
            showNotification('Text copied to clipboard', 'success');
        }).catch(err => {
            console.error('Failed to copy text:', err);
            showNotification('Failed to copy text to clipboard', 'error');
        });
    };

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = safeMarkdownParse(message);

    messageDiv.appendChild(copyButton);
    messageDiv.appendChild(contentDiv);
    chatHistory.appendChild(messageDiv);

    requestAnimationFrame(() => {
        messageDiv.style.transition = 'all 0.3s ease';
        messageDiv.style.opacity = '1';
        messageDiv.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
}