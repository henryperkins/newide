import {
  showNotification,
  handleMessageError,
  showTypingIndicator,
  removeTypingIndicator,
  showConfirmDialog
} from './ui/notificationManager.js';
import {
  getSessionId,
  initializeSession,
  setLastUserMessage
} from './session.js';
import {
  formatFileSize,
  copyToClipboard,
  updateTokenUsage,
  debounce
} from './utils/helpers.js';
import { renderMarkdown, sanitizeHTML, highlightCode } from './ui/markdownParser.js';
import { deepSeekProcessor } from './ui/deepseekProcessor.js';

let streamingEnabled = false;
let developerConfig = 'You are a helpful AI assistant.';
let reasoningEffort = 'medium';
let isProcessing = false;
let currentController = null;
let messageQueue = [];
let isStreamingSupported = true;

document.addEventListener('DOMContentLoaded', () => {
  initChatInterface();
  window.sendMessage = sendMessage;
  window.renderAssistantMessage = renderAssistantMessage;
});

function initChatInterface() {
  const userInput = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const streamingToggle = document.getElementById('enable-streaming');
  const developerConfigInput = document.getElementById('developer-config');
  const reasoningSlider = document.getElementById('reasoning-effort-slider');
  const charCount = document.getElementById('char-count');

  if (userInput && charCount) {
    userInput.addEventListener(
      'input',
      debounce(e => {
        const count = e.target.value.length;
        charCount.textContent = count;
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
        if (count > 4000) charCount.classList.add('text-warning-500');
        else charCount.classList.remove('text-warning-500');
      }, 100)
    );
  }

  if (sendButton) sendButton.addEventListener('click', sendMessage);

  if (streamingToggle) {
    streamingToggle.addEventListener('change', e => {
      streamingEnabled = e.target.checked;
      localStorage.setItem('streamingEnabled', streamingEnabled);
    });
    const storedStreamingState = localStorage.getItem('streamingEnabled');
    if (storedStreamingState !== null) {
      streamingEnabled = storedStreamingState === 'true';
      streamingToggle.checked = streamingEnabled;
    }
  }

  if (developerConfigInput) {
    developerConfigInput.addEventListener('change', e => {
      developerConfig = e.target.value;
      localStorage.setItem('developerConfig', developerConfig);
    });
    const storedConfig = localStorage.getItem('developerConfig');
    if (storedConfig) {
      developerConfig = storedConfig;
      developerConfigInput.value = developerConfig;
    }
  }

  if (reasoningSlider) {
    const effortDisplay = document.getElementById('reasoning-effort-display');
    const effortDescription = document.getElementById('effort-description-text');
    if (effortDisplay && effortDescription) {
      reasoningSlider.addEventListener('input', e => {
        const value = parseInt(e.target.value, 10);
        let level = 'medium',
          desc = '';
        switch (value) {
          case 1:
            level = 'low';
            desc = 'Low: Faster responses (30s-1min) with basic reasoning';
            break;
          case 2:
            level = 'medium';
            desc = 'Medium: Balanced processing time (1-3min) and quality';
            break;
          case 3:
            level = 'high';
            desc = 'High: Deeper reasoning (3-5min) for complex questions';
            break;
        }
        reasoningEffort = level;
        localStorage.setItem('reasoningEffort', level);
        effortDisplay.textContent = level.charAt(0).toUpperCase() + level.slice(1);
        effortDescription.textContent = desc;
      });
    }
    const storedEffort = localStorage.getItem('reasoningEffort');
    if (storedEffort) {
      reasoningEffort = storedEffort;
      switch (storedEffort) {
        case 'low':
          reasoningSlider.value = 1;
          break;
        case 'medium':
          reasoningSlider.value = 2;
          break;
        case 'high':
          reasoningSlider.value = 3;
          break;
      }
      reasoningSlider.dispatchEvent(new Event('input'));
    }
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#theme-toggle')) {
      document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
      return;
    }
    if (e.target.closest('#mobile-stats-toggle') || e.target.closest('#performance-stats')) {
      const panel = document.getElementById('mobile-stats-panel');
      if (panel) panel.classList.toggle('hidden');
      return;
    }
    if (e.target.closest('#mobile-font-up')) {
      adjustFontSize(1);
      return;
    }
    if (e.target.closest('#mobile-font-down')) {
      adjustFontSize(-1);
      return;
    }
  });

  userInput?.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });

  const tokenUsageToggle = document.getElementById('token-usage-toggle');
  const tokenDetails = document.getElementById('token-details');
  const tokenChevron = document.getElementById('token-chevron');
  if (tokenUsageToggle && tokenDetails && tokenChevron) {
    tokenUsageToggle.addEventListener('click', () => {
      tokenDetails.classList.toggle('hidden');
      tokenChevron.classList.toggle('rotate-180');
      localStorage.setItem('tokenDetailsVisible', !tokenDetails.classList.contains('hidden'));
    });
    const tokenDetailsVisible = localStorage.getItem('tokenDetailsVisible') === 'true';
    if (tokenDetailsVisible) {
      tokenDetails.classList.remove('hidden');
      tokenChevron.classList.add('rotate-180');
    }
  }

  document.addEventListener('click', e => {
    if (
      e.target.classList.contains('copy-code-button') ||
      e.target.closest('.copy-code-button')
    ) {
      const button = e.target.classList.contains('copy-code-button')
        ? e.target
        : e.target.closest('.copy-code-button');
      const codeBlock = button.nextElementSibling;
      if (codeBlock) {
        const code = codeBlock.textContent;
        copyToClipboard(code)
          .then(() => {
            const orig = button.textContent;
            button.textContent = 'Copied!';
            setTimeout(() => {
              button.textContent = orig;
            }, 2000);
          })
          .catch(err => {
            console.error('Copy failed:', err);
            showNotification('Failed to copy to clipboard', 'error');
          });
      }
    }
    if (
      e.target.classList.contains('thinking-toggle') ||
      e.target.closest('.thinking-toggle')
    ) {
      const toggle = e.target.classList.contains('thinking-toggle')
        ? e.target
        : e.target.closest('.thinking-toggle');
      const content = toggle.parentElement.nextElementSibling;
      const icon = toggle.querySelector('.toggle-icon');
      if (content && icon) {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', !isExpanded);
        icon.textContent = isExpanded ? '▶' : '▼';
      }
    }
  });
}

