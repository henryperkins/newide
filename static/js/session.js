import { updateTokenUsage, fetchWithRetry, retry, eventBus } from './utils/helpers.js';
import { showNotification, handleMessageError, removeTypingIndicator } from './ui/notificationManager.js';
import { processDeepSeekResponse, deepSeekProcessor } from './ui/deepseekProcessor.js';

export async function getSessionId() {
  let sessionId = sessionStorage.getItem("sessionId");
  if (!sessionId) {
    try {
      const response = await fetch("/api/session/create", { method: "POST" });
      if (!response.ok) throw new Error("Failed to create session");
      const data = await response.json();
      sessionId = data.session_id;
      sessionStorage.setItem("sessionId", sessionId);
    } catch (error) {
      console.error("Failed to create session:", error);
      return null;
    }
  }
  return sessionId;
}

export function setLastUserMessage(message) {
  sessionStorage.setItem('lastUserMessage', message);
}

export async function initializeSession() {
  try {
    const response = await fetch('/api/session/create', { method: 'POST' });
    if (!response.ok) throw new Error('Failed to create session');
    const data = await response.json();
    sessionStorage.setItem('sessionId', data.session_id);
    return true;
  } catch (error) {
    console.error('Failed to create session:', error);
    return false;
  }
}

let mainTextBuffer = '';
let thinkingTextBuffer = '';
let messageContainer = null;
let thinkingContainer = null;
let isThinking = false;
let lastRenderTimestamp = 0;
let animationFrameId = null;
let isProcessing = false;
let errorState = false;
let chunkBuffer = '';

const RENDER_INTERVAL_MS = 50;
const CONNECTION_TIMEOUT_MS = 10000;
const MAX_RETRY_ATTEMPTS = 3;

export async function streamChatResponse(
  messageContent,
  sessionId,
  modelName = 'DeepSeek-R1',
  developerConfig = '',
  reasoningEffort = 'medium',
  signal
) {
  resetStreamingState();
  isProcessing = true;
  try {
    if (!sessionId) {
      throw new Error('Invalid sessionId: Session ID is required for streaming');
    }
    const apiUrl = `/api/chat/sse?session_id=${encodeURIComponent(sessionId)}`;
    const params = new URLSearchParams({
      model: modelName || 'DeepSeek-R1',
      message: messageContent || '',
      reasoning_effort: reasoningEffort || 'medium'
    });
    if (developerConfig) params.append('developer_config', developerConfig);
    if (modelName.toLowerCase().includes('deepseek')) {
      params.append('enable_thinking', 'true');
    }
    const fullUrl = `${apiUrl}&${params.toString()}`;
    const eventSource = new EventSource(fullUrl);
    const connectionTimeout = setTimeout(() => {
      if (eventSource && eventSource.readyState === 0) {
        eventSource.close();
        handleStreamingError(Object.assign(new Error('Connection timeout'), {
          name: 'TimeoutError',
          recoverable: true
        }));
      }
    }, CONNECTION_TIMEOUT_MS);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(connectionTimeout);
        eventSource.close();
        handleStreamingError(new Error('Request aborted'));
      });
    }

    let connectionClosed = false;

    eventSource.onopen = () => {
      clearTimeout(connectionTimeout);
      eventBus.publish('streamingStarted', { modelName });
    };

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        processDataChunk(data);
        scheduleRender();
      } catch (err) {
        console.error('[streamChatResponse] Error processing message:', err);
        if (mainTextBuffer || thinkingTextBuffer) forceRender();
      }
    };

    const errorHandler = (e) => {
      clearTimeout(connectionTimeout);
      if (!navigator.onLine) {
        handleStreamingError(Object.assign(new Error('Network offline'), {
          name: 'NetworkError',
          recoverable: true
        }));
        return;
      }
      if (e.data && typeof e.data === 'string') {
        try {
          const errorData = JSON.parse(e.data);
          const errorMessage = errorData.error?.message || errorData.message || errorData.detail || 'Server error';
          handleStreamingError(Object.assign(new Error(errorMessage), {
            name: 'ServerError',
            data: errorData,
            recoverable: true
          }));
        } catch {
          handleStreamingError(new Error(`Server sent invalid response: ${e.data.substring(0, 100)}`));
        }
      } else {
        const err = new Error('Connection error');
        err.name = 'ConnectionError';
        err.readyState = e.target?.readyState;
        err.recoverable = true;
        handleStreamingError(err);
      }
    };

    eventSource.addEventListener('error', errorHandler);

    eventSource.onerror = (e) => {
      clearTimeout(connectionTimeout);
      if (!connectionClosed) {
        connectionClosed = true;
        eventSource.close();
        if (!errorState) {
          errorState = true;
          if (mainTextBuffer || thinkingTextBuffer) {
            forceRender();
          }
          const err = new Error(!navigator.onLine
            ? 'Internet connection lost'
            : (e.status ? `Connection failed with status: ${e.status}` : 'Connection failed'));
          err.name = !navigator.onLine ? 'NetworkError' : 'ConnectionError';
          err.recoverable = true;
          handleMessageError(err);
          if (navigator.onLine) {
            showNotification('Connection failed. Would you like to retry?', 'error', 0, [{
              label: 'Retry',
              onClick: () => attemptErrorRecovery(messageContent, err)
            }]);
          } else {
            window.addEventListener('online', () => {
              showNotification('Connection restored. Retrying...', 'info');
              attemptErrorRecovery(messageContent, err);
            }, { once: true });
          }
        }
      }
      try {
        eventSource.removeEventListener('error', errorHandler);
      } catch (ex) {
        console.warn('[streamChatResponse] Error removing event listener:', ex);
      }
    };

    eventSource.addEventListener('complete', (e) => {
      try {
        if (e.data) {
          const completionData = JSON.parse(e.data);
          if (completionData.usage) updateTokenUsage(completionData.usage);
          eventBus.publish('streamingCompleted', {
            modelName,
            usage: completionData.usage
          });
        }
        forceRender();
        eventSource.close();
      } catch (err) {
        console.error('[streamChatResponse] Error handling completion:', err);
      } finally {
        cleanupStreaming();
      }
    });

    return true;
  } catch (err) {
    console.error('[streamChatResponse] Setup error:', err);
    if (err.message && err.message.includes('Failed to fetch')) {
      err.message = 'Could not connect to API server - network error';
      err.recoverable = true;
    }
    await handleStreamingError(err);
    return false;
  }
}

