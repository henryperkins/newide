/* 
 * streaming.js - Core module for handling streaming chat responses
 *
 * This module contains the functionality for processing streaming Server-Sent Events (SSE)
 * from the API and rendering them incrementally into the DOM. It's specifically enhanced
 * to support DeepSeek-R1 model responses with "thinking" blocks.
 */

import { getSessionId } from "./session.js";
import {
  updateTokenUsage,
  fetchWithRetry,
  retry,
  eventBus,
} from "./utils/helpers.js";
import {
  showNotification,
  handleMessageError,
} from "./ui/notificationManager.js";
import { deepSeekProcessor } from "./ui/deepseekProcessor.js";
import {
  ensureMessageContainer,
  shouldRenderNow,
  showStreamingProgressIndicator,
  removeStreamingProgressIndicator,
  finalizeStreamingContainer,
  handleStreamingError as utilsHandleStreamingError,
} from "./streaming_utils.js";
import {
  renderContentEfficiently,
  renderThinkingContainer as fallbackRenderThinkingContainer,
} from "./streamingRenderer.js";

// --- Global state variables ---
let mainTextBuffer = "";
let thinkingTextBuffer = "";
let chunkBuffer = "";
let messageContainer = null;
let thinkingContainer = null;
let isThinking = false;
let lastRenderTimestamp = 0;
let animationFrameId = null;
let errorState = false;
let connectionTimeoutId = null;
let connectionCheckIntervalId = null;
let streamStartTime = 0;
let firstTokenTime = 0;
let tokenCount = 0;
let lastScrollTimestamp = 0;
let currentMessageId = null; // Track the current message ID
let currentMessageContainer = null; // Track the current container element ID
let thinkingContainers = {}; // Store thinking containers by message ID

// --- Constants ---
const RENDER_INTERVAL_MS = 150; // Increased from 50ms for better performance
const SCROLL_INTERVAL_MS = 500; // Only scroll every 500ms to reduce jitter
const BASE_CONNECTION_TIMEOUT_MS = 60000; // 60 seconds
const MAX_CONNECTION_TIMEOUT_MS = 180000; // 3 minutes
const MAX_RETRY_ATTEMPTS = 3;
const CONNECTION_CHECK_INTERVAL_MS = 5000; // 5 seconds

/**
 * Calculates tokens per second based on usage data and streaming duration
 * @param {Object} usage - The token usage data
 * @returns {number} - Tokens per second rate
 */
function calculateTokensPerSecond(usage) {
  if (!usage || !streamStartTime) return 0;

  const elapsedMs = performance.now() - streamStartTime;
  if (elapsedMs <= 0) return 0;

  const totalTokens = usage.completion_tokens || 0;
  const tokensPerSecond = (totalTokens / elapsedMs) * 1000;

  return Math.min(tokensPerSecond, 1000); // Cap at 1000 t/s for reasonable display
}

/**
 * Dynamically calculates a connection timeout based on model type and message length.
 * Longer messages and certain model types get extended timeouts.
 */
function calculateConnectionTimeout(modelName, messageLength) {
  let timeout = BASE_CONNECTION_TIMEOUT_MS;
  const normalizedModelName = modelName ? modelName.toLowerCase() : "";

  console.log(
    `[calculateConnectionTimeout] Starting with base timeout: ${timeout}ms`
  );

  if (
    normalizedModelName.indexOf("o1") !== -1 ||
    normalizedModelName.indexOf("o3") !== -1
  ) {
    timeout *= 2.5;
    console.log(
      `[calculateConnectionTimeout] O-series model detected, timeout now: ${timeout}ms`
    );
  } else if (normalizedModelName.indexOf("claude") !== -1) {
    timeout *= 2.0;
    console.log(
      `[calculateConnectionTimeout] Claude model detected, timeout now: ${timeout}ms`
    );
  } else if (normalizedModelName.indexOf("deepseek") !== -1) {
    timeout *= 2.0;
    console.log(
      `[calculateConnectionTimeout] DeepSeek model detected, timeout now: ${timeout}ms`
    );
  }

  if (messageLength > 1000) {
    const lengthFactor = 1 + messageLength / 10000;
    timeout *= lengthFactor;
    console.log(
      `[calculateConnectionTimeout] Applied message length factor: ${lengthFactor}, timeout now: ${timeout}ms`
    );
  }

  const finalTimeout = Math.min(timeout, MAX_CONNECTION_TIMEOUT_MS);
  console.log(`[calculateConnectionTimeout] Final timeout: ${finalTimeout}ms`);
  return finalTimeout;
}

