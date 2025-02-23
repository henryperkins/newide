// Import necessary modules
import { initializeSession, sessionId, getLastUserMessage, setLastUserMessage } from "/static/js/session.js";
import { getCurrentConfig, updateConfig, getModelSettings, updateModelSpecificUI, switchTab, updateReasoningEffortDisplay } from "/static/js/config.js";
import { showNotification, showTypingIndicator, removeTypingIndicator } from "/static/js/ui/notificationManager.js";
import { displayMessage, processCitations } from "/static/js/ui/displayManager.js"; // Import displayMessage
import { safeMarkdownParse, configureMarkdown, injectMarkdownStyles } from "/static/js/ui/markdownParser.js";
import { buildAzureOpenAIUrl, updateTokenUsage } from "/static/js/utils/helpers.js";
import { initializeFileManager, setupDragAndDrop, loadFilesList, getSelectedFileIds, getFilesForChat } from "/static/js/fileManager.js";
import { getTimeoutDurations } from '/static/js/config.js';
import StatsDisplay from '/static/js/ui/StatsDisplay.js';  // <-- New StatsDisplay import

// Global stats display instance
let statsDisplay;

// Main application entry point
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize StatsDisplay for tracking performance metrics
        statsDisplay = new StatsDisplay();

        // Initialize core components
        await initializeMarkdownSupport();
        await initializeSessionHandling();
        await initializeConfig();
        await initializeAzureConfig();

        // Initialize UI components
        await initializeUIEventHandlers();
        await initializeFileHandling();

        console.log(`Application initialized successfully at ${new Date().toISOString()}`);
    } catch (error) {
        handleApplicationError(error, 'initialize');
    }
});

async function initializeAzureConfig(retryCount = 3, retryDelay = 1000) {
    try {
        let lastError = null;

        for (let attempt = 1; attempt <= retryCount; attempt++) {
            try {
                const response = await fetch('/api/config/', {
                    headers: { 'Accept': 'application/json' }
                });

                if (response.status === 422) {
                    const errorData = await response.json();
                    console.error("[initializeAzureConfig] Validation error:", errorData);
                    throw new Error(`Config validation failed: ${errorData.detail || 'Unknown validation error'}`);
                }
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const config = await response.json();
                console.log("[initializeAzureConfig] Config response:", config);

                // Validate required fields
                const requiredFields = {
                    deploymentName: "deployment name",
                    'models': "model configuration",
                    'azureOpenAI.apiKey': "API key"
                };

                for (const [field, label] of Object.entries(requiredFields)) {
                    const value = field.split('.').reduce((obj, key) => obj?.[key], config);
                    if (!value) {
                        throw new Error(`Missing ${label} in configuration`);
                    }
                }

                if (!config.models?.[config.deploymentName]) {
                    throw new Error(`No model configuration found for deployment: ${config.deploymentName}`);
                }

                const modelConfig = config.models[config.deploymentName];

                window.azureOpenAIConfig = {
                    endpoint: modelConfig.endpoint || "https://o1models.openai.azure.com",
                    apiKey: config.azureOpenAI.apiKey,
                    deploymentName: config.deploymentName
                };

                console.log("[initializeAzureConfig] Successfully initialized with deployment:", config.deploymentName);
                return true;

            } catch (error) {
                lastError = error;
                console.warn(`[initializeAzureConfig] Attempt ${attempt}/${retryCount} failed:`, error);

                if (error.message.includes('validation failed') || error.message.includes('422')) {
                    // Don't retry validation errors
                    break;
                }

                if (attempt < retryCount) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
                }
            }
        }

        // If we get here, all attempts failed
        throw lastError || new Error('Failed to initialize Azure configuration');
    } catch (error) {
        handleInitializationError(error);
    }
}

/**
 * Initialize token usage UI components
 */
function initializeTokenUsageUI() {
    const tokenUsage = document.querySelector('.token-usage-compact');
    if (!tokenUsage) return;

    // Restore previous visibility state
    const wasVisible = localStorage.getItem('token-usage-visible') === 'true';
    if (!wasVisible) {
        tokenUsage.classList.remove('active');
    }

    // Create toggle button if it doesn't exist
    if (!document.querySelector('.token-usage-toggle')) {
        const toggle = document.createElement('button');
        toggle.className = 'token-usage-toggle';
        toggle.innerHTML = '📊';
        toggle.title = 'Toggle token usage';
        toggle.onclick = () => {
            tokenUsage.classList.toggle('active');
            localStorage.setItem('token-usage-visible', tokenUsage.classList.contains('active'));
        };
        tokenUsage.appendChild(toggle);
    }
}

