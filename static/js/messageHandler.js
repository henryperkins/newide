import { 
    sessionId, 
    initializeSession, 
    lastUserMessage 
} from '/static/js/session.js';
import { 
    NotificationManager,
    showNotification,
    showTypingIndicator,
    removeTypingIndicator
} from '/static/js/ui/notificationManager.js';
import { displayMessage } from '/static/js/ui/displayManager.js';
import { safeMarkdownParse } from '/static/js/ui/markdownParser.js';
import { updateTokenUsage } from '/static/js/utils/helpers.js';
import { 
    getCurrentConfig,
    getTimeoutDurations,
    getModelSettings
} from '/static/js/config.js';
import { getFilesForChat } from '/static/js/fileManager.js';

export async function sendMessage() {
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    let modelSettings = getModelSettings();
    
    if (!message) return;

    try {
        // Session management
        if (!sessionId && !(await initializeSession())) {
            throw new Error('Failed to initialize session');
        }

        // Handle o1 model requirements
        if (modelSettings.name.includes('o1')) {
            if (modelSettings.supportsVision) {
                displayMessage('Formatting re-enabled: Markdown processing activated', 'developer');
            }
            if (document.getElementById('streaming-toggle').checked) {
                showNotification('o1 models do not support streaming', 'warning');
                return;
            }
        }

        // UI state management
        userInput.disabled = true;
        lastUserMessage = message;
        displayMessage(message, 'user');
        userInput.value = '';


        // Prepare request components
        const { controller, timeoutId } = createAbortController(timeoutDurations[reasoningEffort]);
        const messageContent = processMessageContent(message, modelSettings.supportsVision);
        const vectorStores = await fetchVectorStores();

        // Execute request
        const response = await handleChatRequest({
            messageContent,
            controller,
            developerConfig,
            reasoningEffort,
            vectorStores
        });

        // Process response
        if (modelSettings.supportsStreaming) {
            await handleStreamingResponse(response, controller);
        } else {
            await handleStandardResponse(response);
        }
    } catch (error) {
        handleMessageError(error);
    } finally {
        removeTypingIndicator();
        userInput.disabled = false;
    }
}

export async function regenerateResponse() {
    if (lastUserMessage) {
        document.getElementById('user-input').value = lastUserMessage;
        await sendMessage();
    }
}

// Helper functions
function handleReasoningEffortNotifications(effort) {
    const messages = {
        high: {
            text: "Using high reasoning effort - responses may take several minutes. Consider medium for faster responses.",
            duration: 8000
        },
        medium: {
            text: "Using medium reasoning effort - responses may take 1-3 minutes for complex queries.",
            duration: 6000
        }
    };

    if (messages[effort]) {
        showNotification(messages[effort].text, "info", messages[effort].duration);
    }
    showTypingIndicator(effort);
}

function createAbortController(timeoutDuration) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        window.serverCalculatedTimeout ? 
            window.serverCalculatedTimeout * 1000 : 
            timeoutDuration
    );
    return { controller, timeoutId };
}

function processMessageContent(message, supportsVision) {
    const imageMatches = message.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g);
    
    if (imageMatches && !supportsVision) {
        throw new Error('Vision features require o1 model');
    }

    return imageMatches ? 
        imageMatches.map(createImageContent) : 
        message;
}

function createImageContent(match) {
    const url = match.match(/\((https?:\/\/[^\s)]+)\)/)[1];
    return {
        type: "image_url",
        image_url: { url, detail: "auto" }
    };
}

async function fetchVectorStores() {
    try {
        const response = await fetch(`/vector_stores/${sessionId}`);
        return response.ok ? 
            await response.json() : 
            { vector_store_ids: [] };
    } catch (error) {
        console.error('Vector store fetch error:', error);
        return { vector_store_ids: [] };
    }
}

async function handleChatRequest({
    messageContent,
    controller,
    developerConfig,
    reasoningEffort,
    vectorStores
}) {
    const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
            message: messageContent,
            session_id: sessionId,
            developer_config: developerConfig,
            reasoning_effort: reasoningEffort,
            include_usage_metrics: true,
            tools: [{ type: "file_search" }],
            tool_resources: vectorStores.vector_store_ids.length > 0 ? {
                file_search: {
                    vector_store_ids: vectorStores.vector_store_ids
                }
            } : undefined
        })
    };

    return await fetch('/chat', init);
}

async function handleStandardResponse(response) {
    if (!response.ok) throw new Error(await getErrorDetails(response));
    
    const data = await response.json();
    processResponseData(data);
}

async function handleTrueStreaming() {
    const eventSource = new EventSource(`/api/chat/stream?session_id=${sessionId}`);
    let messageContainer = null;
    
    eventSource.onmessage = (event) => {
        try {
            const response = JSON.parse(event.data);
            
            if (response.error) {
                displayMessage(`Error: ${response.error}`, 'error');
                eventSource.close();
                return;
            }
            
            if (!messageContainer) {
                messageContainer = createMessageContainer();
                injectStreamingStyles();
            }
            
            updateStreamingUI(response, messageContainer);
            
            if (response.choices[0].finish_reason === 'stop') {
                finalizeStreaming(messageContainer);
                eventSource.close();
            }
            
        } catch (error) {
            console.error('Stream error:', error);
            eventSource.close();
        }
    };

    eventSource.onerror = (error) => {
        console.error('EventSource failed:', error);
        eventSource.close();
        removeTypingIndicator();
    };
}

