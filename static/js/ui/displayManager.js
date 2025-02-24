// chat.js/ui/displayManager.js full content with corrected lines 120-133

import { safeMarkdownParse, injectMarkdownStyles } from '/static/js/ui/markdownParser.js';
import { copyToClipboard } from '/static/js/utils/helpers.js';
import { sessionId } from '/static/js/session.js';

/**
 *  Stores or retrieves messages from localStorage, plus
 *  responsible for rendering final messages in the chat UI.
 */

export function displayMessage(content, role) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  // Developer/system message rendering:
  if (role === 'developer') {
    const isFormattingMessage = content
      .toLowerCase()
      .includes('formatting re-enabled');

    const messageDiv = createDeveloperMessage(content, isFormattingMessage);
    chatHistory.appendChild(messageDiv);

    // Add accessibility announcement
    const liveRegion = document.getElementById('a11y-announcements');
    if (liveRegion) {
      liveRegion.textContent = `System message: ${content}`;
    }

    // Persist developer messages
    storeMessageInLocalStorage(content, role);
    storeMessageInDB(role, typeof content === 'string' ? content : JSON.stringify(content));
    return;
  }

  // For user or assistant roles:
  const messageDiv = createMessageElement(role);
  const contentDiv = createContentElement(content, role);

  // We can attach a copy button for convenience
  messageDiv.appendChild(createCopyButton(content));
  messageDiv.appendChild(contentDiv);

  // Insert small timestamp
  const timeStamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  const timeSpan = document.createElement('span');
  timeSpan.className = 'block text-xs text-gray-400 mt-1';
  timeSpan.textContent = timeStamp;
  messageDiv.appendChild(timeSpan);

  applyEntranceAnimation(messageDiv);
  highlightNewMessage(messageDiv);
  chatHistory.appendChild(messageDiv);
  scheduleScroll(messageDiv);

  // Persist user/assistant messages
  storeMessageInLocalStorage(content, role);
  storeMessageInDB(role, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A helper to process final response data once we've gotten
 * the entire (non-streaming) message from the server.
 */
export async function processServerResponseData(data, modelName = 'unknown') {
  if (data.calculated_timeout) {
    window.serverCalculatedTimeout = data.calculated_timeout;
  }

  // If data.choices[0].message.content exists, use that; else fallback.
  let assistantContent = data?.choices?.[0]?.message?.content || data.response || '';

  // Example: If modelName includes 'deepseek-r1', remove chain-of-thought
  // from final content but optionally store or show it.
  if (modelName.toLowerCase().includes('deepseek-r1')) {
    const thinkRegex = /<think>[\s\S]*?<\/think>/g;
    if (assistantContent.match(thinkRegex)) {
      // Optionally capture or log the chain-of-thought here if desired
      assistantContent = assistantContent.replace(thinkRegex, '');
    }
  }

  // Optionally append the model name as subtext:
  assistantContent += `\n\n<span class="text-xs text-gray-500 dark:text-gray-400">(Using model: ${modelName})</span>`;

  // Inject global Markdown styles once
  injectMarkdownStyles();

  // Finally display the assistant message
  displayMessage(safeMarkdownParse(assistantContent), 'assistant');

  // If the server returned usage info, you might want to update your usage display
  if (data.usage && typeof updateTokenUsage === 'function') {
    // data.usage might have {prompt_tokens, completion_tokens, total_tokens} etc.
    updateTokenUsage(data.usage);
  }
}

/**
 * Helper function to store messages in localStorage for session persistence.
 */
function storeMessageInLocalStorage(content, role) {
  try {
    const conversation = JSON.parse(localStorage.getItem('conversation')) || [];
    const now = new Date().toISOString();
    conversation.push({ content, role, timestamp: now });
    localStorage.setItem('conversation', JSON.stringify(conversation));
  } catch (error) {
    console.warn('Could not store message in localStorage:', error);
  }
}

/**
 * Reload messages from localStorage on page refresh, etc.
 */
export function loadConversationFromLocalStorage() {
  try {
    const conversation = JSON.parse(localStorage.getItem('conversation')) || [];
    conversation.forEach(msg => {
      displayMessage(msg.content, msg.role);
    });
  } catch (error) {
    console.warn('Could not load conversation from localStorage:', error);
  }
}

/**
 * Persist conversation in DB (via your server) for multi-session or longer-term storage.
 */
async function storeMessageInDB(role, content) {
  if (!sessionId) {
    console.warn('No sessionId available to store DB conversation.');
    return;
  }
  try {
    await fetch(`/api/chat/conversations/store?session_id=${sessionId}&role=${encodeURIComponent(role)}&content=${encodeURIComponent(content)}`, {
      method: 'POST',
      credentials: 'include'
    });
  } catch (error) {
    console.error('Failed to store conversation in DB:', error);
  }
}

/* ---------- Developer (system) message handling ---------- */
function createDeveloperMessage(content, isFormattingMessage) {
  const messageDiv = document.createElement('div');
  // Updated class names for Tailwind
  messageDiv.className = 'mx-auto max-w-xl bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-400 dark:border-yellow-600 p-3 text-yellow-800 dark:text-yellow-200 rounded my-2';
  messageDiv.setAttribute('role', 'alert');
  messageDiv.setAttribute('aria-live', 'assertive');

  if (isFormattingMessage) {
    const noticeDiv = document.createElement('div');
    noticeDiv.className = 'flex items-center';
    noticeDiv.innerHTML = `
      <span aria-hidden="true" class="mr-2">⚙️</span>
      <div>
        <strong>System:</strong>
        ${safeMarkdownParse(content)}
      </div>
    `;
    messageDiv.appendChild(noticeDiv);
  } else {
    messageDiv.innerHTML = safeMarkdownParse(content);
  }

  return messageDiv;
}

/* ---------- Generic message elements for user/assistant roles ---------- */
function createMessageElement(role) {
  const messageDiv = document.createElement('div');

  // Apply Tailwind classes based on role
  if (role === 'user') {
    messageDiv.className = 'ml-auto max-w-3xl rounded-lg rounded-br-none bg-blue-600 p-3 text-white shadow-md relative my-2';
  } else if (role === 'assistant') {
    messageDiv.className = 'mr-auto max-w-3xl rounded-lg rounded-bl-none bg-white dark:bg-gray-700 p-3 border border-gray-200 dark:border-gray-600 shadow-sm text-gray-800 dark:text-gray-100 relative my-2';
  }

  // Apply entrance animation styles with Tailwind
  messageDiv.style.opacity = '0';
  messageDiv.style.transform = 'translateY(20px)';

  return messageDiv;
}

function createContentElement(content, role) {
  const contentDiv = document.createElement('div');
  contentDiv.className = 'prose dark:prose-invert prose-sm max-w-none'; // Tailwind Typography classes

  // Always parse with safeMarkdownParse for security
  const htmlContent = safeMarkdownParse(
    typeof content === 'string' ? content : JSON.stringify(content)
  );
  contentDiv.innerHTML = htmlContent;

  // After injecting, highlight code blocks
  highlightCodeBlocks(contentDiv);

  return contentDiv;
}

/**
 * Generate a button that copies the underlying content to the clipboard.
 */
function createCopyButton(content) {
  const button = document.createElement('button');
  button.className = 'absolute top-2 right-2 text-white dark:text-gray-300 opacity-60 hover:opacity-100 focus:opacity-100 transition-opacity';
  button.innerHTML = '📋';
  button.title = 'Copy to clipboard';
  button.onclick = () =>
    copyToClipboard(typeof content === 'string' ? content : JSON.stringify(content));
  return button;
}

/**
 * Highlight code blocks for any inserted Markdown code
 */
export function highlightCodeBlocks(container) {
  container.querySelectorAll('pre code').forEach(block => {
    block.style.opacity = '0';
    // Apply Tailwind classes to code blocks
    block.classList.add('block', 'p-4', 'overflow-x-auto', 'rounded', 'bg-gray-100', 'dark:bg-gray-800', 'text-sm', 'font-mono');
    
    // Optional detection of language from text or class
    if (!block.className && block.parentElement.firstChild?.textContent) {
      const lang = block.parentElement.firstChild.textContent.trim();
      if (lang && typeof Prism !== 'undefined' && Prism.languages[lang]) {
        block.className = `language-${lang}`;
      }
    }
    if (typeof Prism !== 'undefined') {
      Prism.highlightElement(block);
    }
    setTimeout(() => {
      block.style.opacity = '1';
      block.style.transition = 'opacity 0.3s ease';
    }, 100);
  });
}

/* ---------- Animations and scrolling ---------- */
function applyEntranceAnimation(element) {
  requestAnimationFrame(() => {
    element.style.transition = 'all 0.3s ease';
    element.style.opacity = '1';
    element.style.transform = 'translateY(0)';
  });
}

function highlightNewMessage(element) {
  element.classList.add('bg-yellow-50', 'transition-colors');
  setTimeout(() => {
    element.classList.remove('bg-yellow-50');
  }, 1200);
}

function scheduleScroll(element) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const scrollOptions = {
    behavior: 'smooth',
    block: isMobile ? 'nearest' : 'end',
    inline: 'nearest'
  };

  const scrollThreshold = isMobile ? 100 : 300;
  const fromBottom =
    chatHistory.scrollHeight - (chatHistory.scrollTop + chatHistory.clientHeight);

  if (fromBottom <= scrollThreshold) {
    setTimeout(() => {
      element.scrollIntoView(scrollOptions);
    }, isMobile ? 50 : 100);
  }
}