/**
 * Initialize tab system with click handlers
 */
function initializeTabSystem() {
    const tabs = document.querySelectorAll('[role="tab"]');
    const panels = document.querySelectorAll('[role="tabpanel"]');

    // Hide all panels initially except the first one
    panels.forEach((panel, index) => {
        if (index !== 0) {
            panel.style.display = 'none';
        }
    });

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();

            // Deactivate all tabs
            tabs.forEach(t => {
                t.setAttribute('aria-selected', 'false');
                t.classList.remove('active');
            });

            // Hide all panels
            panels.forEach(p => {
                p.style.display = 'none';
                p.classList.remove('active');
            });

            // Activate clicked tab
            const clickedTab = e.currentTarget;
            clickedTab.setAttribute('aria-selected', 'true');
            clickedTab.classList.add('active');

            // Show corresponding panel
            const panelId = clickedTab.getAttribute('aria-controls');
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.style.display = 'block';
                panel.classList.add('active');
            }
        });
    });
}

async function initializeMarkdownSupport() {
    if (!configureMarkdown()) {
        showNotification(
            "Markdown support limited - required libraries not loaded",
            "warning",
            8000
        );
    }
    injectMarkdownStyles();
}

async function initializeUIEventHandlers() {
    // Configuration sync helper
    const syncConfigToStorage = async () => {
        const config = {
            developerConfig: document.getElementById('developer-config')?.value || '',
            reasoningEffort: ['low', 'medium', 'high'][
                (document.getElementById('reasoning-effort-slider')?.value || 2) - 1
            ],
            includeFiles: document.getElementById('use-file-search')?.checked || false,
            selectedModel: document.getElementById('model-selector')?.value || 'o1model-east2'
        };
        localStorage.setItem('appConfig', JSON.stringify(config));
        await updateConfig(config);
    };

    // Model selector handler with error handling
    const modelSelector = document.getElementById('model-selector');
    if (modelSelector) {
        modelSelector.addEventListener('change', async (e) => {
            try {
                await syncConfigToStorage();
                showNotification(`Switched to ${e.target.value} model`, 'info', 2000);
                await updateModelSpecificUI(e.target.value);
            } catch (error) {
                console.error('Model switch error:', error);
                showNotification('Failed to switch model', 'error');
            }
        });

        // Initialize model-specific UI
        try {
            const config = await getCurrentConfig();
            await updateModelSpecificUI(config.selectedModel);
        } catch (error) {
            console.error('Failed to initialize model UI:', error);
            showNotification('Failed to initialize model UI', 'error');
        }
    }

    // Message sending handlers
    const sendButton = document.getElementById('send-button');
    const userInput = document.getElementById('user-input');

    if (sendButton) {
        sendButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await syncConfigToStorage();
            await sendMessage();
        });
    }

    if (userInput) {
        userInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                await syncConfigToStorage();
                await sendMessage();
            }
        });
    }

    // Reasoning effort slider with validation
    const slider = document.getElementById('reasoning-effort-slider');
    if (slider) {
        slider.addEventListener('input', updateReasoningEffortDisplay);
        // Ensure valid initial value
        slider.value = Math.max(1, Math.min(3, parseInt(slider.value) || 2));
        updateReasoningEffortDisplay();
    }

    // Regeneration handler
    const regenerateButton = document.getElementById('regenerate-button');
    if (regenerateButton) {
        regenerateButton.addEventListener('click', regenerateResponse);
    }

    // Tab switching with accessibility support
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.targetTab;
            if (tabId) {
                switchTab(tabId);
                // Update URL hash for deep linking
                window.location.hash = tabId;
            }
        });

        // Keyboard navigation
        button.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                button.click();
            }
        });
    });

    // Handle deep linking on page load
    if (window.location.hash) {
        const tabId = window.location.hash.slice(1);
        const tabButton = document.querySelector(`[data-target-tab="${tabId}"]`);
        if (tabButton) {
            tabButton.click();
        }
    }
}

async function initializeSessionHandling() {
    const sessionInitialized = await initializeSession();
    if (!sessionInitialized) {
        throw new Error("Failed to initialize session");
    }
}

async function initializeFileHandling() {
    initializeFileManager();
}

