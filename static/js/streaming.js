/* 
 * streaming.js - Updated for DeepSeek-R1 chain-of-thought streaming
 *
 * This version uses "rollingBuffer" to handle partial SSE data,
 * calls deepSeekProcessor.parseChainOfThought() to separate <think> blocks,
 * and merges leftover partial tags across chunk boundaries. 
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
let rollingBuffer = "";  // NEW: For partial chunk data
let messageContainer = null;
let isThinking = false;
let lastRenderTimestamp = 0;
let animationFrameId = null;
let errorState = false;
let connectionTimeoutId = null;
let connectionCheckIntervalId = null;
let streamStartTime = 0;
let tokenCount = 0;

let currentMessageId = null; // for referencing a chain-of-thought container
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
  const tokensPerSecond = (totalTokens / elapsedMs) * 1000;
  return Math.min(tokensPerSecond, 1000); // safe upper limit
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
  
  // Ensure message container exists
  messageContainer = ensureMessageContainer();


  return new Promise(async (resolve, reject) => {
    if (!sessionId) {
      reject(new Error("No valid sessionId for streaming."));
      return;
    }

    const modelId = (modelName || "DeepSeek-R1").toLowerCase();
    if (!modelId) {
      reject(new Error("Invalid model name"));
      return;
    }

    const params = new URLSearchParams();
    let finalModelName = modelName;
    // If user chose "DeepSeek-R1"
    if (finalModelName.trim().toLowerCase() === "deepseek-r1") {
      finalModelName = "DeepSeek-R1"; 
      params.append("temperature", "0.5");
    }
    params.append("model", finalModelName);
    params.append("message", messageContent || "");

    // If O-series
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

    const apiUrl = `${window.location.origin}/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    const fullUrl = apiUrl + "&" + params.toString();

    try {
      const headers = { "Content-Type": "application/json" };
      if (modelId.includes("deepseek")) {
        headers["x-ms-thinking-format"] = "html";
        headers["x-ms-streaming-version"] = "2024-05-01-preview";
      }

      const response = await fetch(fullUrl, { headers, signal });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let isStreamActive = true;

      const connectionTimeoutMs = calculateConnectionTimeout(modelId, messageContent.length);
      connectionTimeoutId = setTimeout(() => {
        if (isStreamActive) {
          console.warn(`Connection timed out after ${connectionTimeoutMs}ms`);
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
        }, { once: true });
      }

      // SSE read loop
      const readLoop = async () => {
        try {
          const { value, done } = await reader.read();
          if (done) {
            isStreamActive = false;
            finalizeAndResolve();
            return;
          }

          const text = decoder.decode(value);
          processRawChunk(text);

          readLoop(); 
        } catch (err) {
          if (err.name !== "AbortError") {
            handleStreamingError(err);
          }
          isStreamActive = false;
        }
      };

      readLoop(); // start reading

      function finalizeAndResolve() {
        clearTimeout(connectionTimeoutId);
        clearInterval(connectionCheckIntervalId);

        // Do a final parse with leftover data
        if (rollingBuffer) {
          processRawChunk(""); // flush leftover
        }

        // If chain-of-thought is still unclosed, handle it
        const finalizeResult = deepSeekProcessor.finalizeChainOfThought(mainTextBuffer, thinkingTextBuffer, isThinking);
        mainTextBuffer = finalizeResult.mainContent;
        thinkingTextBuffer = finalizeResult.thinkingContent;
        isThinking = false;

        // Transition animation to complete state before final render
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

        forceRender(); // final update
        cleanupStreaming(finalModelName)
          .then(() => resolve(true))
          .catch((err) => reject(err));
      }
    } catch (error) {
      handleStreamingError(error);
      reject(error);
    }
  });
}

/* ------------------------------------------------------------------
   processRawChunk: 
   merges new SSE text into rollingBuffer, 
   splits by SSE line, extracts JSON, calls parseChainOfThought
   ------------------------------------------------------------------ */