// Helper functions
function createMessageContainer() {
    const container = document.createElement('div');
    container.className = 'message assistant-message streaming';
    document.getElementById('chat-history').appendChild(container);
    return container;
}

function updateStreamingUI(content, container) {
    if (!container) {
        container = document.createElement('div');
        container.className = 'message assistant-message streaming';
        document.getElementById('chat-history').appendChild(container);
        injectStreamingStyles();
    }

    try {
        const parsed = JSON.parse(content);
        container.innerHTML = processAnnotatedContent(parsed);
    } catch {
        container.innerHTML = safeMarkdownParse(content);
    }

    highlightCodeBlocks(container);
    container.scrollIntoView({ behavior: 'smooth', block: 'end' });
    
    return container;
}

function processAnnotatedContent(responseData) {
    if (!responseData?.content?.[0]?.text?.annotations) {
        return safeMarkdownParse(responseData);
    }

    const { text, annotations } = responseData.content[0].text;
    let content = text.value;
    const citations = [];

    annotations.forEach((annotation, index) => {
        if (annotation.file_citation) {
            content = content.replace(annotation.text, `[${index + 1}]`);
            citations.push(createCitationElement(index + 1, annotation.file_citation));
        }
    });

    return `
        <div class="message-text">${safeMarkdownParse(content)}</div>
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

function createCitationElement(index, citation) {
    return `
        <div class="file-citation">
            <div class="citation-header">
                <span class="citation-number">[${index}]</span>
                <span class="citation-file">${citation.file_name}</span>
            </div>
            <div class="citation-quote">${citation.quote}</div>
        </div>
    `;
}

function finalizeStreamingResponse(content, container) {
    if (!container) return;

    container.classList.remove('streaming');
    
    try {
        const parsed = JSON.parse(content);
        if (parsed.usage) {
            updateTokenUsage(parsed.usage);
        }
    } catch (error) {
        console.warn('Could not parse streaming usage data:', error);
    }

    addCopyButton(container, content);
}

function injectStreamingStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .streaming {
            position: relative;
            padding-right: 1.5em;
        }
        .streaming::after {
            content: '▋';
            position: absolute;
            right: 0.5em;
            bottom: 0.5em;
            animation: blink 1s steps(2) infinite;
            color: #3b82f6;
        }
        @keyframes blink {
            0% { opacity: 1; }
            50% { opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

function highlightCodeBlocks(container) {
    if (typeof Prism === 'undefined') return;
    
    container.querySelectorAll('pre code').forEach(block => {
        block.style.opacity = '0';
        Prism.highlightElement(block);
        setTimeout(() => block.style.opacity = '1', 100);
    });
}

function addCopyButton(container, content) {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.innerHTML = '📋';
    button.title = 'Copy to clipboard';
    button.onclick = () => navigator.clipboard.writeText(content);
    container.prepend(button);
}

function processResponseData(data) {
    if (data.calculated_timeout) {
        window.serverCalculatedTimeout = data.calculated_timeout;
    }

    displayMessage(data.response, 'assistant');
    
    if (data.usage) {
        updateTokenUsage({
            ...data.usage,
            ...(data.usage.completion_details?.reasoning_tokens && {
                reasoning_tokens: data.usage.completion_details.reasoning_tokens
            }),
            ...(data.usage.prompt_details?.cached_tokens && {
                cached_tokens: data.usage.prompt_details.cached_tokens
            })
        });
    }
}

async function getErrorDetails(response) {
    if (response.status === 400) {
        const data = await response.json();
        return data.detail || 'Invalid request';
    }
    if (response.status === 503) {
        const data = await response.json();
        return data.error?.type === 'timeout' ?
            `Request timed out. Try lower reasoning effort (current: ${getCurrentConfig().reasoningEffort})` :
            'Service unavailable';
    }
    return `HTTP error! status: ${response.status}`;
}

// Display file citations in a special UI element
function displayFileCitations(citations) {
    // Create citations container
    const citationsContainer = document.createElement('div');
    citationsContainer.className = 'file-citations';
    
    // Add header
    const header = document.createElement('div');
    header.className = 'citations-header';
    header.innerHTML = '<span class="citation-icon">📚</span> Citations from Files';
    citationsContainer.appendChild(header);
    
    // Add each citation
    citations.forEach((citation, index) => {
        const citationElement = document.createElement('div');
        citationElement.className = 'citation-item';
        
        const citationHeader = document.createElement('div');
        citationHeader.className = 'citation-item-header';
        citationHeader.innerHTML = `
            <span class="citation-number">[${index + 1}]</span>
            <span class="citation-filename">${citation.filename}</span>
        `;
        
        const citationContent = document.createElement('div');
        citationContent.className = 'citation-content';
        citationContent.textContent = citation.text;
        
        citationElement.appendChild(citationHeader);
        citationContent.textContent = citation.text;
        
        citationElement.appendChild(citationHeader);
        citationElement.appendChild(citationContent);
        citationsContainer.appendChild(citationElement);
    });
    
    // Add to the chat history
    const chatHistory = document.getElementById('chat-history');
    if (chatHistory) {
        chatHistory.appendChild(citationsContainer);
    }
}

function handleMessageError(error) {
    console.error('Message handling error:', error);

    const errorMessage = error.name === 'AbortError' ?
        'Request timed out. Consider using lower reasoning effort.' :
        error.message;

    displayMessage(`Error: ${errorMessage}`, 'error');
    showNotification(errorMessage, 'error');
}
