/**********************************************
 * messageHandler.js
 **********************************************/

import { 
    sessionId, 
    initializeSession,
    getLastUserMessage,
    setLastUserMessage
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


/**
 * Main function to send user message to the server
 * and handle the response (standard or streaming).
 */
export async function sendMessage() {
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    const modelConfig = await getModelSettings();
    
    // Validate o-series requirements
    if (modelConfig.name.includes('o1')) {
        if (document.getElementById('streaming-toggle').checked) {
            showNotification('o-series models do not support streaming', 'error');
            return;
        }
        
        const tempValue = parseFloat(document.getElementById('temperature-value').textContent);
        if (tempValue !== 1.0) {
            showNotification('o-series requires temperature=1.0', 'error');
            return;
        }
        
        // Ensure we're using max_completion_tokens instead of max_tokens
        if (modelConfig.capabilities?.max_completion_tokens) {
            delete requestBody.max_tokens;
        }
    }
    
    console.log('[MessageHandler] Initiated sendMessage:', {
        messagePreview: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
        messageLength: message.length,
        modelSettings
    });
    
    if (!message) return;

    try {
        // Ensure session is set up
        if (!sessionId && !(await initializeSession())) {
            throw new Error('Failed to initialize session');
        }

        // If "o1" model logic, ensure no streaming is used, etc.
        if (modelSettings?.name?.includes?.('o1') && modelSettings.supportsVision) {
            displayMessage('Formatting re-enabled: Markdown processing activated', 'developer');
            if (document.getElementById('streaming-toggle').checked) {
                showNotification('o1 models do not support streaming', 'warning');
                return;
            }
        }

        // Disable user input while request in flight
        userInput.disabled = true;
        setLastUserMessage(message);

        // Show the user message in chat
        displayMessage(message, 'user');
        userInput.value = '';

        // Prepare request
        const config = getCurrentConfig();
        const effortLevel = config?.reasoningEffort || 'medium';
        const timeout = getTimeoutDurations()[effortLevel] || 30000;

        console.log('[Config] Current settings:', {
            effort: effortLevel,
            timeout: timeout,
            modelSettings
        });

        // Create an abort controller with a dynamic or default timeout
        const { controller } = createAbortController(timeout);

        // Preprocess message content if there's any special formatting
        const messageContent = processMessageContent(message, modelSettings.supportsVision);

        // Send request
        const response = await handleChatRequest({
            messageContent,
            controller,
            developerConfig: config.developerConfig,
            reasoningEffort: config.reasoningEffort
        });

        // Decide if we handle streaming or standard response
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


/**
 * If the user clicks a "Regenerate" button, resend the last user message.
 */
export async function regenerateResponse() {
    const lastMessage = getLastUserMessage();
    if (lastMessage) {
        document.getElementById('user-input').value = lastMessage;
        await sendMessage();
    }
}


/**********************************************
 * handleChatRequest
 * - Minimal request payload
 * - `api-version` as query param
 **********************************************/
async function handleChatRequest({
    messageContent,
    controller,
    developerConfig,
    reasoningEffort
}) {
    const config = await getCurrentConfig();
    const modelConfig = await getModelSettings();
    const apiVersion = modelConfig.api_version;

    // Example: the actual name of your Azure OpenAI deployment
    const deploymentName = config.selectedModel || 'o1model-east2';

    // Ensure session is valid
    if (!sessionId) {
        await initializeSession();
        if (!sessionId) {
            throw new Error('Could not initialize session');
        }
    }

    // Build minimal payload with o-series specific parameters
    const requestBody = {
        model: deploymentName,
        messages: [{
            role: 'user',
            content: typeof messageContent === 'string'
                ? messageContent
                : JSON.stringify(messageContent)
        }],
        session_id: sessionId,
        reasoning_effort: reasoningEffort,
        ...(modelConfig.name.includes('o1') && {
            max_completion_tokens: modelConfig.capabilities.max_completion_tokens,
            temperature: modelConfig.capabilities.fixed_temperature
        })
    };

    // Add developer message if configured
    if (modelConfig.developer_message) {
        requestBody.messages.unshift({
            role: "developer",
            content: modelConfig.developer_message
        });
    }

    // Optionally add dev config
    if (developerConfig) {
        requestBody.developer_config = developerConfig;
    }

    // Example: If you want to include local files
    /*
    if (config.includeFiles) {
        requestBody.include_files = true;
        const fileInfo = getFilesForChat();
        if (fileInfo && fileInfo.file_ids?.length) {
            requestBody.file_ids = fileInfo.file_ids;
        }
    }
    */

    console.log('[handleChatRequest] Sending payload:', JSON.stringify(requestBody, null, 2));

    const url = `/api/chat/?api-version=${apiVersion}`;
    const init = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody)
    };

    const requestStartTime = Date.now();
    const response = await fetch(url, init);
    response.requestStartTime = requestStartTime;
    return response;
}


/**********************************************
 * handleStandardResponse
 * - Reads the JSON if 2xx
 * - Otherwise logs full error
 **********************************************/
async function handleStandardResponse(response) {
    const requestDuration = Date.now() - response.requestStartTime;
    console.log('[handleStandardResponse] Response after', requestDuration, 'ms', 'Status:', response.status);

    // If response is not ok, parse error details
    if (!response.ok) {
        try {
            const errorData = await response.json();
            console.error('[handleStandardResponse] API Error details:', errorData);
            const errorDetails = JSON.stringify(errorData);
            throw new Error(`HTTP error! status: ${response.status}, details: ${errorDetails}`);
        } catch (jsonParseErr) {
            // If JSON parse fails, rethrow whatever we got
            console.error('[handleStandardResponse] Non-JSON error response:', jsonParseErr);
            throw jsonParseErr;
        }
    }

    // If OK, parse JSON data
    const data = await response.json();
    processResponseData(data);
}


/**********************************************
 * handleStreamingResponse
 * - Example SSE approach for streaming
 **********************************************/
async function handleStreamingResponse(response, controller) {
    // If your server uses an EventSource endpoint for streaming,
    // you'd close the initial POST response and open SSE here.
    // 
    // If your server supports streaming directly from the POST,
    // you'd do something else (e.g. "fetch and read the body as a stream").
    // 
    // This is just an example of how you'd handle SSE.

    console.log('[handleStreamingResponse] Starting SSE streaming...');

    // For demonstration, we might do:
    const eventSource = new EventSource(`/api/chat/stream?session_id=${sessionId}`);

    let messageContainer = null;

    eventSource.onmessage = (event) => {
        try {
            const responseData = JSON.parse(event.data);

            // If there's an error in the SSE data
            if (responseData.error) {
                displayMessage(`Error: ${responseData.error}`, 'error');
                eventSource.close();
                return;
            }

            // If first chunk, create a new container
            if (!messageContainer) {
                messageContainer = createMessageContainer();
                injectStreamingStyles();
            }

            updateStreamingUI(responseData, messageContainer);

            // Check if stream has completed
            if (responseData.choices && responseData.choices[0].finish_reason === 'stop') {
                finalizeStreamingResponse(JSON.stringify(responseData), messageContainer);
                eventSource.close();
            }
        } catch (err) {
            console.error('[handleStreamingResponse] SSE parsing error:', err);
            eventSource.close();
        }
    };

    eventSource.onerror = (err) => {
        console.error('[handleStreamingResponse] SSE failed:', err);
        eventSource.close();
        removeTypingIndicator();
    };
}


/**********************************************
 * processResponseData
 * - Display final response from server
 * - Update usage info
 **********************************************/
function processResponseData(data) {
    if (data.calculated_timeout) {
        window.serverCalculatedTimeout = data.calculated_timeout;
    }

    // Display the assistant's message
    displayMessage(data.response, 'assistant');

    // If usage data is included, update token usage
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


/**********************************************
 * Helper: Create an AbortController with Timeout
 **********************************************/
function createAbortController(timeoutDuration) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(),
        window.serverCalculatedTimeout 
            ? window.serverCalculatedTimeout * 1000
            : timeoutDuration
    );
    return { controller, timeoutId };
}


