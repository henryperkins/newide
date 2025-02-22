//////////////////////////////////////////////////////////////
// messageHandler.js
//////////////////////////////////////////////////////////////

import {
  sessionId,
  initializeSession,
  getLastUserMessage,
  setLastUserMessage
} from "/static/js/session.js";

import {
  showNotification,
  showTypingIndicator,
  removeTypingIndicator
} from "/static/js/ui/notificationManager.js";

import { displayMessage, processCitations } from "/static/js/ui/displayManager.js";
import { safeMarkdownParse } from "/static/js/ui/markdownParser.js";
import { updateTokenUsage, buildAzureOpenAIUrl } from "/static/js/utils/helpers.js";

import {
  getCurrentConfig,
  getTimeoutDurations,
  getModelSettings
} from "/static/js/config.js";

import { getFilesForChat } from "/static/js/fileManager.js";

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
  const IMAGE_REGEX = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
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
  const url = match.match(/\((https?:\/\/[^\s)]+)\)/)[1];
  return {
    type: "image_url",
    image_url: { url, detail: "auto" }
  };
}

/**
 * Handle the normal (non-streaming) HTTP response.
 */
async function handleStandardResponse(response) {
  const requestDuration = Date.now() - response.requestStartTime;
  console.log(
    "[handleStandardResponse] Response after",
    requestDuration,
    "ms",
    "Status:",
    response.status
  );

  if (!response.ok) {
    try {
      const errorData = await response.json();
      console.error("[handleStandardResponse] API Error details:", errorData);
      const errorDetails = JSON.stringify(errorData);
      throw new Error(
        `HTTP error! status: ${response.status}, details: ${errorDetails}`
      );
    } catch (jsonParseErr) {
      console.error("[handleStandardResponse] Non-JSON error response:", jsonParseErr);
      throw jsonParseErr;
    }
  }

  const data = await response.json();
  processResponseData(data);
}

/**
 * Handle streaming responses, e.g. SSE.
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
  const streamUrl = await buildAzureOpenAIUrl(deploymentName, modelConfig.api_version)
    .replace('/chat/completions', '/chat/completions/stream');

  console.log("[handleStreamingResponse] Using deployment name:", deploymentName);
  const eventSource = new EventSource(streamUrl);

  let messageContainer = null;

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
  container.className = "message assistant-message streaming";
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

  displayMessage(data.response, "assistant");

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
 * Helper function to check if the model is an o1 or o1-preview model.
 */
function isO1Model(modelConfig) {
  // Adjust this check as needed if your naming includes "o1-preview"
  return modelConfig.name.includes("o1model") || modelConfig.name.includes("o1-preview");
}

/**
 * Main request logic for chat.
 */
export async function sendMessage() {
  const userInput = document.getElementById("user-input");
  const message = userInput.value.trim();
  const modelConfig = await getModelSettings();
  window.isO1Model = isO1Model(modelConfig);

  // Basic checks for o-series:
  if (isO1Model(modelConfig)) {
    // These specialized reasoning models do not support streaming:
    if (document.getElementById("streaming-toggle").checked) {
      showNotification("o-series models do not support streaming", "error");
      return;
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

    // If you want to encourage markdown usage with o1, you can add "Formatting re-enabled" 
    // to a developer message or mention it to the user here. 
    // e.g., displayMessage("Formatting re-enabled - code output should be wrapped in markdown.", "developer");

    userInput.disabled = true;
    setLastUserMessage(message);
    displayMessage(message, "user");
    userInput.value = "";

    const config = await getCurrentConfig();
    const effortLevel = config?.reasoningEffort || "medium";
    const timeout = getTimeoutDurations()[effortLevel] || 30000;
    console.log("[Config] Current settings:", { effort: effortLevel, timeout, modelSettings: modelConfig });

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
   * For o1 / o1-preview models, `max_completion_tokens` is mandatory
   * and we must not set `max_tokens`. Also temperature must be 1 for o1-preview.
   */
  const requestBody = {
    messages: [
      {
        role: "user",
        content: typeof messageContent === "string" ? messageContent : JSON.stringify(messageContent)
      }
    ]
  };

  // If we detect an o1 or o1-preview model, set relevant parameters
  if (isO1Model(modelConfig)) {
    // Use max_completion_tokens if the config provides it.
    if (modelConfig.capabilities?.max_completion_tokens) {
      requestBody.max_completion_tokens = modelConfig.capabilities.max_completion_tokens;
    }
    // If the model is o1-preview, forcibly set temperature=1 to comply with doc requirements.
    if (modelConfig.name.includes("o1-preview")) {
      requestBody.temperature = 1;
    }
    // If the model's config forcibly sets a certain temperature
    // (like a 'fixed_temperature') keep that consistent with the doc:
    if (modelConfig.capabilities?.fixed_temperature !== undefined) {
      requestBody.temperature = modelConfig.capabilities.fixed_temperature;
    }
  }

  // If the model is not o1, see if there's a developer message to prepend
  // or a "normal" temperature setting:
  else {
    // Non-o1 models can use whatever temperature is in capabilities or config
    if (modelConfig.capabilities?.temperature !== undefined) {
      requestBody.temperature = modelConfig.capabilities.temperature;
    }
  }
 
  // If dev instructions are present in model config, prepend them as a developer message
  if (modelConfig.developer_message) {
    requestBody.messages.unshift({
      role: isO1Model(modelConfig) ? "developer" : "system",
      content: modelConfig.developer_message
    });
  }

  // Log final request payload before sending
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
// End of messageHandler.js