function processDataChunk(data) {
  if (!data.choices || data.choices.length === 0) return;
  data.choices.forEach(choice => {
    if (choice.delta && choice.delta.content) {
      const text = choice.delta.content;
      chunkBuffer += text;
      const result = deepSeekProcessor.processStreamingChunk(
        chunkBuffer,
        isThinking,
        mainTextBuffer,
        thinkingTextBuffer
      );
      mainTextBuffer = result.mainBuffer;
      thinkingTextBuffer = result.thinkingBuffer;
      isThinking = result.isThinking;
      chunkBuffer = result.remainingChunk;
      if (result.remainingChunk) {
        chunkBuffer = result.remainingChunk;
        processDataChunk({ choices: [{ delta: { content: '' } }] });
      }
      if (isThinking && thinkingTextBuffer) {
        ensureThinkingContainer();
      }
    }
    if (choice.finish_reason) {
      if (chunkBuffer) {
        mainTextBuffer = processDeepSeekResponse(mainTextBuffer + chunkBuffer);
        chunkBuffer = '';
      }
      if (isThinking) {
        finalizeThinkingContainer();
        isThinking = false;
      }
    }
  });
}

function scheduleRender() {
  const now = Date.now();
  if (now - lastRenderTimestamp >= RENDER_INTERVAL_MS) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(() => {
      renderBufferedContent();
      lastRenderTimestamp = now;
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
    if (mainTextBuffer) {
      ensureMessageContainer();
      if (messageContainer) {
        if (window.renderAssistantMessage) {
          window.renderAssistantMessage(mainTextBuffer);
        } else {
          messageContainer.innerHTML = mainTextBuffer;
          messageContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
          deepSeekProcessor.initializeExistingBlocks();
        }
      }
    }
    if (thinkingTextBuffer && thinkingContainer) {
      thinkingContainer.textContent = thinkingTextBuffer;
      thinkingContainer.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  } catch (err) {
    console.error('[renderBufferedContent] Error:', err);
  }
}

function ensureMessageContainer() {
  if (!messageContainer) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    messageContainer = document.createElement('div');
    messageContainer.className = 'message assistant-message';
    messageContainer.setAttribute('role', 'log');
    messageContainer.setAttribute('aria-live', 'polite');
    chatHistory.appendChild(messageContainer);
  }
}

function ensureThinkingContainer() {
  ensureMessageContainer();
  if (!thinkingContainer && messageContainer) {
    const thinkingWrapper = document.createElement('div');
    thinkingWrapper.innerHTML = deepSeekProcessor.createThinkingBlockHTML(thinkingTextBuffer);
    messageContainer.appendChild(thinkingWrapper.firstElementChild);
    thinkingContainer = messageContainer.querySelector('.thinking-pre');
    const toggleButton = messageContainer.querySelector('.thinking-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', function() {
        const expanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', !expanded);
        const content = this.closest('.thinking-process').querySelector('.thinking-content');
        content.classList.toggle('hidden', expanded);
        this.querySelector('.toggle-icon').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      });
    }
  }
  if (thinkingContainer && thinkingTextBuffer) {
    thinkingContainer.textContent = thinkingTextBuffer;
  }
}