/**********************************************
 * Helper: Process user’s message for images, etc.
 **********************************************/
function processMessageContent(message, supportsVision) {
    const imageMatches = message.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g);
    
    if (imageMatches && !supportsVision) {
        throw new Error('Vision features require o1 model');
    }

    // If matches exist, return an array describing images
    // If none, just return the raw string
    return imageMatches 
        ? imageMatches.map(createImageContent) 
        : message;
}

function createImageContent(match) {
    const url = match.match(/\((https?:\/\/[^\s)]+)\)/)[1];
    return {
        type: "image_url",
        image_url: { url, detail: "auto" }
    };
}


/**********************************************
 * Helper: handle streaming SSE UI
 **********************************************/
function createMessageContainer() {
    const container = document.createElement('div');
    container.className = 'message assistant-message streaming';
    document.getElementById('chat-history').appendChild(container);
    return container;
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

function updateStreamingUI(responseData, container) {
    // Convert "content" to HTML
    try {
        container.innerHTML = processAnnotatedContent(responseData);
    } catch {
        // If it fails, just put raw JSON
        container.innerHTML = safeMarkdownParse(JSON.stringify(responseData));
    }

    highlightCodeBlocks(container);
    container.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
        console.warn('[finalizeStreamingResponse] Could not parse streaming usage data:', error);
    }

    addCopyButton(container, content);
}


