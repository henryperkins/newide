//////////////////////////////////////////////////////////////
// messageHandler.js - updated to support o1 model restrictions
// and Azure OpenAI API reference
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
 * Process the final server response data
 */
function processResponseData(data) {
  if (data.calculated_timeout) {
    window.serverCalculatedTimeout = data.calculated_timeout;
  }

  // The top-level response might have a 'response' field containing
  // the assistant's message. This depends on your server format.
  // If your server returns the standard AzureOpenAI shape, you'll need
  // to parse out data.choices[0].message.content, for example. Adjust accordingly.
  if (data.response) {
    displayMessage(data.response, "assistant");
  } else if (data.choices && data.choices[0]?.message?.content) {
    displayMessage(data.choices[0].message.content, "assistant");
  } else {
    console.warn("[processResponseData] No recognized content in response. Raw data:", data);
  }

  // Usage keys may differ. Adjust if your server returns
  // usage.completion_tokens or usage.prompt_tokens, etc.
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
 * Helper function to check if the model is o1 series
 */
function isO1Model(modelConfig) {
  // Adjust the detection as appropriate
  return modelConfig?.name?.includes("o1");
}

/**
 * Main request logic for chat
 */
export async function sendMessage() {
  const userInput = document.getElementById("user-input");
  const message = userInput.value.trim();
  const modelConfig = await getModelSettings();

  // If the model is an o1, streaming is not supported
  const streamingEnabled = document.getElementById("streaming-toggle")
    && document.getElementById("streaming-toggle").checked;
  if (isO1Model(modelConfig) && streamingEnabled) {
    showNotification("o1 models do not support streaming", "warning");
    return;
  }

  console.log("[sendMessage] Attempting to send message:", message);
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
    displayMessage(message, "user");
    userInput.value = "";

    const config = await getCurrentConfig();
    const effortLevel = config?.reasoningEffort || "medium";
    const timeout = getTimeoutDurations()[effortLevel] || 30000;
    console.log("[Config] Current settings:", { effortLevel, timeout, modelConfig });

    const { controller } = createAbortController(timeout);

    // If the model supports vision, we can pass images; otherwise, remove them
    const processedContent = processMessageContent(message, modelConfig.supportsVision);

    // Send the request
    const response = await handleChatRequest({
      messageContent: processedContent,
      controller,
      reasoningEffort: config.reasoningEffort
    });

    // If model supports streaming, handle it, else handle standard
    if (!isO1Model(modelConfig) && modelConfig.supportsStreaming && streamingEnabled) {
      // If your server actually supports SSE streaming, you'd handle it here.
      // For brevity, we’ll just do standard handling if not an o1 model.
      const data = await response.json();
      processResponseData(data);
    } else {
      // Always do standard handling for o1 or if streaming is off
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
 * @param {Object} params - The parameters for the request
 * @param {string|Object} params.messageContent - The content of the message to send
 * @param {AbortController} params.controller - The AbortController to handle request timeout
 * @param {string} params.reasoningEffort - The reasoning effort level for the request
 * @returns {Promise<Response>} - The server response
 */
async function handleChatRequest({ messageContent, controller, reasoningEffort }) {
  const config = await getCurrentConfig();
  const modelConfig = await getModelSettings();
  const apiVersion = modelConfig.api_version;

  // The deployment name is the {deployment-id} from Azure
  const deploymentName = config.deploymentName;
  if (!deploymentName) {
    console.error("[handleChatRequest] Invalid config:", config);
    throw new Error("No valid deployment name found in configuration.");
  }

  if (!sessionId) {
    await initializeSession();
    if (!sessionId) {
      throw new Error("Could not initialize session");
    }
  }

  // Build the standard chat completion request body
  // Because we're calling /deployments/{deploymentName}/chat/completions
  // we do NOT pass model = ...
  const requestBody = {
    messages: [
      // You can add a developer message if needed:
      // { role: "developer", content: "Formatting re-enabled" },
      {
        role: "user",
        content: typeof messageContent === "string"
          ? messageContent
          : JSON.stringify(messageContent)
      }
    ]
  };

  // If the model is an o1 or o3-mini, we can optionally pass reasoning_effort
  if (isO1Model(modelConfig) && reasoningEffort) {
    requestBody.reasoning_effort = reasoningEffort; 
  }

  // For o1, we use `max_completion_tokens` but do NOT pass temperature, top_p, etc.
  // If your config defines a recommended max_completion_tokens for an o1 model, set it here:
  if (isO1Model(modelConfig)) {
    if (modelConfig.capabilities?.max_completion_tokens) {
      requestBody.max_completion_tokens = modelConfig.capabilities.max_completion_tokens;
    }
  } else {
    // For non-o1 models, you might pass normal chat parameters (temperature, top_p, etc.) 
    // if you have them. Just an example:
    if (modelConfig.temperature !== undefined) {
      requestBody.temperature = modelConfig.temperature;
    }
  }

  console.log("[handleChatRequest] Sending payload:", JSON.stringify(requestBody, null, 2));

  const configData = await getCurrentConfig();
  const apiKey = configData.azureOpenAI?.apiKey;
  if (!apiKey) {
    throw new Error("Azure OpenAI API key not configured");
  }

  // Build the Azure OpenAI endpoint
  const url = buildAzureOpenAIUrl(
    deploymentName || "o1hp",
    apiVersion || "2025-01-01-preview"
  );

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
