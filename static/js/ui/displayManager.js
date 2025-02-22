import { safeMarkdownParse } from '/static/js/ui/markdownParser.js';
import { copyToClipboard } from '/static/js/utils/helpers.js';

export { displayMessage, processCitations };

function displayMessage(content, role) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;

    // Handle developer messages
    if (role === 'developer') {
        const isFormattingMessage = content.toLowerCase().includes('formatting re-enabled');
        const messageDiv = createDeveloperMessage(content, isFormattingMessage);
        chatHistory.appendChild(messageDiv);
        
        // Add accessibility announcement
        const liveRegion = document.getElementById('a11y-announcements');
        if (liveRegion) {
            liveRegion.textContent = `System message: ${content}`;
        }
        return;
    }

    const messageDiv = createMessageElement(role);
    const contentDiv = createContentElement(content, role);
    
    messageDiv.appendChild(createCopyButton(content));
    messageDiv.appendChild(contentDiv);
    
    applyEntranceAnimation(messageDiv);
    chatHistory.appendChild(messageDiv);
    scheduleScroll(messageDiv);
}

function createDeveloperMessage(content, isFormattingMessage) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message developer-message markdown-content';
    messageDiv.setAttribute('role', 'alert');
    messageDiv.setAttribute('aria-live', 'assertive');

    if (isFormattingMessage) {
        const noticeDiv = document.createElement('div');
        noticeDiv.className = 'formatting-notice';
        noticeDiv.innerHTML = `
            <span aria-hidden="true">⚙️</span>
            <strong>System:</strong>
            ${safeMarkdownParse(content)}
        `;
        messageDiv.appendChild(noticeDiv);
    } else {
        messageDiv.innerHTML = safeMarkdownParse(content);
    }
    
    return messageDiv;
}

function createMessageElement(role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message markdown-content`;
    
    // Initial animation state
    messageDiv.style.opacity = '0';
    messageDiv.style.transform = 'translateY(20px)';
    
    processCodeBlocks(messageDiv);
    
    return messageDiv;
}

function createContentElement(content, role) {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'assistant' && hasCitations(content)) {
        const { parsedContent, citations } = processCitations(content);
        contentDiv.innerHTML = createAssistantContent(parsedContent, citations);
        addCitationStyles();
    } else {
        contentDiv.innerHTML = safeMarkdownParse(content);
    }

    processCodeBlocks(contentDiv);
    return contentDiv;
}

function hasCitations(content) {
    return typeof content === 'object' && 
           content.content?.[0]?.text?.annotations;
}

function processCitations(content) {
    const messageContent = content.content[0].text;
    const annotations = messageContent.annotations;
    let parsedContent = messageContent.value;
    const citations = [];

    annotations.forEach((annotation, index) => {
        if (annotation.file_citation) {
            parsedContent = parsedContent.replace(
                annotation.text,
                `[${index + 1}]`
            );
            citations.push(createCitationHTML(index + 1, annotation.file_citation));
        }
    });

    return { parsedContent, citations };
}

function createAssistantContent(parsedContent, citations) {
    return `
        <div class="message-text">${safeMarkdownParse(parsedContent)}</div>
        ${citations.length ? `
            <div class="citations-container">
                <div class="citations-header">
                    <span class="citations-icon">📚</span>
                    <span>Sources</span>
                </div>
                ${citations.join('')}
            </div>
        ` : ''}
    `;
}

function createCitationHTML(index, citation) {
    return `
        <div class="file-citation" 
             role="region" 
             aria-label="Document reference ${index}"
             tabindex="0">
            <div class="citation-header" id="citation-heading-${index}">
                <span class="citation-number" aria-label="Reference number">[${index}]</span>
                <span class="citation-file" aria-label="Source document">
                    ${citation.file_name}
                </span>
            </div>
            <div class="citation-quote" aria-label="Relevant excerpt">
                ${citation.quote}
            </div>
        </div>
    `;
}

function addCitationStyles() {
    if (document.getElementById('citation-styles')) return;

    const style = document.createElement('style');
    style.id = 'citation-styles';
    style.textContent = `
        .citations-container {
            margin-top: 1.5em;
            padding-top: 1em;
            border-top: 1px solid rgba(0, 0, 0, 0.1);
        }
        .citations-header {
            display: flex;
            align-items: center;
            gap: 0.5em;
            font-weight: 600;
            color: #4b5563;
            margin-bottom: 1em;
        }
        .file-citation {
            margin: 1em 0;
            padding: 1em;
            background: rgba(59, 130, 246, 0.05);
            border-radius: 8px;
            border-left: 3px solid #3b82f6;
        }
        .citation-number {
            color: #3b82f6;
            font-weight: 600;
            font-family: 'JetBrains Mono', monospace;
        }
        .citation-file {
            color: #6b7280;
            font-size: 0.9em;
        }
        .citation-quote {
            color: #1f2937;
            font-style: italic;
            line-height: 1.5;
        }
    `;
    document.head.appendChild(style);
}

function processCodeBlocks(container) {
    container.querySelectorAll('pre code').forEach(block => {
        block.style.opacity = '0';
        // Add language class if not present
        if (!block.className && block.parentElement.firstChild?.textContent) {
            const lang = block.parentElement.firstChild.textContent.trim();
            if (lang && typeof Prism !== 'undefined' && Prism.languages[lang]) {
                block.className = `language-${lang}`;
            }
        }
        if (typeof Prism !== 'undefined') {
            Prism.highlightElement(block);
        }
        setTimeout(() => {
            block.style.opacity = '1';
            block.style.transition = 'opacity 0.3s ease';
        }, 100);
    });
}

function createCopyButton(content) {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.innerHTML = '📋';
    button.title = "Copy to clipboard";
    button.onclick = () => copyToClipboard(
        typeof content === 'string' ? content : JSON.stringify(content)
    );
    return button;
}

function applyEntranceAnimation(element) {
    requestAnimationFrame(() => {
        element.style.transition = 'all 0.3s ease';
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
    });
}

function scheduleScroll(element) {
    setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
}