function handleInitializationError(error) {
    console.error("Critical initialization error:", error);
    showNotification(
        `Failed to initialize application: ${error.message}`,
        "error",
        10000
    );
    const chatInterface = document.getElementById('chat-interface');
    const errorDisplay = document.getElementById('error-display');

    if (chatInterface) chatInterface.style.display = 'none';
    if (errorDisplay) errorDisplay.style.display = 'block';
}

/**
 * Updated standard response handler with StatsDisplay integration.
 */
async function handleStandardResponse(response) {
    const startTime = Date.now();
    let data;
    try {
        data = await response.json();
        if (!response.ok) {
            console.error("[handleStandardResponse] API Error details:", data);
            throw new Error(`HTTP error! status: ${response.status}, details: ${JSON.stringify(data)}`);
        }
    } catch (error) {
        handleApplicationError(error, 'process response');
        throw error;
    }
    const latency = Date.now() - startTime;
    if (data.usage && data.usage.total_tokens !== undefined) {
        statsDisplay.updateStats({
            latency: latency,
            tokensPerSecond: data.usage.total_tokens / (latency / 1000),
            totalTokens: data.usage.total_tokens
        });
    }
    processResponseData(data);
}

/**
 * Updated streaming response handler with StatsDisplay integration.
 */
async function handleStreamingResponse(response, controller) {
    console.log("[handleStreamingResponse] Starting SSE streaming...");

    const config = await getCurrentConfig();
    const modelConfig = await getModelSettings();

    // Always use the deployment name from config.
    const deploymentName = config.deploymentName;
    if (!deploymentName) {
        console.error("[handleStreamingResponse] Config:", config);
        throw new Error("No valid deployment name found in configuration.");
    }

    // Build the SSE endpoint from the existing chat completions endpoint:
    const streamUrl = (await buildAzureOpenAIUrl(deploymentName, modelConfig.api_version))
        .replace('/chat/completions', '/chat/completions/stream');

    console.log("[handleStreamingResponse] Using deployment name:", deploymentName);
    const eventSource = new EventSource(streamUrl);

    let messageContainer = null;
    const streamStart = Date.now();
    let tokenCount = 0;

    eventSource.onmessage = (event) => {
        try {
            const responseData = JSON.parse(event.data);

            if (responseData.error) {
                displayMessage(`Error: ${responseData.error}`, "error");
                eventSource.close();
                return;
            }

            if (!messageContainer) {
                messageContainer = createMessageContainer();
                injectStreamingStyles();
            }

            updateStreamingUI(responseData, messageContainer);

            // Update stats based on content tokens received
            if (responseData.content) {
                tokenCount += countTokensInChunk(responseData.content);
                const elapsed = Date.now() - streamStart;
                statsDisplay.updateStats({
                    latency: elapsed,
                    tokensPerSecond: tokenCount / (elapsed / 1000),
                    totalTokens: tokenCount
                });
            }

            if (responseData.choices && responseData.choices[0].finish_reason === "stop") {
                finalizeStreamingResponse(JSON.stringify(responseData), messageContainer);
                eventSource.close();
            }
        } catch (err) {
            console.error("[handleStreamingResponse] SSE parsing error:", err);
            eventSource.close();
        }
    };

    eventSource.onerror = (err) => {
        console.error("[handleStreamingResponse] SSE failed:", err);
        eventSource.close();
        removeTypingIndicator();
    };
}

/**
 * Create container for streaming messages.
 */
function createMessageContainer() {
    const container = document.createElement("div");
    container.className = "message assistant-message streaming markdown-content";
    document.getElementById("chat-history").appendChild(container);
    return container;
}

/**
 * Add "streaming" styles.
 */