/**
 * Resets the local streaming state.
 */
function resetStreamingState() {
  mainTextBuffer = "";
  thinkingTextBuffer = "";
  chunkBuffer = "";
  messageContainer = null;
  thinkingContainer = null;
  isThinking = false;
  lastRenderTimestamp = 0;
  errorState = false;
  streamStartTime = 0;
  firstTokenTime = 0;
  tokenCount = 0;
  currentMessageId = Date.now().toString();
  currentMessageContainer = null;
  thinkingContainers = {};

  document.querySelectorAll('[data-streaming="true"]').forEach((el) => {
    el.removeAttribute("data-streaming");
  });

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
  if (connectionCheckIntervalId) {
    clearInterval(connectionCheckIntervalId);
    connectionCheckIntervalId = null;
  }
}

/**
 * Main function to stream chat response via SSE.
 * @param {string} messageContent - User's message.
 * @param {string} sessionId - Session identifier.
 * @param {string} modelName - Name of the model to use.
 * @param {string} reasoningEffort - Reasoning effort level (low, medium, high).
 * @param {AbortSignal} signal - Optional signal to abort the request.
 * @param {Array} fileIds - Optional file IDs to include.
 * @param {boolean} useFileSearch - Whether to use file search.
 * @returns {Promise<boolean>} Resolves when streaming completes.
 */