export async function sendMessage() {
  const userInput = document.getElementById('user-input');
  if (!userInput) return;
  const messageContent = userInput.value.trim();
  if (!messageContent || isProcessing) return;
  try {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
    isProcessing = true;
    setLastUserMessage(messageContent);
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
      sendButton.disabled = true;
      sendButton.innerHTML = '<span class="animate-spin inline-block mr-2">&#8635;</span>';
    }
    userInput.value = '';
    userInput.style.height = 'auto';
    let currentSessionId = await getSessionId();
    if (!currentSessionId) {
      showNotification('Could not retrieve a valid session ID. Please refresh.', 'error');
      return;
    }
    renderUserMessage(messageContent);
    const modelSelect = document.getElementById('model-select');
    let modelName = 'DeepSeek-R1';
    if (modelSelect) modelName = modelSelect.value;
    const modelConfig = await getModelConfig(modelName);
    isStreamingSupported = modelConfig?.supports_streaming || false;
    const useStreaming = streamingEnabled && isStreamingSupported;
    showTypingIndicator();
    const controller = new AbortController();
    currentController = controller;
    const timeoutMs = calculateTimeout(messageContent, modelName, reasoningEffort);
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(`Request timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    try {
      if (useStreaming) {
        await import('./streaming.js').then(module => {
          return module.streamChatResponse(
            messageContent,
            currentSessionId,
            modelName,
            developerConfig,
            reasoningEffort,
            controller.signal
          );
        });
      } else {
        const response = await fetchChatResponse(
          messageContent,
          currentSessionId,
          modelName,
          developerConfig,
          reasoningEffort,
          controller.signal
        );
        const assistantMessage = response.choices[0].message.content;
        renderAssistantMessage(assistantMessage);
        if (response.usage) updateTokenUsage(response.usage);
      }
    } catch (error) {
      if (error.name !== 'AbortError' || !controller.signal.aborted) {
        await handleMessageError(error);
      }
    } finally {
      clearTimeout(timeoutId);
      removeTypingIndicator();
      currentController = null;
    }
  } catch (error) {
    console.error('Error in sendMessage:', error);
    showNotification('Failed to send message', 'error');
  } finally {
    isProcessing = false;
    const btn = document.getElementById('send-button');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
        </svg>
      `;
    }
    userInput.focus();
  }
}