function injectStreamingStyles() {
    const style = document.createElement("style");
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

/**
 * Update streaming UI with next chunk.
 */
function updateStreamingUI(responseData, container) {
    try {
        container.innerHTML = processAnnotatedContent(responseData);
    } catch {
        container.innerHTML = safeMarkdownParse(JSON.stringify(responseData));
    }

    highlightCodeBlocks(container);
    container.scrollIntoView({ behavior: "smooth", block: "end" });
}

/**
 * Finalize streaming response once it's done.
 */
function finalizeStreamingResponse(content, container) {
    if (!container) return;

    container.classList.remove("streaming");
    try {
        const parsed = JSON.parse(content);
        if (parsed.usage) {
            updateTokenUsage(parsed.usage);
        }
    } catch (error) {
        console.warn("[finalizeStreamingResponse] Could not parse streaming usage data:", error);
    }

    addCopyButton(container, content);
}

/**
 * Process the final server response data.
 */
function processResponseData(data) {
    if (data.calculated_timeout) {
        window.serverCalculatedTimeout = data.calculated_timeout;
    }

    displayMessage(safeMarkdownParse(data.response), "assistant");

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

/**
 * Parse annotated content/ citations.
 */
function processAnnotatedContent(responseData) {
    if (!responseData?.content) {
        return safeMarkdownParse(JSON.stringify(responseData));
    }

    const { content, citationsHtml } = processCitations(responseData);

    return `
    <div class="message-text">${safeMarkdownParse(content)}</div>
    ${citationsHtml ? `
      <div class="citations-container">
        <div class="citations-header">
          <span class="citations-icon">📚</span>
          <span>Sources</span>
        </div>
        ${citationsHtml}
      </div>
    ` : ''}
  `;
}

/**
 * Highlight code blocks after DOM insert.
 */
function highlightCodeBlocks(container) {
    if (typeof Prism === "undefined") return;

    container.querySelectorAll("pre code").forEach((block) => {
        block.style.opacity = "0";
        Prism.highlightElement(block);
        setTimeout(() => {
            block.style.opacity = "1";
        }, 100);
    });
}

/**
 * Add "copy to clipboard" to streaming container.
 */
function addCopyButton(container, content) {
    const button = document.createElement("button");
    button.className = "copy-button";
    button.innerHTML = "📋";
    button.title = "Copy to clipboard";
    button.onclick = () => navigator.clipboard.writeText(content);
    container.prepend(button);
}

/**
 * Generic error handler.
 */
async function handleMessageError(error) {
    console.error("[handleMessageError]", error);

    let errorMessage = "An unexpected error occurred";
    let errorDetails = [];

    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        const reason = error.message || 'Request exceeded time limit';
        errorMessage = `Request was aborted: ${reason}. Try:
1. Reducing reasoning effort
2. Shortening your message
3. Breaking your request into smaller parts
4. The request will automatically retry up to 3 times with exponential backoff`;
        console.warn("[handleMessageError] Request aborted:", {
            reason,
            timeout: window.serverCalculatedTimeout ? `${window.serverCalculatedTimeout}s` : 'default',
            name: error.name,
            type: error.constructor.name
        });
    } else if (error.response) {
        try {
            const contentType = error.response.headers.get("content-type");
            const apiError = contentType?.includes("application/json")
                ? await error.response.json()
                : { error: { code: "invalid_response", message: await error.response.text() } };
            errorMessage = apiError.error?.message || error.message;
            errorDetails = apiError.error?.details || [];
            if (apiError.type === "validation_error") {
                if (apiError.fields) {
                    errorDetails = apiError.fields.map((f) => `${f} parameter`);
                }
                if (apiError.allowed_values) {
                  errorDetails.push(`Allowed values: ${apiError.allowed_values.join(", ")}`);
                }
            }
        } catch (parseError) {
            console.error("[handleMessageError] Error parsing error response:", parseError);
        }
    } else if (error.message) {
        errorMessage = error.message;
    }

    const fullErrorText = [errorMessage, ...errorDetails].filter(Boolean).join("\n");

    displayMessage(`Error: ${errorMessage}`, "error");
    showNotification(fullErrorText, "error");
}

/**
 * Helper function to identify model types for specific handling.
 */
function getModelType(modelConfig) {
    if (modelConfig.name.includes("o1model") || modelConfig.name.includes("o1-preview")) {
        return "o1";
    }
    if (modelConfig.name.includes("DeepSeek")) {
        return "deepseek";
    }
    return "standard";
}

/**
 * Helper function to check if the model is an o1 or o1-preview model.
 */
function isO1Model(modelConfig) {
    return getModelType(modelConfig) === "o1";
}

/**
 * Helper function to check if the model is a DeepSeek model.
 */
function isDeepSeekModel(modelConfig) {
    return getModelType(modelConfig) === "deepseek";
}

/**
 * Main request logic for chat.
 */
export async function sendMessage() {
    const userInput = document.getElementById("user-input");
    const message = userInput.value.trim();
    const modelConfig = await getModelSettings();
    window.isO1Model = isO1Model(modelConfig);

    // Basic model-specific checks:
    if (isO1Model(modelConfig)) {
        // o-series models do not support streaming
        if (document.getElementById("streaming-toggle").checked) {
            showNotification("o-series models do not support streaming", "error");
            return;
        }
    } else if (isDeepSeekModel(modelConfig)) {
        // DeepSeek models support streaming but require reasoning effort
        if (!config.reasoningEffort) {
            showNotification("DeepSeek models require reasoning effort to be specified", "warning");
            config.reasoningEffort = "medium"; // Set default
        }
    }

    console.log("[MessageHandler] Initiated sendMessage:", {
        messagePreview: message.slice(0, 50) + (message.length > 50 ? "..." : ""),
        messageLength: message.length,
        modelConfig
    });

    if (!message) return;

    try {
        if (!sessionId) {
            const initialized = await initializeSession();
            if (!initialized) {
                throw new Error("Failed to initialize session");
            }
        }

        userInput.disabled = true;
        setLastUserMessage(message);
        displayMessage(safeMarkdownParse(message), "user");
        userInput.value = "";

        const config = await getCurrentConfig();
        const effortLevel = config?.reasoningEffort || "medium";
        const timeout = getTimeoutDurations()[effortLevel] || 30000;
        console.log("[Config] Current settings:", { effort: effortLevel, timeout, modelSettings: modelConfig });

        showTypingIndicator();

        const { controller } = createAbortController(timeout);
        const processedContent = processMessageContent(message, modelConfig.supportsVision);

        const response = await handleChatRequest({
            messageContent: processedContent,
            controller,
            developerConfig: config.developerConfig,
            reasoningEffort: config.reasoningEffort
        });

        // If model supports streaming, do it; otherwise, standard response:
        if (modelConfig.supportsStreaming && !isO1Model(modelConfig)) {
            await handleStreamingResponse(response, controller);
        } else {
            await handleStandardResponse(response);
        }
    } catch (err) {
        handleMessageError(err);
    } finally {
        removeTypingIndicator();
        userInput.disabled = false;
    }
}

/**
 * If user clicks a "Regenerate" button, re-send last user message.
 */
export async function regenerateResponse() {
    const lastMessage = getLastUserMessage();
    if (lastMessage) {
        document.getElementById("user-input").value = lastMessage;
        await sendMessage();
    }
}

/**
 * Main function to handle sending request to server.
 * @param {Object} params - The parameters for the request
 * @param {string|Object} params.messageContent - The content of the message to send
 * @param {AbortController} params.controller - The AbortController to handle request timeout
 * @param {Object} [params.developerConfig] - Optional developer configuration
 * @param {string} params.reasoningEffort - The reasoning effort level for the request
 * @returns {Promise<Response>} - The server response
 */
async function handleChatRequest({ messageContent, controller, developerConfig, reasoningEffort }) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await makeApiRequest({
                messageContent,
                controller,
                developerConfig,
                reasoningEffort
            });
            return response;
        } catch (error) {
            lastError = error;

            // Only retry on timeout/abort errors
            if (attempt < maxRetries - 1 &&
                (error instanceof DOMException &&
                    (error.name === "TimeoutError" || error.name === "AbortError"))) {
                const delay = 60000 * (attempt + 1); // 60s, 120s, 180s
                console.warn(`[handleChatRequest] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

/**
 * Helper function to make the actual API request
 */
async function makeApiRequest({ messageContent, controller, developerConfig, reasoningEffort }) {
    const config = await getCurrentConfig();
    const modelConfig = await getModelSettings();
    const apiVersion = modelConfig.api_version;

    // Always use the deployment name from config.
    const deploymentName = config.deploymentName;
    if (!deploymentName) {
        console.error("[handleChatRequest] Config:", config);
        throw new Error("No valid deployment name found in configuration.");
    }
    console.log("[handleChatRequest] Using deployment name:", deploymentName);

    if (!sessionId) {
        await initializeSession();
        if (!sessionId) {
            throw new Error("Could not initialize session");
        }
    }

    /** 
     * Build request body based on model type and requirements
     */
    const fileContext = getFilesForChat();
    console.log("[handleChatRequest] File context:", fileContext);

    const requestBody = {
        messages: [
            {
                role: "user",
                content: typeof messageContent === "string" ? messageContent : JSON.stringify(messageContent)
            }
        ],
        include_files: fileContext.include_files,
        file_ids: fileContext.file_ids,
        use_file_search: fileContext.use_file_search
    };

    // Add model-specific parameters
    if (isDeepSeekModel(modelConfig)) {
        requestBody.reasoning_effort = reasoningEffort || "medium";
        if (modelConfig.capabilities?.max_tokens) {
            requestBody.max_tokens = modelConfig.capabilities.max_tokens;
        }
    }

    // Handle model-specific parameters
    if (isO1Model(modelConfig)) {
        if (modelConfig.capabilities?.max_completion_tokens) {
            requestBody.max_completion_tokens = modelConfig.capabilities.max_completion_tokens;
        }
        if (modelConfig.name.includes("o1-preview")) {
            requestBody.temperature = 1;
        }
        if (modelConfig.capabilities?.fixed_temperature !== undefined) {
            requestBody.temperature = modelConfig.capabilities.fixed_temperature;
        }
    } else {
        if (!isDeepSeekModel(modelConfig) && modelConfig.capabilities?.temperature !== undefined) {
            requestBody.temperature = modelConfig.capabilities.temperature;
        }
    }

    if (modelConfig.developer_message) {
        requestBody.messages.unshift({
            role: isO1Model(modelConfig) ? "developer" : "system",
            content: modelConfig.developer_message
        });
    }

    console.log("[handleChatRequest] Sending payload:", JSON.stringify(requestBody, null, 2));

    const configData = await getCurrentConfig();
    const apiKey = configData.azureOpenAI?.apiKey;
    if (!apiKey) {
        throw new Error("Azure OpenAI API key not configured");
    }

    const url = await buildAzureOpenAIUrl(deploymentName, apiVersion);
    const init = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "api-key": apiKey
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody)
    };

    const requestStartTime = Date.now();
    const response = await fetch(url, init);
    response.requestStartTime = requestStartTime;

    return response;
}

/**
 * Creates an AbortController with a dynamic or default timeout.
 */
function createAbortController(timeoutDuration) {
    const controller = new AbortController();
    const minTimeout = window.isO1Model ? 60000 : timeoutDuration;
    const actualTimeout = window.serverCalculatedTimeout
        ? Math.max(window.serverCalculatedTimeout * 1000, minTimeout)
        : minTimeout;

    console.log(`[createAbortController] Setting timeout: ${actualTimeout}ms`);

    const timeoutId = setTimeout(
        () => {
            console.log(`[createAbortController] Request timed out after ${actualTimeout}ms`);
            controller.abort(new DOMException(
                `Request exceeded time limit of ${actualTimeout}ms`,
                'TimeoutError'
            ));
        },
        actualTimeout
    );
    return { controller, timeoutId };
}

/**
 * Processes user's message content, removing or transforming images if needed.
 */
function processMessageContent(message, supportsVision) {
    const IMAGE_REGEX = /!$$.*?$$$(https?:\/\/[^\s)]+)$/g;
    const imageMatches = message.match(IMAGE_REGEX);

    if (imageMatches && !supportsVision) {
        showNotification(
            "Images are only supported with vision-enabled models. Please switch to a vision model or remove images.",
            "warning"
        );
        return message.replace(IMAGE_REGEX, "[Image Removed]");
    }

    try {
        return imageMatches ? imageMatches.map(createImageContent) : message;
    } catch (error) {
        console.error("Error processing image content:", error);
        return message;
    }
}

function createImageContent(match) {
    const url = match.match(/$(https?:\/\/[^\s)]+)$/)[1];
    return {
        type: "image_url",
        image_url: { url, detail: "auto" }
    };
}

/**
 * Helper function to count tokens in a given text chunk.
 * (This is a simple whitespace-based approximation.)
 */
function countTokensInChunk(chunk) {
    return chunk.split(/\s+/).length;
}

/**
 * Updates UI elements based on the selected model.
 * @param {string} model - The selected model identifier.
 */
async function updateModelSpecificUI(model) {
    const modelConfig = await getModelSettings(model);
    const reasoningControls = document.getElementById('reasoning-controls');
    const streamingToggle = document.getElementById('enable-streaming');

    reasoningControls.style.display = modelConfig.capabilities.requires_reasoning_effort ? 'block' : 'none';
    streamingToggle.disabled = !modelConfig.capabilities.supports_streaming;
}

/**
 * Updates the reasoning effort display based on slider value.
 * @param {string} value - The slider value (1-3).
 */
function updateReasoningEffortDisplay(value) {
    const display = document.getElementById('reasoning-effort-display');
    const labels = ['Low', 'Medium', 'High'];
    display.textContent = labels[value - 1];
}