function finalizeThinkingContainer() {
  if (thinkingContainer) {
    thinkingContainer.textContent = thinkingTextBuffer;
    const toggleButton = messageContainer.querySelector('.thinking-toggle');
    const gradientOverlay = messageContainer.querySelector('.thinking-content > div:last-child');
    if (thinkingContainer.scrollHeight <= thinkingContainer.clientHeight && gradientOverlay) {
      gradientOverlay.remove();
    }
    thinkingContainer = null;
    thinkingTextBuffer = '';
  }
}

async function handleStreamingError(error) {
  console.error('[handleStreamingError]', error);
  if (!errorState) {
    errorState = true;
    try {
      if (mainTextBuffer || thinkingTextBuffer) {
        forceRender();
      }
      if (messageContainer && mainTextBuffer) {
        const errorNotice = document.createElement('div');
        errorNotice.className = 'py-2 px-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded mt-2';
        errorNotice.textContent = '⚠️ The response was interrupted. The content above may be incomplete.';
        messageContainer.appendChild(errorNotice);
      }
      removeTypingIndicator();
      const userFriendlyMessage = !navigator.onLine
        ? 'Network connection lost'
        : error.name === 'TimeoutError'
          ? 'Request timed out'
          : error.message || 'An unexpected error occurred';
      await handleMessageError({ ...error, message: userFriendlyMessage });
      eventBus.publish('streamingError', {
        error,
        recoverable: error.recoverable || false
      });
    } catch (err) {
      console.error('[handleStreamingError] Error handling stream error:', err);
    }
  }
}

async function attemptErrorRecovery(messageContent, error) {
  if (!navigator.onLine) {
    showNotification('Waiting for internet connection...', 'warning', 0);
    return new Promise(resolve => {
      window.addEventListener('online', async () => {
        await new Promise(r => setTimeout(r, 1500));
        showNotification('Connection restored. Retrying...', 'info', 3000);
        const sessionId = getSessionId();
        if (!sessionId) {
          showNotification('Could not retrieve session ID', 'error');
          resolve(false);
          return;
        }
        const modelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
        const developerConfig = document.getElementById('developer-config')?.value || '';
        const reasoningEffort = getReasoningEffortSetting();
        try {
          const success = await retry(
            () => streamChatResponse(messageContent, sessionId, modelName, developerConfig, reasoningEffort),
            MAX_RETRY_ATTEMPTS
          );
          resolve(success);
        } catch {
          showNotification('Recovery failed', 'error');
          resolve(false);
        }
      }, { once: true });
    });
  }
  if (error.recoverable || ['ConnectionError', 'NetworkError', 'TimeoutError'].includes(error.name)) {
    showNotification('Retrying connection...', 'info', 3000);
    await new Promise(r => setTimeout(r, 2000));
    const sessionId = getSessionId();
    if (!sessionId) {
      showNotification('Could not retrieve session ID', 'error');
      return false;
    }
    const modelName = document.getElementById('model-select')?.value || 'DeepSeek-R1';
    const developerConfig = document.getElementById('developer-config')?.value || '';
    const reasoningEffort = getReasoningEffortSetting();
    try {
      return await retry(
        () => streamChatResponse(messageContent, sessionId, modelName, developerConfig, reasoningEffort),
        MAX_RETRY_ATTEMPTS
      );
    } catch {
      showNotification('Recovery failed', 'error');
      return false;
    }
  }
  showNotification('Cannot retry - please refresh and try again', 'error');
  return false;
}

function resetStreamingState() {
  mainTextBuffer = '';
  thinkingTextBuffer = '';
  messageContainer = null;
  thinkingContainer = null;
  isThinking = false;
  lastRenderTimestamp = 0;
  chunkBuffer = '';
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  errorState = false;
}

function cleanupStreaming() {
  isProcessing = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  removeTypingIndicator();
  if (mainTextBuffer && messageContainer) {
    try {
      const sessionId = getSessionId();
      if (sessionId) {
        fetchWithRetry('/api/chat/conversations/store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            role: 'assistant',
            content: mainTextBuffer
          })
        }).catch(err => console.warn('Failed to store message:', err));
      }
    } catch (e) {
      console.warn('Failed to store message:', e);
    }
  }
}

function getReasoningEffortSetting() {
  const slider = document.getElementById('reasoning-effort-slider');
  if (slider) {
    const value = parseInt(slider.value);
    return value === 1 ? 'low' : value === 3 ? 'high' : 'medium';
  }
  return 'medium';
}
