/* 
 * streaming.js - Updated for DeepSeek-R1 chain-of-thought streaming
 *  - Enhanced logging, error handling, and Sentry instrumentation for SSE.
 */

import { getSessionId, refreshSession } from "./session.js";
import {
  updateTokenUsage,
  fetchWithRetry,
  retry,
  eventBus,
} from "./utils/helpers.js";
import {
  showNotification,
  handleMessageError,
  showTypingIndicator
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
import { renderMarkdown, highlightCode } from "./ui/markdownParser.js";

/* ------------------------------------------------------------------
   Global State
   ------------------------------------------------------------------ */
let mainTextBuffer = "";
let thinkingTextBuffer = "";
let rollingBuffer = "";  // SSE partial data buffer
let messageContainer = null;
let isThinking = false;
let lastRenderTimestamp = 0;
let animationFrameId = null;
let errorState = false;
let connectionTimeoutId = null;
let connectionCheckIntervalId = null;
let streamStartTime = 0;
let tokenCount = 0;

let currentMessageId = null;
let thinkingContainers = {};

const RENDER_INTERVAL_MS = 150;
const SCROLL_INTERVAL_MS = 500;
const BASE_CONNECTION_TIMEOUT_MS = 60000;
const MAX_CONNECTION_TIMEOUT_MS = 180000;
const MAX_RETRY_ATTEMPTS = 3;
const CONNECTION_CHECK_INTERVAL_MS = 5000;

/* ------------------------------------------------------------------
   Utility: Calculate tokens/sec
   ------------------------------------------------------------------ */
function calculateTokensPerSecond(usage) {
  if (!usage || !streamStartTime) return 0;
  const elapsedMs = performance.now() - streamStartTime;
  if (elapsedMs <= 0) return 0;
  const totalTokens = usage.completion_tokens || 0;
  return Math.min((totalTokens / elapsedMs) * 1000, 1000);
}

/* ------------------------------------------------------------------
   Utility: Dynamically determine SSE timeouts
   ------------------------------------------------------------------ */
function calculateConnectionTimeout(modelName, messageLength) {
  let timeout = BASE_CONNECTION_TIMEOUT_MS;
  const name = (modelName || "").toLowerCase();

  if (name.includes("o1") || name.includes("o3")) {
    timeout *= 2.5;
  } else if (name.includes("claude")) {
    timeout *= 2.0;
  } else if (name.includes("deepseek")) {
    timeout *= 2.0;
  }

  // Increase timeout based on prompt length
  if (messageLength > 1000) {
    const lengthFactor = 1 + messageLength / 10000;
    timeout *= lengthFactor;
  }
  return Math.min(timeout, MAX_CONNECTION_TIMEOUT_MS);
}

/* ------------------------------------------------------------------
   Reset streaming state
   ------------------------------------------------------------------ */
function resetStreamingState() {
  mainTextBuffer = "";
  thinkingTextBuffer = "";
  rollingBuffer = "";
  messageContainer = null;
  isThinking = false;
  lastRenderTimestamp = 0;
  errorState = false;
  streamStartTime = 0;
  tokenCount = 0;

  currentMessageId = Date.now().toString();
  thinkingContainers = {};

  // Remove data-streaming from any leftover containers
  document
    .querySelectorAll('[data-streaming="true"]')
    .forEach(el => el.removeAttribute("data-streaming"));

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

/* ------------------------------------------------------------------
   streamChatResponse
   ------------------------------------------------------------------ */
function streamChatResponse(
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
  showTypingIndicator();

  let sentryTransaction; // Reference for the Sentry transaction

  // Dynamically import Sentry to start a transaction
  import("./sentryInit.js")
    .then((sentry) => {
      sentryTransaction = sentry.startTransaction(
        "streamChatResponse",
        "streaming",
        {
          model_name: modelName,
          has_files: fileIds?.length > 0,
          use_file_search: useFileSearch,
        }
      );
      sentry.addBreadcrumb({
        category: "streaming",
        message: "Starting chat response streaming",
        level: "info",
        data: {
          session_id: sessionId,
          model: modelName,
          message_length: messageContent?.length || 0,
          file_count: fileIds?.length || 0
        },
      });
    })
    .catch((err) => console.error("Failed to load sentryInit for transaction:", err));

  messageContainer = ensureMessageContainer();

  return new Promise(async (resolve, reject) => {
    if (!sessionId) {
      import("./sentryInit.js").then((sentry) => {
        sentry.captureError(new Error("No valid sessionId for streaming"), {
          context: "streaming.js",
          tags: { streaming_stage: "initialization" },
        });
        if (sentryTransaction) sentryTransaction.finish();
      });
      reject(new Error("No valid sessionId for streaming."));
      return;
    }

    // Add a no-response timeout handler for initial SSE handshake
    const noResponseTimer = setTimeout(() => {
      console.warn("[streaming] Model taking too long to respond (no data).");

      if (sentryTransaction) {
        sentryTransaction.setData("result", "no_response_timeout");
        sentryTransaction.setStatus("deadline_exceeded");
      }

      if (messageContainer) {
        const statusDiv = document.createElement("div");
        statusDiv.className =
          "p-2 mb-2 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 rounded";
        statusDiv.innerHTML =
          "<strong>Model taking longer than expected</strong><br>This may be due to high server load or an issue with the model.";
        messageContainer.appendChild(statusDiv);

        showNotification("Switching to non-streaming mode due to timeout", "warning");

        import("./chat.js")
          .then((chatModule) => {
            chatModule
              .fetchChatResponse(messageContent, sessionId, modelName, reasoningEffort)
              .then((response) => {
                if (response?.choices?.[0]?.message?.content) {
                  statusDiv.remove();
                  const assistantMessage = response.choices[0].message.content;
                  chatModule.renderAssistantMessage(assistantMessage);

                  if (response.usage) {
                    updateTokenUsage(response.usage);
                  }
                  if (sentryTransaction) {
                    sentryTransaction.setData("result", "fallback_success");
                    sentryTransaction.setStatus("ok");
                    sentryTransaction.finish();
                  }
                  resolve(true);
                } else {
                  if (sentryTransaction) {
                    sentryTransaction.setData("result", "fallback_failed");
                    sentryTransaction.setStatus("internal_error");
                    sentryTransaction.finish();
                  }
                  reject(new Error("Failed to get response from fallback method"));
                }
              })
              .catch((err) => {
                if (sentryTransaction) {
                  sentryTransaction.captureError(err, { context: "fallbackFetch" });
                  sentryTransaction.setData("result", "fallback_error");
                  sentryTransaction.setStatus("internal_error");
                  sentryTransaction.finish();
                }
                reject(err);
              });
          })
          .catch((err) => {
            if (sentryTransaction) {
              sentryTransaction.captureError(err, { context: "dynamicImportChat" });
              sentryTransaction.setData("result", "chat_module_import_error");
              sentryTransaction.setStatus("internal_error");
              sentryTransaction.finish();
            }
            reject(err);
          });
      }
    }, 30000); // 30 second handshake timeout

    const modelId = (modelName || "DeepSeek-R1").toLowerCase();
    if (!modelId) {
      if (sentryTransaction) {
        sentryTransaction.setStatus("invalid_argument");
      }
      reject(new Error("Invalid model name"));
      return;
    }

    const params = new URLSearchParams();
    let finalModelName = modelName;

    if (finalModelName.trim().toLowerCase() === "deepseek-r1") {
      finalModelName = "DeepSeek-R1";
      params.append("temperature", "0.5");
    }
    params.append("model", finalModelName);
    params.append("message", messageContent || "");

    if (modelId.includes("o1") || modelId.includes("o3")) {
      params.append("reasoning_effort", reasoningEffort);
      params.append("response_format", "json_schema");
      params.append("max_completion_tokens", "100000");
    } else if (reasoningEffort && !modelId.includes("deepseek")) {
      params.append("reasoning_effort", reasoningEffort);
    }

    if (fileIds?.length) {
      params.append("include_files", "true");
      fileIds.forEach(fid => params.append("file_ids", fid));
      if (useFileSearch) {
        params.append("use_file_search", "true");
      }
    }

    const apiUrl = `${window.location.origin}/api/chat/sse`;
    const fullUrl = apiUrl + "?" + params.toString();

    try {
      if (!signal) {
        const controller = new AbortController();
        signal = controller.signal;
        window.currentController = controller; // attach for debug
      }

      const headers = {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId
      };
      if (modelId.includes("deepseek")) {
        headers["x-ms-thinking-format"] = "html";
        headers["x-ms-streaming-version"] = "2024-05-01-preview";
      }

      try {
        await refreshSession(sessionId);
      } catch (refreshErr) {
        console.warn("[streamChatResponse] Failed to refresh session:", refreshErr);
      }

      console.log("[streaming] Connecting to SSE endpoint:", fullUrl);
      console.log("[streaming] With headers:", headers);

      const response = await fetch(fullUrl, {
        headers,
        signal,
        cache: "no-cache"
      });

      // We got some response from server, so cancel noResponseTimer
      clearTimeout(noResponseTimer);

      console.log("[streaming] SSE response status:", response.status);

      if (!response.ok || !response.body) {
        let errorDetail = `HTTP error: ${response.status}`;
        try {
          const errorText = await response.text();
          errorDetail += ` - ${errorText}`;
          console.error("[streaming] SSE error response body:", errorText);
        } catch (err) {
          console.error("[streaming] Couldn't read error text:", err);
        }

        if (sentryTransaction) {
          sentryTransaction.setData("status", response.status);
          sentryTransaction.setStatus("internal_error");
        }
        throw new Error(errorDetail);
      }

      console.log("[streaming] SSE connection established");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let isStreamActive = true;

      const connectionTimeoutMs = calculateConnectionTimeout(modelId, messageContent.length);
      connectionTimeoutId = setTimeout(() => {
        if (isStreamActive) {
          console.warn(`[streaming] Connection timed out after ${connectionTimeoutMs}ms`);
          isStreamActive = false;
          handleStreamingError(new Error("Connection timeout"));
          reader.cancel();
        }
      }, connectionTimeoutMs);

      connectionCheckIntervalId = setInterval(() => {
        if (!isStreamActive) {
          clearInterval(connectionCheckIntervalId);
        }
      }, CONNECTION_CHECK_INTERVAL_MS);

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", () => {
          clearTimeout(connectionTimeoutId);
          clearInterval(connectionCheckIntervalId);
          isStreamActive = false;
          reader.cancel();
          console.log("[streaming] SSE stream aborted via signal");

          if (sentryTransaction) {
            sentryTransaction.setStatus("cancelled");
            sentryTransaction.finish();
          }
        }, { once: true });
      }

      // SSE read loop
      const readLoop = async () => {
        try {
          console.log("[streaming] Starting read loop");
          const { value, done } = await reader.read();
          if (done) {
            console.log("[streaming] Stream complete (done=true)");
            isStreamActive = false;
            finalizeAndResolve();
            return;
          }
          const text = decoder.decode(value);
          console.log("[streaming] Received chunk:", text.substring(0, 50) + (text.length > 50 ? '...' : ''));
          processRawChunk(text);

          readLoop();
        } catch (err) {
          console.error("[streaming] Error in read loop:", err);
          if (err.name === "AbortError") {
            console.log("[streaming] Stream aborted by user");
          } else {
            console.error("[streaming] Full error details:", {
              name: err.name,
              message: err.message,
              stack: err.stack,
              status: err.status
            });
          }
          isStreamActive = false;
          if (!errorState) {
            handleStreamingError(err);
          }
        }
      };

      // Start reading
      readLoop();

      function finalizeAndResolve() {
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);

        if (rollingBuffer) {
          processRawChunk("");
        }

        const finalizeResult = deepSeekProcessor.finalizeChainOfThought(
          mainTextBuffer,
          thinkingTextBuffer,
          isThinking
        );
        mainTextBuffer = finalizeResult.mainContent;
        thinkingTextBuffer = finalizeResult.thinkingContent;
        isThinking = false;

        if (messageContainer) {
          const block = messageContainer.querySelector(".deepseek-cot-block");
          if (block) {
            const icon = block.querySelector(".thought-icon");
            if (icon) {
              icon.classList.remove("thinking");
              icon.classList.add("complete");
            }
          }
        }

        forceRender();

        // Mark transaction success if still open
        import("./sentryInit.js").then((sentry) => {
          if (sentryTransaction) {
            sentryTransaction.setStatus("ok");
            sentryTransaction.setData("result", "stream_completed");
          }
        });

        cleanupStreaming(finalModelName)
          .then(() => {
            // Finally, finish the Sentry transaction
            import("./sentryInit.js").then((sentry) => {
              if (sentryTransaction) {
                // Optionally record tokens usage or durations
                sentryTransaction.setData("completion_tokens", tokenCount);
                sentryTransaction.finish();
              }
            });
            resolve(true);
          })
          .catch((err) => {
            if (sentryTransaction) {
              sentryTransaction.captureError(err, { context: "cleanupStreaming" });
              sentryTransaction.setData("result", "cleanup_error");
              sentryTransaction.setStatus("internal_error");
              sentryTransaction.finish();
            }
            reject(err);
          });
      }
    } catch (error) {
      console.error("[streaming] Caught top-level error:", error);

      import("./sentryInit.js").then((sentry) => {
        sentry.addBreadcrumb({
          category: "streaming.error",
          message: `Top-level error: ${error.message}`,
          level: "error",
        });
        sentry.captureError(error, { context: "streamChatResponse" });
        if (sentryTransaction) {
          sentryTransaction.setData("result", "top_level_error");
          sentryTransaction.setStatus("internal_error");
          sentryTransaction.finish();
        }
      });

      handleStreamingError(error);
      reject(error);
    }
  });
}