function calculateTimeout(message, model, effort) {
  const base = 60000,
    perChar = 10,
    length = message.length;
  const isO = model.toLowerCase().startsWith('o1') || model.toLowerCase().startsWith('o3');
  const modelMult = isO ? 3 : 1;
  let effortMult = 1;
  switch (effort) {
    case 'low':
      effortMult = 0.7;
      break;
    case 'high':
      effortMult = 1.5;
      break;
  }
  const timeout = base + length * perChar * modelMult * effortMult;
  return Math.min(timeout, 300000);
}

async function fetchChatResponse(
  messageContent,
  sessionId,
  modelName = 'DeepSeek-R1',
  devConfig = '',
  effort = 'medium',
  signal
) {
  const maxRetries = 2;
  let retryCount = 0,
    lastError = null;
  while (retryCount <= maxRetries) {
    try {
      const apiUrl = `${window.location.origin}/api/chat`;
      const messages = [];
      if (devConfig) messages.push({ role: 'system', content: devConfig });
      messages.push({ role: 'user', content: messageContent });
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          model: modelName,
          messages,
          reasoning_effort: effort,
          temperature: 0.7,
          max_completion_tokens: 5000
        }),
        signal
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const secs = retryAfter ? parseInt(retryAfter, 10) : 5;
          if (retryCount < maxRetries) {
            console.warn(`Rate limited (429). Retrying in ${secs}s...`);
            showNotification(`Rate limited. Retrying in ${secs}s... (${retryCount+1}/${maxRetries})`,'warning',secs*1000);
            await new Promise(r => setTimeout(r, secs * 1000));
            retryCount++;
            continue;
          }
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.name === 'TypeError' && error.message.includes('network') && retryCount < maxRetries) {
        retryCount++;
        await new Promise(r => setTimeout(r, 2000 * retryCount));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function renderUserMessage(content) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  const el = document.createElement('div');
  el.className = 'message user-message';
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = sanitizeHTML(content).replace(/\n/g, '<br>');
  chatHistory.appendChild(el);
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, 100);
  storeChatMessage('user', content);
}

export function renderAssistantMessage(content, isThinking = false) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;
  const el = document.createElement('div');
  el.className = `message assistant-message ${isThinking ? 'thinking-message' : ''}`;
  el.setAttribute('role', 'log');
  el.setAttribute('aria-live', 'polite');
  if (content.includes('<think>')) {
    content = deepSeekProcessor.replaceThinkingBlocks(content);
  }
  const markdown = renderMarkdown(content);
  const processedContent = processCodeBlocks(markdown);
  el.innerHTML = processedContent;
  chatHistory.appendChild(el);
  highlightCode(el);
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, 100);
  if (!isThinking) storeChatMessage('assistant', content);
}