export function streamChatResponse(
  messageContent,
  sessionId,
  modelName = "DeepSeek-R1",
  reasoningEffort = "medium",
  signal,
  fileIds = [],
  useFileSearch = false
) {
  resetStreamingState();
  streamStartTime = performance.now();

  return new Promise(async (resolve, reject) => {
    if (!sessionId) {
      reject(
        new Error("Invalid sessionId: Session ID is required for streaming")
      );
      return;
    }
    const validModelName = (modelName || "DeepSeek-R1").toLowerCase();
    if (!validModelName || typeof validModelName !== "string") {
      reject(new Error("Invalid model name"));
      return;
    }

    const params = new URLSearchParams();
    let finalModelName = modelName;
    const isOSeries =
      validModelName.indexOf("o1") !== -1 ||
      validModelName.indexOf("o3") !== -1;
    const isDeepSeek = validModelName.includes("deepseek");

    if (finalModelName.trim().toLowerCase() === "deepseek-r1") {
      finalModelName = "DeepSeek-R1";
      params.append("temperature", "0.5");
    }

    params.append("model", finalModelName);
    params.append("message", messageContent || "");

    if (isOSeries) {
      params.append("reasoning_effort", reasoningEffort || "medium");
      params.append("response_format", "json_schema");
      params.append("max_completion_tokens", "100000");
    } else if (reasoningEffort && !isDeepSeek) {
      params.append("reasoning_effort", reasoningEffort);
    }

    if (fileIds && fileIds.length > 0) {
      params.append("include_files", "true");
      fileIds.forEach((fileId) => {
        params.append("file_ids", fileId);
      });
      if (useFileSearch) {
        params.append("use_file_search", "true");
      }
    }

    const apiUrl = `${window.location.origin}/api/chat/sse?session_id=${encodeURIComponent(
      sessionId
    )}`;
    const fullUrl = apiUrl + "&" + params.toString();

    try {
      const headers = {
        "Content-Type": "application/json",
      };
      if (isDeepSeek) {
        headers["x-ms-thinking-format"] = "html";
        headers["x-ms-streaming-version"] = "2024-05-01-preview";
        console.log("[streamChatResponse] Adding DeepSeek-R1 required headers");
      }

      const response = await fetch(fullUrl, {
        headers: headers,
        signal: signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let onMessageCallback = null;
      let onErrorCallback = null;
      let onCompleteCallback = null;
      let isStreamActive = true;

      const connectionTimeoutMs = calculateConnectionTimeout(
        validModelName,
        messageContent.length
      );
      console.log(
        "Setting connection timeout to " +
        connectionTimeoutMs +
        "ms for " +
        validModelName
      );

      connectionTimeoutId = setTimeout(() => {
        if (isStreamActive) {
          console.warn("Connection timed out after " + connectionTimeoutMs + "ms");
          isStreamActive = false;
          handleStreamingError(new Error("Connection timeout"));
          if (reader) reader.cancel();
        }
      }, connectionTimeoutMs);

      connectionCheckIntervalId = setInterval(() => {
        if (!isStreamActive) {
          clearInterval(connectionCheckIntervalId);
        }
      }, CONNECTION_CHECK_INTERVAL_MS);

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(connectionTimeoutId);
            clearInterval(connectionCheckIntervalId);
            isStreamActive = false;
            if (reader) reader.cancel();
          },
          { once: true }
        );
      }

      const processChunk = async () => {
        try {
          const { value, done } = await reader.read();

          if (done) {
            isStreamActive = false;
            clearTimeout(connectionTimeoutId);
            clearInterval(connectionCheckIntervalId);

            if (onCompleteCallback) {
              onCompleteCallback({ data: "" });
            }
            await cleanupStreaming(finalModelName);
            resolve(true);
            return;
          }

          const text = decoder.decode(value);
          chunkBuffer += text;
          const chunks = chunkBuffer.split("\n\n");
          chunkBuffer = chunks.pop() || "";

          for (const rawLine of chunks) {
            const line = rawLine.trim();
            if (!line) continue;

            if (line.startsWith("data:")) {
              const dataPart = line.slice(5).trim();

              if (dataPart === "done") {
                if (onCompleteCallback) {
                  onCompleteCallback({ data: "" });
                }
                continue;
              }

              try {
                const azureData = JSON.parse(dataPart);

                // Reset connection timeout on each message
                clearTimeout(connectionTimeoutId);
                connectionTimeoutId = setTimeout(() => {
                  if (isStreamActive) {
                    console.warn(
                      "Stream stalled after " + connectionTimeoutMs * 1.5 + "ms"
                    );
                    isStreamActive = false;
                    handleStreamingError(new Error("Stream stalled"));
                    if (reader) reader.cancel();
                  }
                }, connectionTimeoutMs * 1.5);

                // -------------------------------------------------
                // FIX #1: ALWAYS call onMessageCallback for any chunk
                // including usage/finish_reason. That way, leftover
                // partial text in chunkBuffer is appended properly.
                // -------------------------------------------------
                if (onMessageCallback) {
                  onMessageCallback({ data: dataPart });
                }
              } catch (err) {
                console.error(
                  "Error parsing SSE data from Azure Chat Completions:",
                  err
                );
                import("./sentryInit.js")
                  .then(({ captureError }) => {
                    captureError(err, {
                      context: "streaming.js",
                      location: "SSE data parsing",
                      data: (line || "").substring(0, 200),
                    });
                  })
                  .catch((e) =>
                    console.error("Failed to load Sentry module:", e)
                  );
              }
            } else if (line.startsWith("event: complete")) {
              if (onCompleteCallback) {
                onCompleteCallback({ data: "" });
              }
            }
          }

          processChunk();
        } catch (error) {
          if (error.name !== "AbortError") {
            handleStreamingError(error);
          }
          isStreamActive = false;
        }
      };

      onMessageCallback = (e) => {
        try {
          console.log("Received SSE chunk from server");

          let data;
          try {
            data = JSON.parse(e.data);
          } catch (parseError) {
            data = { text: e.data };
          }

          const modelSelect = document.getElementById("model-select");
          const currentModel =
            modelSelect && modelSelect.value ? modelSelect.value : "DeepSeek-R1";
          const isDeepSeek = currentModel.toLowerCase().includes("deepseek");

          if (isDeepSeek) {
            if (typeof data.text === "string") {
              data.text = data.text.trim();
            } else if (
              data.choices &&
              data.choices[0] &&
              data.choices[0].delta &&
              data.choices[0].delta.content
            ) {
              data.choices[0].delta.content =
                data.choices[0].delta.content.trim();
            } else if (typeof e.data === "string" && e.data.trim()) {
              data = { text: e.data.trim() };
            }
          }

          processDataChunkWrapper(data);
          scheduleRender();
        } catch (err) {
          console.error("[streamChatResponse] Error processing message:", err);
          import("./sentryInit.js")
            .then(({ captureError }) => {
              captureError(err, {
                context: "streaming.js",
                location: "processMessage",
                bufferSizes: {
                  main: mainTextBuffer?.length || 0,
                  thinking: thinkingTextBuffer?.length || 0,
                },
              });
            })
            .catch((e) => console.error("Failed to load Sentry module:", e));

          if (mainTextBuffer || thinkingTextBuffer) {
            forceRender();
          }
        }
      };

      onErrorCallback = async (e) => {
        if (signal && signal.aborted) return;
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);
        isStreamActive = false;

        const error = new Error("Connection failed (EventSource closed)");
        error.recoverable = true;

        handleStreamingError(error);

        if (!navigator.onLine) {
          window.addEventListener(
            "online",
            () => {
              showNotification("Connection restored. Retrying...", "info");
              attemptErrorRecovery(messageContent, error);
            },
            { once: true }
          );
          return;
        }

        showNotification(
          "Connection failed. Would you like to retry?",
          "error",
          0,
          [
            {
              label: "Retry",
              onClick: () => attemptErrorRecovery(messageContent, error),
            },
          ]
        );
      };

      onCompleteCallback = async (e) => {
        try {
          clearTimeout(connectionTimeoutId);
          clearInterval(connectionCheckIntervalId);
          isStreamActive = false;

          // If the final data includes usage, parse it
          if (e.data && e.data !== "done") {
            try {
              const completionData = JSON.parse(e.data);

              let usageData = completionData.usage;
              if (!usageData) {
                console.log(
                  "[onCompleteCallback] No usage data provided, creating estimates"
                );
                usageData = {
                  prompt_tokens: Math.max(
                    Math.round(messageContent.length / 4),
                    1
                  ),
                  completion_tokens: Math.max(
                    Math.round(mainTextBuffer.length / 4),
                    1
                  ),
                  total_tokens: 0,
                };
                usageData.total_tokens =
                  usageData.prompt_tokens + usageData.completion_tokens;
                console.log(
                  "[onCompleteCallback] Created estimated usage data:",
                  usageData
                );
              }

              if (usageData) {
                console.log("Token usage data:", usageData);
                const enhancedUsage = {
                  ...usageData,
                  latency: (performance.now() - streamStartTime).toFixed(0),
                  tokens_per_second: calculateTokensPerSecond(usageData),
                };
                updateTokenUsage(enhancedUsage);

                if (!window.tokenUsageHistory) {
                  window.tokenUsageHistory = {};
                }
                window.tokenUsageHistory[validModelName] = enhancedUsage;
              }

              eventBus.publish("streamingCompleted", {
                modelName: validModelName,
                usage: completionData.usage,
              });

              if (completionData.usage) {
                import("./ui/statsDisplay.js")
                  .then(({ updateStatsDisplay }) => {
                    updateStatsDisplay(completionData.usage);
                  })
                  .catch((error) => {
                    console.error(
                      "Failed to load stats display module:",
                      error
                    );
                  });
              }
            } catch (err) {
              console.warn("Error parsing completion data:", err);
            }
          }

          forceRender();
        } catch (err) {
          console.error("[streamChatResponse] Error handling completion:", err);
        } finally {
          await cleanupStreaming(finalModelName);
          resolve(true);
        }
      };

      eventBus.publish("streamingStarted", { modelName: validModelName });
      processChunk();
    } catch (error) {
      console.error("[streamChatResponse] Setup error:", error);
      handleStreamingError(error);
      reject(error);
    }
  });
}