/* ------------------------------------------------------------------
   processRawChunk: merges SSE text into rollingBuffer, splits by double newlines,
   extracts JSON, calls parseChainOfThought
   ------------------------------------------------------------------ */
function processRawChunk(newText) {
  rollingBuffer += newText;

  // SSE messages separated by double newlines
  const segments = rollingBuffer.split("\n\n");
  rollingBuffer = segments.pop() || "";

  for (let seg of segments) {
    seg = seg.trim();
    if (!seg.startsWith("data:")) continue;

    const dataPart = seg.slice(5).trim();
    if (dataPart === "done") continue;

    try {
      const parsed = JSON.parse(dataPart);
      handleDataChunk(parsed);
    } catch (err) {
      console.error("[streaming] Failed to parse SSE chunk:", err, seg);

      import("./sentryInit.js").then((sentry) => {
        sentry.addBreadcrumb({
          category: "streaming.error",
          message: `Failed to parse SSE chunk: ${err.message}`,
          level: "error",
          data: { chunkSnippet: seg.substring(0, 100) },
        });
      });
    }
  }

  // Start "thinking" animation if not already
  if (messageContainer) {
    const block = messageContainer.querySelector(".deepseek-cot-block");
    if (block) {
      const icon = block.querySelector(".thought-icon");
      if (icon) {
        icon.classList.remove("complete");
        icon.classList.add("thinking");
      }
    }
  }

  scheduleRender();
}

