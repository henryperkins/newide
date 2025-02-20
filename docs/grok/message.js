// message.js
import { getSessionId, setLastUserMessage, getServerCalculatedTimeout, getModelName } from './state.js';
import { showNotification, showTypingIndicator, removeTypingIndicator } from './ui.js';
import { displayMessage } from './rendering.js';
import { initializeSession } from './session.js';

export async function sendMessage() {
    console.log("sendMessage function called");
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    if (!message) {
        console.log("No message to send");
        return;
    }

    let sessionId = getSessionId();
    if (!sessionId) {
        showNotification("Session not initialized. Initializing...", "warning");
        const initialized = await initializeSession();
        if (!initialized) {
            showNotification("Failed to initialize session. Please refresh the page.", "error");
            return;
        }
        sessionId = getSessionId();
    }

    let timeoutId;
    let data;

    try {
        userInput.disabled = true;
        setLastUserMessage(message);
        displayMessage(message, 'user');
        userInput.value = '';

        const developerConfig = document.getElementById('developer-config').value.trim();
        const effortMap = ['low', 'medium', 'high'];
        const reasoningEffort = effortMap[document.getElementById('reasoning-effort-slider').value];

        if (reasoningEffort === 'high') {
            showNotification(
                "Using high reasoning effort - responses may take several minutes. Consider medium for faster responses.",
                "info",
                8000
            );
        } else if (reasoningEffort === 'medium') {
            showNotification(
                "Using medium reasoning effort - responses may take 1-3 minutes for complex queries.",
                "info",
                6000
            );
        }

        showTypingIndicator(reasoningEffort);

        const controller = new AbortController();
        const fallbackDurationMillis =
            reasoningEffort === 'high' ? 360000 :
            reasoningEffort === 'medium' ? 240000 :
            120000;
        const dynamicDurationMillis = getServerCalculatedTimeout() ?
            getServerCalculatedTimeout() * 1000 :
            fallbackDurationMillis;

        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error('Request timeout - the server may still be processing'));
            }, dynamicDurationMillis);
        });

        const hasImageUrls = message.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g);
        const modelName = getModelName();
        if (hasImageUrls && !modelName.includes('o1')) {
            throw new Error('Vision features are only supported with o1 model');
        }

        const messageContent = hasImageUrls ?
            hasImageUrls.map(match => {
                const url = match.match(/\((https?:\/\/[^\s)]+)\)/)[1];
                return {
                    type: "image_url",
                    image_url: { url, detail: "auto" }
                };
            }) :
            message;

        const isO3Mini = modelName.includes('o3-mini');
        const vectorStoreResponse = await fetch(`/vector_stores/${sessionId}`);
        const vectorStores = vectorStoreResponse.ok ? await vectorStoreResponse.json() : { vector_store_ids: [] };

        const fetchPromise = fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                message: messageContent,
                session_id: sessionId,
                developer_config: developerConfig || undefined,
                reasoning_effort: reasoningEffort || undefined,
                include_usage_metrics: true,
                tools: [{ type: "file_search" }],
                tool_resources: vectorStores.vector_store_ids.length > 0 ? {
                    file_search: { vector_store_ids: vectorStores.vector_store_ids }
                } : undefined
            })
        });

        if (isO3Mini) {
            const response = await fetchPromise;
            clearTimeout(timeoutId);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedResponse = '';
            let messageDiv = null;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                accumulatedResponse += chunk;

                if (!messageDiv) {
                    messageDiv = document.createElement('div');
                    messageDiv.className = 'message assistant-message streaming';
                    document.getElementById('chat-history').appendChild(messageDiv);
                    const style = document.createElement('style');
                    style.textContent = `.streaming { position: relative; padding-right: 1.5em; }
                        .streaming::after { content: '▋'; position: absolute; right: 0.5em; bottom: 0.5em; animation: blink 1s steps(2) infinite; color: #3b82f6; }
                        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } }
                        .streaming pre { margin-bottom: 1em; }
                        .streaming code { opacity: 0; transition: opacity 0.3s ease; }
                        .streaming code.highlighted { opacity: 1; }
                        .streaming .copy-button { opacity: 0.5; transition: opacity 0.3s ease; }
                        .streaming:hover .copy-button { opacity: 1; }`;
                    document.head.appendChild(style);
                }

                messageDiv.innerHTML = `<div class="message-text">${accumulatedResponse}</div>`;
                messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }

            if (messageDiv) {
                messageDiv.classList.remove('streaming');
                const copyButton = document.createElement('button');
                copyButton.className = 'copy-button';
                copyButton.innerHTML = '📋';
                copyButton.title = "Copy to clipboard";
                copyButton.onclick = () => copyToClipboard(accumulatedResponse);
                messageDiv.insertBefore(copyButton, messageDiv.firstChild);
            }

            try {
                const finalResponse = JSON.parse(accumulatedResponse);
                if (finalResponse.usage) {
                    updateTokenUsage(finalResponse.usage);
                }
            } catch (e) {
                console.warn('Could not parse token usage from streaming response:', e);
            }
            return;
        }

        const response = await Promise.race([fetchPromise, timeoutPromise]);
        clearTimeout(timeoutId);

        if (response.status === 400) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Invalid request');
        }
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        data = await response.json();
        if (!data.response) {
            throw new Error('No response received from server');
        }

        if (data.calculated_timeout) {
            setServerCalculatedTimeout(data.calculated_timeout);
        }

        displayMessage(data.response, 'assistant');
        if (data.usage) {
            updateTokenUsage(data.usage);
        }
    } catch (error) {
        console.error('Error sending message:', error);
        displayMessage('Error: ' + error.message, 'error');
        showNotification(error.message, 'error');
    } finally {
        removeTypingIndicator();
        userInput.disabled = false;
    }
}

export async function regenerateResponse() {
    const lastMessage = getLastUserMessage();
    if (lastMessage) {
        const userInput = document.getElementById('user-input');
        userInput.value = lastMessage;
        await sendMessage();
    }
}

function updateTokenUsage(usage) {
    if (!usage) return;

    document.getElementById('prompt-tokens').textContent = usage.prompt_tokens || 0;
    document.getElementById('completion-tokens').textContent = usage.completion_tokens || 0;
    document.getElementById('total-tokens').textContent = usage.total_tokens || 0;
}