function handleStreamingError(error) {
  console.error("[handleStreamingError]", error);
  if (!errorState) {
    errorState = true;
    if (mainTextBuffer || thinkingTextBuffer) {
      forceRender();
    }

    if (mainTextBuffer && messageContainer) {
      const errorNote = document.createElement("div");
      errorNote.className =
        "streaming-error-note text-sm text-red-600 dark:text-red-400 mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded";
      errorNote.textContent =
        "⚠️ The response was interrupted and is incomplete due to a connection error.";
      messageContainer.appendChild(errorNote);
    }

    utilsHandleStreamingError(error, showNotification, messageContainer);
    removeStreamingProgressIndicator();
    eventBus.publish("streamingError", {
      error: error,
      recoverable: error.recoverable || false,
      modelName: document.getElementById("model-select")?.value || null,
    });
  }
}

async function attemptErrorRecovery(messageContent, error) {
  if (!navigator.onLine) {
    showNotification("Waiting for internet connection...", "warning", 0);
    return new Promise((resolve) => {
      window.addEventListener(
        "online",
        async () => {
          showNotification("Connection restored. Retrying...", "info", 3000);
          try {
            const sessionId = await getSessionId();
            if (!sessionId) {
              showNotification("Could not retrieve session ID", "error");
              resolve(false);
              return;
            }
            const modelSelect = document.getElementById("model-select");
            let modelName =
              modelSelect && modelSelect.value
                ? modelSelect.value
                : "DeepSeek-R1";
            try {
              const success = await retry(
                () => streamChatResponse(messageContent, sessionId, modelName),
                MAX_RETRY_ATTEMPTS
              );
              resolve(success);
            } catch {
              showNotification("Recovery failed", "error");
              resolve(false);
            }
          } catch (err) {
            console.error("Error retrieving session ID:", err);
            showNotification("Could not retrieve session ID", "error");
            resolve(false);
          }
        },
        { once: true }
      );
    });
  }

  const errorStr = error?.message?.toLowerCase() || "";
  const isServiceUnavailable =
    errorStr.includes("no healthy upstream") ||
    errorStr.includes("failed dependency") ||
    errorStr.includes("deepseek service") ||
    errorStr.includes("missing deepseek required headers") ||
    errorStr.includes("invalid api version");

  if (isServiceUnavailable && error.userRequestedRetry !== true) {
    showNotification("Service unavailable. Consider switching models.", "warning", 5000);
    return false;
  }

  if (isServiceUnavailable) {
    error.userRequestedRetry = true;
  }

  if (
    error.recoverable === true ||
    error.name === "ConnectionError" ||
    error.name === "NetworkError" ||
    error.name === "TimeoutError" ||
    error.userRequestedRetry === true
  ) {
    showNotification("Retrying connection...", "info", 3000);
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const sessionId = await getSessionId();
      if (!sessionId) {
        showNotification("Could not retrieve session ID", "error");
        return false;
      }
      const modelSelect = document.getElementById("model-select");
      let modelName =
        modelSelect && modelSelect.value ? modelSelect.value : "DeepSeek-R1";

      if (isServiceUnavailable && modelName.toLowerCase().includes("deepseek")) {
        const options = modelSelect?.options || [];
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          if (
            option &&
            option.value &&
            !option.value.toLowerCase().includes("deepseek")
          ) {
            modelName = option.value;
            console.log(
              `Switching from DeepSeek to available model: ${modelName}`
            );
            showNotification(
              `Switching to ${modelName} due to DeepSeek unavailability`,
              "info",
              5000
            );
            if (modelSelect) modelSelect.value = modelName;
            break;
          }
        }
      }

      try {
        return await retry(
          () => streamChatResponse(messageContent, sessionId, modelName),
          MAX_RETRY_ATTEMPTS,
          {
            backoff: true,
            initialDelay: 1000,
            maxDelay: 10000,
          }
        );
      } catch {
        showNotification("Recovery failed", "error");
        return false;
      }
    } catch (err) {
      console.error("Error retrieving session ID:", err);
      showNotification("Could not retrieve session ID", "error");
      return false;
    }
  }
  showNotification("Cannot retry - please refresh and try again", "error");
  return false;
}

