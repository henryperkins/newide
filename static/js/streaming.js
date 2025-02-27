// streaming.js - Centralized SSE-based streaming logic

import { safeMarkdownParse } from '/static/js/ui/markdownParser.js';
import { removeTypingIndicator } from '/static/js/ui/notificationManager.js';
import { displayMessage } from '/static/js/ui/displayManager.js';
import { updateTokenUsage } from '/static/js/ui/displayManager.js'; // or from your helpers if you prefer

/**
 * Buffers used for streaming partial results
 */
let mainTextBuffer = '';
let reasoningBuffer = '';
let isThinking = false;
let mainContainer = null;
let reasoningContainer = null;

/**
 * Handles SSE streaming when a model supports streaming responses.
 * If streaming is toggled on, we parse partial chunks
 * and display them incrementally in the UI.
 * 
 * @param {Response} response - The fetch response object from an /chat/completions endpoint
 * @param {AbortController} controller - The abort controller in case we want to cancel the stream
 * @param {object} config - The current user config (model settings, etc.)
 * @param {object} statsDisplay - Your StatsDisplay instance (optional)
 */
export async function handleStreamingResponse(response, controller, config, statsDisplay) {
  console.log('[streaming.js] Starting SSE streaming...');

  const modelName = (config?.selectedModel || '').toLowerCase();
  const showReasoning = modelName.includes('deepseek');  // Only declare once
  
  // Only show reasoning for DeepSeek models that have <think> tags
  // (Comment explaining why we check for deepseek models)
    
  // Verify the model actually supports streaming
  const supportsStreaming = config?.models?.[modelName]?.supports_streaming || 
                            modelName.includes('deepseek'); // DeepSeek-R1 supports streaming
  
  if (!supportsStreaming) {
    console.warn(`Model ${modelName} doesn't support streaming. Falling back to non-streaming mode.`);
    // Fall back to non-streaming mode
    const data = await response.json();
    if (typeof processServerResponseData === 'function') {
      processServerResponseData(data, modelName);
    } else {
      // Simple fallback if processServerResponseData isn't available
      if (data.choices && data.choices.length > 0) {
        displayMessage(data.choices[0].message.content, 'assistant');
      }
    }
    return;
  }

  // Reset buffers/state
  mainTextBuffer = '';
  reasoningBuffer = '';
  isThinking = false;
  mainContainer = null;
  reasoningContainer = null;

  // Build SSE endpoint from the initial response's URL
  const streamUrl = response.url.replace('/chat/completions', '/chat/stream');
  console.log('[streaming.js] SSE endpoint:', streamUrl);

  // Prepare request body from original response
  let streamBody;
  try {
    // Try to get the original request body
    const originalBody = JSON.parse(response.config?.data || '{}');
    streamBody = JSON.stringify({
      message: originalBody.messages?.find(m => m.role === 'user')?.content || '',
      session_id: originalBody.session_id,
      model: originalBody.model,
      reasoning_effort: originalBody.reasoning_effort || 'medium'
    });
  } catch (err) {
    console.warn('[streaming.js] Could not parse original request body:', err);
    streamBody = JSON.stringify({
      message: "Continue our conversation",
      session_id: config.sessionId
    });
  }

  const eventSource = new EventSource(streamUrl);
  const streamStart = Date.now();
  let tokenCount = 0;
  const streamingCounterEl = document.getElementById('streaming-token-count');
  if (streamingCounterEl) streamingCounterEl.textContent = '0';

  eventSource.onmessage = (event) => {
    try {
      const responseData = JSON.parse(event.data);

      // If the backend sends an explicit error
      if (responseData.error) {
        displayMessage(`Error: ${responseData.error}`, 'error');
        eventSource.close();
        return;
      }

      // If final chunk => finish_reason==="stop"
      if (
        responseData.choices &&
        responseData.choices[0]?.finish_reason === 'stop'
      ) {
        finalizeStreamingResponse(JSON.stringify(responseData), mainContainer);
        eventSource.close();
        return;
      }

      // If partial chunk content
      if (responseData.choices && responseData.choices[0]?.delta?.content) {
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
            mainContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
        }
      }

      // If the SSE response includes a top-level "content" for stats usage
      if (responseData.content && statsDisplay && statsDisplay.updateStats) {
        tokenCount += countTokensInChunk(responseData.content);

        // Add partial chunk info to stats
        statsDisplay.updateStats({
          chunkCount: (statsDisplay.stats.chunkCount || 0) + 1,
          partialTokens: tokenCount
        });

        // Display partial tokenCount if element found
        if (streamingCounterEl) {
          streamingCounterEl.textContent = tokenCount.toString();
        }

        const elapsed = Date.now() - streamStart;
        statsDisplay.updateStats({
          latency: elapsed,
          tokensPerSecond: tokenCount / (elapsed / 1000),
          totalTokens: tokenCount
        });
      }
    } catch (err) {
      console.error('[streaming.js] SSE parsing error:', err);
      eventSource.close();
      removeTypingIndicator();
    }
  };

  eventSource.onerror = (err) => {
    console.error('[streaming.js] SSE failed:', err);
    eventSource.close();
    removeTypingIndicator();
  };
}

