// streaming.js - Extracted SSE-based streaming logic from main.js

import { safeMarkdownParse } from "/static/js/ui/markdownParser.js";
import { removeTypingIndicator } from "/static/js/ui/notificationManager.js";
import { displayMessage } from "/static/js/ui/displayManager.js";
import { updateTokenUsage } from "/static/js/utils/helpers.js";

/**
 * Buffers used for streaming partial results
 */
let mainTextBuffer = "";
let reasoningBuffer = "";
let isThinking = false;
let mainContainer = null;
let reasoningContainer = null;

/**
 * Handles SSE streaming when a model supports streaming responses.
 * If the user has toggled streaming on, we parse partial chunks
 * and display them incrementally in the UI.
 */
export async function handleStreamingResponse(response, controller, config, modelConfig, statsDisplay) {
  console.log("[streaming.js] Starting SSE streaming...");

  const slug = (config?.selectedModel || "").toLowerCase();
  const showReasoning = slug.includes("deepseek-r1"); // We only do real-time reasoning parse for DeepSeek-R1

  // Always use the deployment name from config.
  const deploymentName = config.deploymentName;
  if (!deploymentName) {
    console.error("[streaming.js] No valid deployment name found in config:", config);
    throw new Error("No valid deployment name found in configuration.");
  }

  // Build the SSE endpoint from the existing chat completions endpoint:
  const streamUrl = response.url.replace("/chat/completions", "/chat/completions/stream");
  console.log("[streaming.js] SSE endpoint:", streamUrl);

  mainTextBuffer = "";
  reasoningBuffer = "";
  isThinking = false;
  mainContainer = null;
  reasoningContainer = null;

  const eventSource = new EventSource(streamUrl);
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

      // If final chunk
      if (responseData.choices && responseData.choices[0].finish_reason === "stop") {
        finalizeStreamingResponse(JSON.stringify(responseData), mainContainer);
        eventSource.close();
        return;
      }

      // If chunk has actual content
      if (responseData.choices && responseData.choices[0].delta?.content) {
        const chunk = responseData.choices[0].delta.content;

        if (showReasoning) {
          // DeepSeek-R1 => parse <think> in real time
          ensureMainContainer();
          parseChunkForReasoning(chunk);
          updateContainers();
        } else {
          // Another streaming model => just append text to main container
          ensureMainContainer();
          mainTextBuffer += chunk;
          if (mainContainer) {
            mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
            mainContainer.scrollIntoView({ behavior: "smooth", block: "end" });
          }
        }
      }

      // Update stats if "content" is present
      if (responseData.content && statsDisplay && statsDisplay.updateStats) {
        tokenCount += countTokensInChunk(responseData.content);
        const elapsed = Date.now() - streamStart;
        statsDisplay.updateStats({
          latency: elapsed,
          tokensPerSecond: tokenCount / (elapsed / 1000),
          totalTokens: tokenCount
        });
      }
    } catch (err) {
      console.error("[streaming.js] SSE parsing error:", err);
      eventSource.close();
      removeTypingIndicator();
    }
  };

  eventSource.onerror = (err) => {
    console.error("[streaming.js] SSE failed:", err);
    eventSource.close();
    removeTypingIndicator();
  };
}

/**
 * Create container for streaming messages.
 */
function createMessageContainer(classes = "") {
  const container = document.createElement("div");
  container.className = `message ${classes}`;
  const chatHistory = document.getElementById("chat-history");
  if (chatHistory) {
    chatHistory.appendChild(container);
  }
  return container;
}

/**
 * Ensure main container for streaming text.
 */
function ensureMainContainer() {
  if (!mainContainer) {
    mainContainer = createMessageContainer("assistant streaming");
  }
}

/**
 * Ensure separate container for reasoning text (e.g. <think> blocks).
 */
function ensureReasoningContainer() {
  if (!reasoningContainer) {
    reasoningContainer = createMessageContainer("assistant-thinking streaming");
  }
}

/**
 * Parse partial chunk text for <think> blocks vs. normal text.
 */
function parseChunkForReasoning(text) {
  while (text) {
    if (!isThinking) {
      const thinkStart = text.indexOf("<think>");
      if (thinkStart === -1) {
        mainTextBuffer += text;
        text = "";
        if (mainContainer) {
          mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
          mainContainer.scrollIntoView({ behavior: "smooth", block: "end" });
        }
      } else {
        // Everything before <think> is normal text
        mainTextBuffer += text.slice(0, thinkStart);
        if (mainContainer) {
          mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
          mainContainer.scrollIntoView({ behavior: "smooth", block: "end" });
        }
        text = text.slice(thinkStart + "<think>".length);
        isThinking = true;
        ensureReasoningContainer();
      }
    } else {
      const thinkEnd = text.indexOf("</think>");
      if (thinkEnd === -1) {
        reasoningBuffer += text;
        text = "";
        if (reasoningContainer) {
          reasoningContainer.innerHTML = safeMarkdownParse("## DeepSeek-R1 Reasoning\n\n" + reasoningBuffer);
          reasoningContainer.scrollIntoView({ behavior: "smooth", block: "end" });
        }
      } else {
        reasoningBuffer += text.slice(0, thinkEnd);
        if (reasoningContainer) {
          reasoningContainer.innerHTML = safeMarkdownParse("## DeepSeek-R1 Reasoning\n\n" + reasoningBuffer);
          reasoningContainer.scrollIntoView({ behavior: "smooth", block: "end" });
        }
        text = text.slice(thinkEnd + "</think>".length);
        isThinking = false;
      }
    }
  }
}

/**
 * Re-render the containers after chunk updates.
 */
function updateContainers() {
  if (mainContainer) {
    mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
    mainContainer.scrollIntoView({ behavior: "smooth", block: "end" });
  }
  if (reasoningContainer) {
    const heading = "## DeepSeek-R1 Reasoning\n\n";
    reasoningContainer.innerHTML = safeMarkdownParse(heading + reasoningBuffer);
    reasoningContainer.scrollIntoView({ behavior: "smooth", block: "end" });
  }
}

/**
 * Finalize streaming response once it's done. Called when finish_reason is "stop".
 */
export function finalizeStreamingResponse(content, container) {
  if (!container) return;

  container.classList.remove("streaming");
  try {
    const parsed = JSON.parse(content);
    if (parsed.usage) {
      updateTokenUsage(parsed.usage);
    }
  } catch (error) {
    console.warn("[streaming.js] Could not parse streaming usage data:", error);
  }

  addCopyButton(container, content);
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
 * Basic helper to estimate token count in a partial chunk.
 */
function countTokensInChunk(chunk) {
  return chunk.split(/\s+/).length;
}