/* ------------------------------------------------------------------
   handleDataChunk: parse SSE data content
   ------------------------------------------------------------------ */
function handleDataChunk(data) {
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
  }

  let newText = "";
  if (typeof data.text === "string") {
    newText = data.text;
  } else if (
    data.choices &&
    data.choices[0] &&
    data.choices[0].delta &&
    data.choices[0].delta.content
  ) {
    newText = data.choices[0].delta.content;
  }

  if (!newText) return;

  const parseResult = deepSeekProcessor.parseChainOfThought(
    newText,
    mainTextBuffer,
    thinkingTextBuffer,
    isThinking
  );
  mainTextBuffer = parseResult.mainText;
  thinkingTextBuffer = parseResult.thinkingText;
  isThinking = parseResult.isThinking;
}

/* ------------------------------------------------------------------
   Rendering logic
   ------------------------------------------------------------------ */
function scheduleRender() {
  // Cancel any pending render to avoid duplicate renders
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (shouldRenderNow(lastRenderTimestamp, RENDER_INTERVAL_MS)) {
    // Immediate render if enough time has passed
    animationFrameId = requestAnimationFrame(() => {
      renderBufferedContent();
      lastRenderTimestamp = Date.now();
      animationFrameId = null;
    });
  } else {
    // Otherwise, schedule for later
    setTimeout(() => {
      if (!animationFrameId) { // Only schedule if no render is pending
        animationFrameId = requestAnimationFrame(() => {
          renderBufferedContent();
          lastRenderTimestamp = Date.now();
          animationFrameId = null;
        });
      }
    }, RENDER_INTERVAL_MS - (Date.now() - lastRenderTimestamp));
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
    if (!messageContainer) {
      messageContainer = ensureMessageContainer();
    }
    if (!messageContainer) return;

    // First time setup - create the container structure
    if (!messageContainer.querySelector(".message-content")) {
      messageContainer.innerHTML = "";
      messageContainer.setAttribute("data-streaming", "true");
      
      // Create initial container structure
      const messageContentContainer = document.createElement("div");
      messageContentContainer.className = "message-content";
      messageContainer.appendChild(messageContentContainer);
      
      // Create containers (even if empty) to maintain stable structure
      const thinkingContainer = document.createElement("div");
      thinkingContainer.className = "thinking-container";
      messageContentContainer.appendChild(thinkingContainer);
      
      const responseContentDiv = document.createElement("div");
      responseContentDiv.className = "response-content";
      messageContentContainer.appendChild(responseContentDiv);
    }
    
    // Get references to existing containers
    const messageContentContainer = messageContainer.querySelector(".message-content");
    const thinkingContainer = messageContentContainer.querySelector(".thinking-container");
    const responseContentDiv = messageContentContainer.querySelector(".response-content");
    
    // Update thinking content if needed (without replacing the entire container)
    if (thinkingTextBuffer && thinkingTextBuffer.trim()) {
      // Update existing thinking block or create a new one
      deepSeekProcessor.renderThinkingContainer(
        thinkingContainer,
        thinkingTextBuffer,
        { createNew: !thinkingContainer.querySelector(".deepseek-cot-block"), isComplete: !rollingBuffer && !isThinking }
      );
      
      // Make sure thinking container is visible
      thinkingContainer.style.display = "block";
    } else {
      // Hide thinking container if no content
      thinkingContainer.style.display = "none";
    }

    // Render the main content with minimal DOM changes
    let cleaned = renderMarkdown(mainTextBuffer.trim());
    renderContentEfficiently(responseContentDiv, cleaned, { scroll: true });
    
    // Highlight code blocks if needed
    highlightCode(responseContentDiv);
  } catch (err) {
    console.error("[renderBufferedContent] Error:", err);

    import("./sentryInit.js").then((sentry) => {
      sentry.captureError(err, { context: "renderBufferedContent" });
    });
  }
}