/**********************************************
 * Helper: parse annotated content (citations)
 **********************************************/
function processAnnotatedContent(responseData) {
    // If there's no .content, just parse as JSON or fallback
    if (!responseData?.content) {
        return safeMarkdownParse(JSON.stringify(responseData));
    }

    let content = responseData.content;
    const citations = [];

    // Look for new or old citation formats
    if (responseData.context?.citations) {
        // Possibly old format
        responseData.context.citations.forEach((citation, index) => {
            const ref = `[doc${index + 1}]`;
            content = content.replace(ref, `[${index + 1}]`);
            citations.push(createCitationElement(index + 1, {
                file_name: citation.document_name,
                quote: citation.content
            }));
        });
    } else if (Array.isArray(responseData.content)) {
        // Possibly new format with annotations
        const firstBlock = responseData.content[0];
        if (firstBlock?.text?.annotations) {
            content = firstBlock.text.value;
            firstBlock.text.annotations.forEach((annotation, index) => {
                if (annotation.file_citation) {
                    content = content.replace(annotation.text, `[${index + 1}]`);
                    citations.push(createCitationElement(index + 1, annotation.file_citation));
                }
            });
        }
    }

    return `
        <div class="message-text">${safeMarkdownParse(content)}</div>
        ${
            citations.length
                ? `<div class="citations-container">
                        <div class="citations-header">
                            <span class="citations-icon">📚</span>
                            <span>Sources</span>
                        </div>
                        ${citations.join('')}
                   </div>`
                : ''
        }
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


/**********************************************
 * Helper: highlight code blocks
 **********************************************/
function highlightCodeBlocks(container) {
    if (typeof Prism === 'undefined') return;

    container.querySelectorAll('pre code').forEach(block => {
        block.style.opacity = '0';
        Prism.highlightElement(block);
        setTimeout(() => {
            block.style.opacity = '1';
        }, 100);
    });
}


/**********************************************
 * Helper: add "copy to clipboard" button
 **********************************************/
function addCopyButton(container, content) {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.innerHTML = '📋';
    button.title = 'Copy to clipboard';
    button.onclick = () => navigator.clipboard.writeText(content);
    container.prepend(button);
}


/**********************************************
 * handleMessageError
 * - Generic catch block handling
 **********************************************/
function handleMessageError(error) {
    console.error('[handleMessageError]', error);

    let errorMessage = 'An unexpected error occurred';
    let errorDetails = [];

    if (error.name === 'AbortError') {
        errorMessage = 'Request timed out. Consider using lower reasoning effort.';
    } else if (error.response) {
        // If there’s a structured error from API, parse it
        try {
            const apiError = error.response.data?.error || {};
            errorMessage = apiError.message || error.message;
            if (apiError.type === 'validation_error') {
                if (apiError.fields) {
                    errorDetails = apiError.fields.map(f => `${f} parameter`);
                }
                if (apiError.allowed_values) {
                    errorDetails.push(`Allowed values: ${apiError.allowed_values.join(', ')}`);
                }
            }
        } catch (parseError) {
            console.error('[handleMessageError] Error parsing error response:', parseError);
        }
    } else if (error.message) {
        errorMessage = error.message;
    }

    const fullErrorText = [errorMessage, ...errorDetails].filter(Boolean).join('\n');

    displayMessage(`Error: ${errorMessage}`, 'error');
    showNotification(fullErrorText, 'error');
}