function processDataChunkWrapper(data) {
  const modelSelect = document.getElementById("model-select");
  const currentModel =
    modelSelect && modelSelect.value ? modelSelect.value : "DeepSeek-R1";
  const isDeepSeek = currentModel.toLowerCase().includes("deepseek");

  try {
    console.log(
      "[processDataChunkWrapper] Processing chunk:",
      typeof data === "object" ? JSON.stringify(data).substring(0, 100) : data
    );

    if (isDeepSeek && typeof data === "object") {
      let contentText = "";

      if (data.text) {
        contentText = data.text;
      } else if (
        data.choices &&
        data.choices[0] &&
        data.choices[0].delta &&
        data.choices[0].delta.content
      ) {
        contentText = data.choices[0].delta.content;
      }

      if (contentText) {
        contentText = contentText.replace(/\r?\n$/, "");

        if (
          mainTextBuffer &&
          contentText.length > 0 &&
          !/^[\s\.,!?;:]/.test(contentText) &&
          !/[\s\.,!?;:]$/.test(mainTextBuffer)
        ) {
          contentText = " " + contentText;
        }

        if (data.text) {
          data.text = contentText;
        } else if (data.choices && data.choices[0] && data.choices[0].delta) {
          data.choices[0].delta.content = contentText;
        }
      }
    }

    if (!messageContainer) {
      messageContainer = ensureMessageContainer();
      if (messageContainer) {
        console.log(
          "[processDataChunkWrapper] Created container:",
          messageContainer.id
        );
        currentMessageContainer = messageContainer.id;
      }
    }

    const processedData = deepSeekProcessor.preprocessChunk
      ? deepSeekProcessor.preprocessChunk(data)
      : data;

    console.log(
      `[processDataChunkWrapper] Current buffer lengths - Main: ${mainTextBuffer.length}, Thinking: ${thinkingTextBuffer.length}`
    );

    const result = deepSeekProcessor.processChunkAndUpdateBuffers(
      processedData,
      chunkBuffer,
      mainTextBuffer,
      thinkingTextBuffer,
      isThinking
    );

    mainTextBuffer = result.mainTextBuffer || "";
    thinkingTextBuffer = result.thinkingTextBuffer || "";
    chunkBuffer = result.chunkBuffer || "";
    isThinking = result.isThinking || false;

    console.log(
      `[processDataChunkWrapper] After processing - Main buffer length: ${mainTextBuffer.length}`
    );

    if (isThinking && thinkingTextBuffer) {
      if (!thinkingContainers[currentMessageId]) {
        thinkingContainers[currentMessageId] =
          deepSeekProcessor.renderThinkingContainer(
            messageContainer,
            thinkingTextBuffer,
            { createNew: true }
          );
      }
      thinkingContainer = thinkingContainers[currentMessageId];
    }

    let shouldForceRender = false;

    if (mainTextBuffer.length > 0 || thinkingTextBuffer.length > 0) {
      shouldForceRender = true;
    }

    if (isDeepSeek) {
      shouldForceRender = true;
    }

    if (shouldForceRender) {
      console.log("[processDataChunkWrapper] Forcing render");
      renderBufferedContent();
    }
  } catch (error) {
    console.error("[processDataChunkWrapper] Error processing chunk:", error);
    import("./sentryInit.js")
      .then(({ captureError }) => {
        captureError(error, {
          context: "streaming.js",
          location: "processDataChunkWrapper",
          modelName: currentModel || "unknown",
          isDeepSeek: isDeepSeek || false,
          dataType: typeof data,
          bufferState: {
            mainLength: mainTextBuffer?.length || 0,
            thinkingLength: thinkingTextBuffer?.length || 0,
            isThinking: isThinking || false,
          },
        });
      })
      .catch((e) => console.error("Failed to load Sentry module:", e));
  }
}