function processRawChunk(newText) {
  rollingBuffer += newText;

  // SSE messages are separated by double newlines
  const segments = rollingBuffer.split("\n\n");
  rollingBuffer = segments.pop() || "";

  for (let seg of segments) {
    seg = seg.trim();
    if (!seg.startsWith("data:")) {
      continue;
    }
    const dataPart = seg.slice(5).trim(); 
    if (dataPart === "done") {
      continue; 
    }
    try {
      const parsed = JSON.parse(dataPart);
      handleDataChunk(parsed);
    } catch (err) {
      console.error("Failed to parse SSE chunk:", err, seg);
    }
  }

  // If we're starting to get chunks, start the animation
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

/**
 * handleDataChunk:
 *   Convert recognized SSE data to text, feed into parseChainOfThought
 */
function handleDataChunk(data) {
  // Reset connection timeout on each chunk
  clearTimeout(connectionTimeoutId);

  // parse chunk for text
  let newText = "";
  if (typeof data.text === "string") {
    newText = data.text;
  } else if (
    data.choices && data.choices[0] &&
    data.choices[0].delta && data.choices[0].delta.content
  ) {
    newText = data.choices[0].delta.content;
  }
  // Accumulate leftover text in rollingBuffer, parse it
  if (!newText) return;

  // Our simpler approach:
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

/**
 * renderBufferedContent: 
 *   1) ensure we have a container
 *   2) wipe it 
 *   3) render chain-of-thought block if any
 *   4) render main text
 */
function renderBufferedContent() {
  try {
    if (!messageContainer) {
      messageContainer = ensureMessageContainer();
    }
    if (!messageContainer) return;

        messageContainer.innerHTML = "";

        // Set streaming state on message container
        messageContainer.setAttribute('data-streaming', 'true');

        // 1) Chain of Thought - always create container during streaming
        const isFirstRender = !thinkingTextBuffer && !mainTextBuffer;
        const isEndOfStream = !rollingBuffer && !isThinking;
        deepSeekProcessor.renderThinkingContainer(
          messageContainer,
          thinkingTextBuffer,
          { 
            createNew: true,
            isComplete: isFirstRender || isEndOfStream 
          }
        );

    // 2) Main user-visible content
    const contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    messageContainer.appendChild(contentDiv);

    // Optionally markdown parse
    let cleaned = renderMarkdown(mainTextBuffer.trim());

    // Insert content
    renderContentEfficiently(contentDiv, cleaned, { scroll: true });
    highlightCode(contentDiv);

  } catch (err) {
    console.error("[renderBufferedContent] Error:", err);
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

    utilsHandleStreamingError(error, showNotification, messageContainer);
    removeStreamingProgressIndicator();
    eventBus.publish("streamingError", {
      error: error,
      recoverable: false,
      modelName: document.getElementById("model-select")?.value || null,
    });
  }
}

/* ------------------------------------------------------------------
   final cleanup
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
      // Remove streaming state and cleanup transitions
      messageContainer.removeAttribute('data-streaming');
      const block = messageContainer.querySelector('.deepseek-cot-block');
      if (block) {
        block.removeAttribute('data-streaming');
      }
      finalizeStreamingContainer(messageContainer);
    }
  } catch (err) {
    console.error("[cleanupStreaming] Error:", err);
  } finally {
    document.querySelectorAll(".typing-indicator").forEach((el) => el.remove());
    document.querySelectorAll(".streaming-progress").forEach((el) => el.remove());
  }

  // Optionally store final message content
  if (messageContainer) {
    try {
      const conversationId = await getSessionId();
      if (!conversationId) {
        console.error("No valid session ID to store message");
        return;
      }
      let finalContent = mainTextBuffer.trim() || "";

      // If there's chain-of-thought leftover, place it in <think> block
      if (thinkingTextBuffer.trim()) {
        finalContent += `\n\n<think>${thinkingTextBuffer.trim()}</think>`;
      }

      console.log(`[cleanupStreaming] Storing final content length: ${finalContent.length}`);

      // do your POST store
      await fetchWithRetry(
        window.location.origin + `/api/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Content-Length": String(finalContent.length)
          },
          body: JSON.stringify({
            role: "assistant",
            content: finalContent,
            model: modelName || "DeepSeek-R1",
          }),
          timeout: Math.max(30000, finalContent.length / 100)
        }
      ).catch(err => console.warn("Failed to store message:", err));
    } catch (storeErr) {
      console.warn("Error storing final content:", storeErr);
    }
   }
}
export { streamChatResponse };
