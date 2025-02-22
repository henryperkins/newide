// Complete, cleaned-up version of messageHandler.js to resolve syntax errors.
// This version consolidates the code we have been editing and removes any extraneous or malformed lines.

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

import { displayMessage } from "/static/js/ui/displayManager.js";
import { safeMarkdownParse } from "/static/js/ui/markdownParser.js";
import { updateTokenUsage, buildAzureOpenAIUrl } from "/static/js/utils/helpers.js";

import {
  getCurrentConfig,
  getTimeoutDurations,
  getModelSettings
} from "/static/js/config.js";

import { getFilesForChat } from "/static/js/fileManager.js";

/**
 * Creates an AbortController with a dynamic or default timeout
 */
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

/**
 * Processes user's message content, removing or transforming images if needed
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
 * Handle the normal (non-streaming) HTTP response
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
 * Handle streaming responses, e.g. SSE
 */
async function handleStreamingResponse(response, controller) {
  console.log("[handleStreamingResponse] Starting SSE streaming...");

  const streamUrl = buildAzureOpenAIUrl(deploymentName, modelConfig.api_version)
    .replace('/chat/completions', '/chat/completions/stream')
    + `&session_id=${sessionId}`;
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
 * Create container for streaming messages
 */
function createMessageContainer() {
  const container = document.createElement("div");
  container.className = "message assistant-message streaming";
  document.getElementById("chat-history").appendChild(container);
  return container;
}

/**
 * Add "streaming" styles
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
 * Update streaming UI with next chunk
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
 * Finalize streaming response once it's done
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
 * Process the final server response data
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
 * Parse annotated content/ citations
 */
function processAnnotatedContent(responseData) {
  if (!responseData?.content) {
    return safeMarkdownParse(JSON.stringify(responseData));
  }

  let content = responseData.content;
  const citations = [];

  // Possibly new or old format for citations
  if (responseData.context?.citations) {
    responseData.context.citations.forEach((citation, index) => {
      const ref = `[doc${index + 1}]`;
      content = content.replace(ref, `[${index + 1}]`);
      citations.push(
        createCitationElement(index + 1, {
          file_name: citation.document_name,
          quote: citation.content
        })
      );
    });
  } else if (Array.isArray(responseData.content)) {
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

  const finalHtml = `
    <div class="message-text">${safeMarkdownParse(content)}</div>
    ${
      citations.length
        ? `
          <div class="citations-container">
            <div class="citations-header">
              <span class="citations-icon">📚</span>
              <span>Sources</span>
            </div>
            ${citations.join("")}
          </div>
        `
        : ""
    }
  `;

  return finalHtml;
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

/**
 * Highlight code blocks after DOM insert
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
 * Add "copy to clipboard" to streaming container
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
 * Generic error handler
 */
async function handleMessageError(error) {
  console.error("[handleMessageError]", error);

  let errorMessage = "An unexpected error occurred";
  let errorDetails = [];

  if (error.name === "AbortError") {
    errorMessage = "Request timed out. Consider using lower reasoning effort.";
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
 * Main request logic for chat
 */
export async function sendMessage() {
  const userInput = document.getElementById("user-input");
  const message = userInput.value.trim();
    const modelConfig = await getModelSettings();

  // Basic checks for o-series
  if (modelConfig.name.includes("o1")) {
    if (document.getElementById("streaming-toggle").checked) {
      showNotification("o-series models do not support streaming", "error");
      return;
    }
  }

  const modelSettings = await getModelSettings(); // Fetch modelSettings again
  console.log("[MessageHandler] Initiated sendMessage:", {
    messagePreview: message.slice(0, 50) + (message.length > 50 ? "..." : ""),
    messageLength: message.length,
    modelConfig
  });

  if (!message) return;

  try {
    if (!sessionId && !(await initializeSession())) {
      throw new Error("Failed to initialize session");
    }

    if (modelConfig?.name?.includes?.("o1") && modelConfig.supportsVision) {
      displayMessage("Formatting re-enabled: Markdown processing activated", "developer");
      if (document.getElementById("streaming-toggle").checked) {
        showNotification("o1 models do not support streaming", "warning");
        return;
      }
    }

    userInput.disabled = true;
    setLastUserMessage(message);
    displayMessage(message, "user");
    userInput.value = "";

    const config = getCurrentConfig();
    const effortLevel = config?.reasoningEffort || "medium";
    const timeout = getTimeoutDurations()[effortLevel] || 30000;
    console.log("[Config] Current settings:", { effort: effortLevel, timeout, modelSettings });

    const { controller } = createAbortController(timeout);
    const processedContent = processMessageContent(message, modelConfig.supportsVision);

    const response = await handleChatRequest({
      messageContent: processedContent,
      controller,
      developerConfig: config.developerConfig,
      reasoningEffort: config.reasoningEffort
    });

    if (modelConfig.supportsStreaming) {
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
 * If user clicks a "Regenerate" button, re-send last user message
 */
export async function regenerateResponse() {
  const lastMessage = getLastUserMessage();
  if (lastMessage) {
    document.getElementById("user-input").value = lastMessage;
    await sendMessage();
  }
}

/**
 * Main function to handle sending request to server
 */
async function handleChatRequest({ messageContent, controller, developerConfig, reasoningEffort }) {
  const config = getCurrentConfig();
  const modelConfig = await getModelSettings();
  const apiVersion = modelConfig.api_version;

  const deploymentName = config.selectedModel || "o1model-east2";
  console.log("[handleChatRequest] Deployment Name:", deploymentName); // Log deploymentName

  if (!sessionId) {
    await initializeSession();
    if (!sessionId) {
      throw new Error("Could not initialize session");
    }
  }

  const requestBody = {
    model: deploymentName,
    messages: [
      {
        role: "user",
        content: typeof messageContent === "string" ? messageContent : JSON.stringify(messageContent)
      }
    ],
    session_id: sessionId,
    reasoning_effort: reasoningEffort
  };

  if (modelConfig.name.includes("o1")) {
    if (modelConfig.capabilities?.max_completion_tokens) {
      requestBody.max_completion_tokens = modelConfig.capabilities.max_completion_tokens;
    }
    if (modelConfig.capabilities?.fixed_temperature !== undefined) {
      requestBody.temperature = modelConfig.capabilities.fixed_temperature;
    }
  }

  if (modelConfig.developer_message) {
    requestBody.messages.unshift({
      role: "developer",
      content: modelConfig.developer_message
    });
  }

  if (developerConfig) {
    requestBody.developer_config = developerConfig;
  }

  console.log("[handleChatRequest] Sending payload:", JSON.stringify(requestBody, null, 2));

  const url = buildAzureOpenAIUrl(deploymentName, modelConfig.api_version);
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": config.AZURE_OPENAI_API_KEY, || "YOUR_AZURE_OPENAI_KEY"
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