/* ---------- Example citation processing if relevant ---------- */
export function processCitations(content) {
  const messageContent = content.content[0].text;
  const annotations = messageContent.annotations;
  let parsedContent = messageContent.value;
  const citations = [];

  annotations.forEach((annotation, index) => {
    if (annotation.file_citation) {
      parsedContent = parsedContent.replace(annotation.text, `[${index + 1}]`);
      citations.push(createCitationHTML(index + 1, annotation.file_citation));
    }
  });

  return { parsedContent, citations };
}

function createCitationHTML(index, citation) {
  // Updated to use Tailwind classes
  return `
    <div class="my-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-md border-l-3 border-blue-500 dark:border-blue-400" 
         role="region" 
         aria-label="Document reference ${index}"
         tabindex="0">
      <div class="flex items-center mb-2" id="citation-heading-${index}">
        <span class="text-blue-600 dark:text-blue-400 font-mono font-bold mr-2" aria-label="Reference number">[${index}]</span>
        <span class="text-gray-600 dark:text-gray-400 text-sm" aria-label="Source document">
          ${citation.file_name}
        </span>
      </div>
      <div class="text-gray-800 dark:text-gray-200 italic" aria-label="Relevant excerpt">
        ${citation.quote}
      </div>
    </div>
  `;
}

/**
 * If you want to reuse the UI token usage display in this same file, you can define it here.
 */
export function updateTokenUsage(usage) {
  // Update the token display with the usage info
  const promptTokens = document.getElementById('prompt-tokens');
  const completionTokens = document.getElementById('completion-tokens');
  const totalTokens = document.getElementById('total-tokens');
  const reasoningTokens = document.getElementById('reasoning-tokens');
  const baseCompletionTokens = document.getElementById('base-completion-tokens');

  if (promptTokens) promptTokens.textContent = usage.prompt_tokens || 0;
  if (completionTokens) completionTokens.textContent = usage.completion_tokens || 0;
  if (totalTokens) totalTokens.textContent = usage.total_tokens || 0;
  
  // Optional if these are provided
  if (reasoningTokens && usage.reasoning_tokens) {
    reasoningTokens.textContent = usage.reasoning_tokens;
  }
  if (baseCompletionTokens && usage.base_completion_tokens) {
    baseCompletionTokens.textContent = usage.base_completion_tokens;
  }
}