/* ------------------------------------------------------------------
   handleStreamingError
   ------------------------------------------------------------------ */
function handleStreamingError(error) {
  console.error("[handleStreamingError]", error);
  if (!errorState) {
    errorState = true;
    forceRender();

    if (messageContainer) {
      const errBlock = document.createElement("div");
      errBlock.className =
        "streaming-error-note text-sm text-red-600 dark:text-red-400 mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded";
      errBlock.textContent =
        "⚠️ The response was interrupted and is incomplete.";
      messageContainer.appendChild(errBlock);
    }

    import("./sentryInit.js").then((sentry) => {
      sentry.captureError(error, {
        context: "handleStreamingError",
        tags: { error_stage: "streaming" },
      });
      sentry.addBreadcrumb({
        category: "streaming.error",
        message: `handleStreamingError triggered: ${error.message}`,
        level: "error",
      });
    });

    utilsHandleStreamingError(error, showNotification, messageContainer);
    removeStreamingProgressIndicator();
    eventBus.publish("streamingError", {
      error,
      recoverable: false,
      modelName: document.getElementById("model-select")?.value || null,
    });
  }
}

/* ------------------------------------------------------------------
   cleanupStreaming - called when the SSE completes or errors out
   ------------------------------------------------------------------ */
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
      messageContainer.removeAttribute("data-streaming");
      const block = messageContainer.querySelector(".deepseek-cot-block");
      if (block) {
        block.removeAttribute("data-streaming");
      }
      finalizeStreamingContainer(messageContainer);
    }
  } catch (err) {
    console.error("[cleanupStreaming] Error:", err);
  } finally {
    document.querySelectorAll(".typing-indicator").forEach((el) => el.remove());
    document.querySelectorAll(".streaming-progress").forEach((el) => el.remove());
  }

  if (messageContainer) {
    try {
      const sessionId = await getSessionId();
      if (!sessionId) {
        console.error("No valid session ID to store message");
        return;
      }

      // Refresh session
      try {
        await refreshSession(sessionId);
      } catch (refreshErr) {
        console.warn("[cleanupStreaming] Failed to refresh session:", refreshErr);
      }

      let finalContent = mainTextBuffer.trim() || "";
      if (thinkingTextBuffer.trim()) {
        finalContent += `\n\n<think>${thinkingTextBuffer.trim()}</think>`;
      }

      console.log(`[cleanupStreaming] Storing final content length: ${finalContent.length}`);

      if (!finalContent.trim()) {
        console.warn("[cleanupStreaming] SSE returned no content, skipping store.");
        return;
      }

      await fetchWithRetry(
        window.location.origin + `/api/chat/conversations/${sessionId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Content-Length": String(finalContent.length),
            "X-Session-ID": sessionId,
          },
          body: JSON.stringify({
            role: "assistant",
            content: finalContent,
            model: modelName || "DeepSeek-R1",
          }),
          timeout: Math.max(30000, finalContent.length / 100),
        }
      ).catch((err) => console.warn("Failed to store message:", err));
    } catch (storeErr) {
      console.warn("Error storing final content:", storeErr);
      import("./sentryInit.js").then((sentry) => {
        sentry.captureError(storeErr, { context: "cleanupStreamingStore" });
      });
    }
  }
}

export { streamChatResponse };