function scheduleRender() {
  if (shouldRenderNow(lastRenderTimestamp, RENDER_INTERVAL_MS)) {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = requestAnimationFrame(() => {
      renderBufferedContent();
      lastRenderTimestamp = Date.now();
      animationFrameId = null;
    });
  }
}

function forceRender() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  renderBufferedContent();
  lastRenderTimestamp = Date.now();
}

function renderBufferedContent() {
  try {
    const chatHistory = document.getElementById("chat-history");
    if (!chatHistory) return;

    if (!messageContainer) {
      // fallback
      messageContainer = ensureMessageContainer();
    }

    console.log(
      `[renderBufferedContent] Buffers - Main: ${mainTextBuffer.length}, Thinking: ${thinkingTextBuffer.length}`
    );

    const mainContentToRender = mainTextBuffer || "";
    renderContentEfficiently(messageContainer, mainContentToRender, {
      scroll:
        Date.now() - lastScrollTimestamp > SCROLL_INTERVAL_MS && !errorState,
    });

    if (thinkingTextBuffer && thinkingTextBuffer.trim()) {
      console.log(
        `[renderBufferedContent] Rendering thinking content, length: ${thinkingTextBuffer.length}`
      );

      let thinkingDiv = messageContainer.querySelector(".thinking-fallback");
      if (!thinkingDiv) {
        thinkingDiv = document.createElement("div");
        thinkingDiv.className =
          "thinking-fallback mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded";
        thinkingDiv.innerHTML = `
          <details open>
            <summary class="font-medium cursor-pointer">Chain of Thought</summary>
            <pre class="whitespace-pre-wrap mt-2 thinking-content">${thinkingTextBuffer}</pre>
          </details>
        `;
        messageContainer.appendChild(thinkingDiv);
      } else {
        const thinkingContent = thinkingDiv.querySelector(".thinking-content");
        if (thinkingContent) {
          thinkingContent.textContent = thinkingTextBuffer;
        }
      }
    }
  } catch (err) {
    console.error("[renderBufferedContent] Error:", err);
    const debugInfo = {
      mainBufferLength: (mainTextBuffer || "").length,
      thinkingBufferLength: (thinkingTextBuffer || "").length,
      messageContainerExists: !!messageContainer,
      messageContainerId: messageContainer?.id || "none",
      errorState: errorState,
    };
    console.error("Debug info:", debugInfo);

    import("./sentryInit.js")
      .then(({ captureError }) => {
        captureError(err, {
          context: "streaming.js",
          location: "renderBufferedContent",
          debug: debugInfo,
        });
      })
      .catch((e) => console.error("Failed to load Sentry module:", e));
  }
}