/**
 * Called once the finish_reason is "stop" or the SSE stream ends.
 */
export function finalizeStreamingResponse(content, container) {
  if (!container) return;

  container.classList.remove('streaming');
  try {
    // Attempt to parse the final chunk to retrieve usage
    const parsed = JSON.parse(content);
    if (parsed.usage) {
      updateTokenUsage(parsed.usage);
    }
  } catch (error) {
    console.warn('[streaming.js] Could not parse streaming usage data:', error);
  }

  addCopyButton(container, content);
}

/* ---------- Container creation ---------- */

function ensureMainContainer() {
  if (!mainContainer) {
    mainContainer = createMessageContainer('assistant streaming');
  }
}

function ensureReasoningContainer() {
  if (!reasoningContainer) {
    reasoningContainer = createMessageContainer('assistant-thinking streaming');
  }
}

function createMessageContainer(classes = '') {
  const container = document.createElement('div');
  container.className = `message ${classes}`;
  const chatHistory = document.getElementById('chat-history');
  if (chatHistory) {
    chatHistory.appendChild(container);
  }
  return container;
}

/* ---------- Real-time chain-of-thought parsing ---------- */

function parseChunkForReasoning(text) {
  // Create the buffers if they don't exist
  if (typeof mainTextBuffer === 'undefined') {
    mainTextBuffer = '';
  }
  if (typeof reasoningBuffer === 'undefined') {
    reasoningBuffer = '';
  }
  if (typeof isThinking === 'undefined') {
    isThinking = false;
  }

  // Process the text chunk
  while (text) {
    if (!isThinking) {
      const thinkStart = text.indexOf('<think>');
      if (thinkStart === -1) {
        // No thinking tag, just regular text
        mainTextBuffer += text;
        text = '';
        if (mainContainer) {
          mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
          mainContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      } else {
        // Found opening thinking tag
        mainTextBuffer += text.slice(0, thinkStart);
        if (mainContainer) {
          mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
          mainContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        text = text.slice(thinkStart + '<think>'.length);
        isThinking = true;
        ensureReasoningContainer();
      }
    } else {
      const thinkEnd = text.indexOf('</think>');
      if (thinkEnd === -1) {
        // Still in thinking mode but no closing tag yet
        reasoningBuffer += text;
        text = '';
        if (reasoningContainer) {
          // Apply custom styling for reasoning container
          reasoningContainer.innerHTML = `
            <div class="thinking-process">
              <div class="thinking-header">
                <button class="thinking-toggle" aria-expanded="true">
                  <span class="toggle-icon">▼</span> DeepSeek-R1 Reasoning
                </button>
              </div>
              <div class="thinking-content">
                <pre class="thinking-pre">${reasoningBuffer}</pre>
              </div>
            </div>
          `;
          reasoningContainer.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
          });
        }
      } else {
        // Found closing thinking tag
        reasoningBuffer += text.slice(0, thinkEnd);
        if (reasoningContainer) {
          // Apply custom styling for reasoning container
          reasoningContainer.innerHTML = `
            <div class="thinking-process">
              <div class="thinking-header">
                <button class="thinking-toggle" aria-expanded="true">
                  <span class="toggle-icon">▼</span> DeepSeek-R1 Reasoning
                </button>
              </div>
              <div class="thinking-content">
                <pre class="thinking-pre">${reasoningBuffer}</pre>
              </div>
            </div>
          `;
          reasoningContainer.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
          });
        }
        text = text.slice(thinkEnd + '</think>'.length);
        isThinking = false;
      }
    }
  }
}

function updateContainers() {
  if (mainContainer) {
    mainContainer.innerHTML = safeMarkdownParse(mainTextBuffer);
    mainContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
  if (reasoningContainer) {
    reasoningContainer.innerHTML = `
      <div class="thinking-process">
        <div class="thinking-header">
          <button class="thinking-toggle" aria-expanded="true">
            <span class="toggle-icon">▼</span> DeepSeek-R1 Reasoning
          </button>
        </div>
        <div class="thinking-content">
          <pre class="thinking-pre">${reasoningBuffer}</pre>
        </div>
      </div>
    `;
    reasoningContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}

/* ---------- Helpers ---------- */

function addCopyButton(container, content) {
  const button = document.createElement('button');
  button.className = 'copy-button';
  button.innerHTML = '📋';
  button.title = 'Copy to clipboard';
  button.onclick = () => navigator.clipboard.writeText(content);
  container.prepend(button);
}

/**
 * Very rough token count for chunk stats
 */
function countTokensInChunk(chunk) {
  return chunk.split(/\s+/).length;
}