async function storeChatMessage(role, content) {
  try {
    const currentSessionId = await getSessionId();
    // Ensure required fields are present
    if (!currentSessionId || !role || !content) {
      console.error('[storeChatMessage] Missing required fields:', {
        session_id: currentSessionId,
        role,
        content
      });
      return;
    }
    console.log('[storeChatMessage] Sending message to server:', {
      session_id: currentSessionId,
      role,
      content: content.substring(0, 50) + (content.length > 50 ? '...' : '')
    });
    
    try {
      const response = await fetchWithRetry(
        `${window.location.origin}/api/chat/conversations/store`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: currentSessionId, role, content })
        },
        3
      );
      
      if (!response.ok) {
        const text = await response.text();
        console.error('[storeChatMessage] Server error:', response.status, text);
        throw new Error(`Server returned ${response.status}: ${text}`);
      }
      
      console.log('[storeChatMessage] Message stored successfully');
    } catch (err) {
      console.warn('Failed to store message in backend:', err);
    }
    
    // Also store in localStorage as backup
    try {
      const key = `conversation_${currentSessionId}`;
      let convo = JSON.parse(localStorage.getItem(key) || '[]');
      convo.push({ role, content, timestamp: new Date().toISOString() });
      if (convo.length > 50) convo = convo.slice(-50);
      localStorage.setItem(key, JSON.stringify(convo));
    } catch (e) {
      console.warn('Failed to store message locally:', e);
    }
  } catch (error) {
    console.error('Error in storeChatMessage:', error);
  }
}

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const response = await fetch(url, options);
      if (response.ok || (response.status >= 400 && response.status < 500)) return response;
      if (response.status >= 500) {
        console.warn(`Server error (${response.status}), retrying... (${retries+1}/${maxRetries})`);
      } else {
        return response;
      }
    } catch (error) {
      console.warn(`Network error, retrying... (${retries+1}/${maxRetries})`, error);
    }
    const delay = Math.min(1000 * Math.pow(2, retries) * (0.9 + Math.random() * 0.2), 10000);
    await new Promise(r => setTimeout(r, delay));
    retries++;
  }
  return fetch(url, options);
}

function processCodeBlocks(html) {
  return html.replace(
    /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g,
    (_, lang, code) => `
      <div class="relative group">
        <button class="copy-code-button absolute top-2 right-2 p-1 rounded text-xs bg-dark-700/50 text-white opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100" aria-label="Copy code">
          Copy
        </button>
        <pre><code class="language-${lang}">${code}</code></pre>
      </div>
    `
  );
}

async function getModelConfig(modelName) {
  try {
    const encoded = encodeURIComponent(modelName);
    const response = await fetch(`${window.location.origin}/api/config/models/${encoded}`);
    if (response.ok) return await response.json();
    console.warn(`Could not fetch model config for ${modelName}, status: ${response.status}`);
    if (response.status === 400) console.error(`Bad request: check model name and API.`);
    else if (response.status === 404) console.error(`Model ${modelName} not found in config.`);
    if (modelName.toLowerCase() === 'deepseek-r1')
      return { name: 'DeepSeek-R1', supports_streaming: true, supports_temperature: true, api_version: '2024-05-01-preview' };
    if (modelName.toLowerCase().startsWith('o1'))
      return { name: modelName, supports_streaming: false, supports_temperature: false, api_version: '2025-01-01-preview' };
  } catch (error) {
    console.error('Error fetching model config:', error);
  }
  return { supports_streaming: false, supports_temperature: true };
}

function adjustFontSize(direction) {
  const sizes = ['text-sm','text-base','text-lg','text-xl'];
  let currentIndex = sizes.findIndex(sz => document.documentElement.classList.contains(sz));
  if (currentIndex === -1) currentIndex = 1;
  const newIndex = Math.min(Math.max(currentIndex + direction, 0), sizes.length - 1);
  document.documentElement.classList.remove(...sizes);
  document.documentElement.classList.add(sizes[newIndex]);
  localStorage.setItem('fontSize', sizes[newIndex]);
}