async function cleanupStreaming(modelName) {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  try {
    const { removeTypingIndicator } = await import("./ui/notificationManager.js");
    removeTypingIndicator();
    removeStreamingProgressIndicator();

    if (messageContainer) {
      finalizeStreamingContainer(messageContainer);
    }
  } catch (error) {
    console.error("[cleanupStreaming] Error cleaning up indicators:", error);
  } finally {
    document.querySelectorAll(".typing-indicator").forEach((el) => el.remove());
    document
      .querySelectorAll(".streaming-progress")
      .forEach((el) => el.remove());
  }

  if (messageContainer) {
    try {
      const conversationId = await getSessionId();
      if (!conversationId) {
        console.error("No valid conversation ID found — cannot store message.");
      } else {
        let finalContent = mainTextBuffer || " ";
        if (thinkingTextBuffer && thinkingTextBuffer.trim()) {
          console.log(
            `[cleanupStreaming] Including thinking content, length: ${thinkingTextBuffer.length}`
          );
          finalContent =
            finalContent + `\n\n<think>${thinkingTextBuffer}</think>`;
        }

        console.log(
          `[cleanupStreaming] Storing message with length: ${finalContent.length}`
        );

        const chunkSize = 1024 * 1024;
        if (finalContent.length > chunkSize * 2) {
          console.log(
            `[cleanupStreaming] Large content detected (${finalContent.length} chars), using chunked approach`
          );
        }

        await fetchWithRetry(
          window.location.origin +
          `/api/chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-Content-Length": finalContent.length.toString(),
            },
            body: JSON.stringify({
              role: "assistant",
              content: finalContent,
              model: modelName || "DeepSeek-R1",
            }),
            timeout: Math.max(30000, finalContent.length / 100),
          }
        ).catch((err) => console.warn("Failed to store message:", err));
      }
    } catch (e) {
      console.warn("Failed to store message:", e);
    }
  }
}

function getReasoningEffortSetting() {
  const slider = document.getElementById("reasoning-effort-slider");
  if (slider) {
    const value = parseInt(slider.value, 10);
    if (value === 1) return "low";
    if (value === 3) return "high";
    return "medium";
  }
  return "medium";
}

// Debug helper
window.debugStreamingState = function () {
  console.log("--- STREAMING DEBUG INFO ---");
  console.log("Main buffer length:", mainTextBuffer?.length || 0);
  console.log(
    "Main buffer content:",
    mainTextBuffer?.substring(0, 100) + "..."
  );
  console.log("Thinking buffer length:", thinkingTextBuffer?.length || 0);
  console.log("Current message container:", messageContainer?.id || "none");
  console.log(
    "Current message container content:",
    messageContainer?.innerHTML?.substring(0, 100) || "none"
  );

  const containers = document.querySelectorAll(
    '.assistant-message[data-streaming="true"]'
  );
  console.log("Active streaming containers:", containers.length);

  containers.forEach((container, i) => {
    console.log(`Container ${i} ID:`, container.id || "no-id");
    console.log(
      `Container ${i} content length:`,
      container.textContent?.length || 0
    );
    console.log(
      `Container ${i} visibility:`,
      window.getComputedStyle(container).visibility,
      window.getComputedStyle(container).display
    );
  });

  const styleSheets = document.styleSheets;
  let hidingRules = [];

  try {
    for (let i = 0; i < styleSheets.length; i++) {
      const rules = styleSheets[i].cssRules || styleSheets[i].rules;
      if (!rules) continue;

      for (let j = 0; j < rules.length; j++) {
        const rule = rules[j];
        if (
          rule.selectorText &&
          (rule.selectorText.includes(".assistant-message") ||
            rule.selectorText.includes(".message"))
        ) {
          if (
            rule.style.display === "none" ||
            rule.style.visibility === "hidden" ||
            rule.style.opacity === "0"
          ) {
            hidingRules.push(rule.selectorText);
          }
        }
      }
    }
  } catch (e) {
    console.log("Error checking CSS rules:", e);
  }

  console.log("CSS rules that might hide content:", hidingRules);

  return "Debug info logged to console";
};
